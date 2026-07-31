# Data contract

Everything this tool shows comes from files Claude Code itself already
writes to disk. **sessman never writes to `~/.claude`** — every read path
in this codebase is read-only toward it (`registry.ts`, `transcript.ts`,
`transcript-index.ts`, `slug.ts`).

## Registry: `~/.claude/sessions/<pid>.json`

One file per session, read by `server/src/registry.ts`. Only files ending
in `.json` are considered; everything else in the directory is ignored.

| Field | Type | Required | Notes |
|---|---|---|---|
| `pid` | `number` | yes | must be a finite number |
| `sessionId` | `string` | yes | must be non-empty |
| `cwd` | `string` | yes | must be non-empty |
| `startedAt` | `number` | yes | epoch ms, must be finite |
| `procStart` | `string \| null` | no | ctime string, rendered in **UTC** — see the timezone note below |
| `version` | `string \| null` | no | |
| `peerProtocol` | `number \| null` | no | |
| `kind` | `string \| null` | no | |
| `entrypoint` | `string \| null` | no | |
| `name` | `string \| null` | no | the optional `/rename` value |
| `status` | `string` | no | `"busy"`, `"idle"`, or any other string the CLI emits |
| `updatedAt` | `number \| null` | no | epoch ms |
| `statusUpdatedAt` | `number \| null` | no | epoch ms |
| `sourceFile` | `string` | — | not read from the JSON; set by the reader to the file's path |

The four **required** fields (`pid`, `sessionId`, `cwd`, `startedAt`) are
all-or-nothing: if any one is missing or the wrong type, the entire record
is skipped — there is no partial record.

Tolerances (`readSessionRegistry` never throws):

| Condition | Behavior |
|---|---|
| Sessions directory missing | returns `[]` |
| File unreadable | that file is skipped |
| Malformed JSON | that file is skipped |
| JSON parses to a non-object (array, string, …) | that file is skipped |
| A required field missing/wrong type | that file is skipped |
| `status` missing, non-string, or `""` | normalizes to `"unknown"` |
| `status` any other string | passed through unchanged |
| Any other optional field missing/wrong type | normalizes to `null` |

## Transcript path (slug scheme)

Transcripts live at `~/.claude/projects/<slug>/<sessionId>.jsonl`, where
`slug` is the session's `cwd` with every `/` and `.` replaced by `-`
(`server/src/slug.ts`, `cwdToSlug`):

```
cwd:  /tmp/proj-a/proj-b
slug: -tmp-proj-a-proj-b
path: ~/.claude/projects/-tmp-proj-a-proj-b/<sessionId>.jsonl
```

(worked example as asserted by `enrich.test.ts`; no real cwd is ever used
in this repo's fixtures.)

## Transcripts: `~/.claude/projects/<slug>/<sessionId>.jsonl`

Never read in full. `transcript.ts` only `stat()`s the file (size,
`mtimeMs`) for existence/freshness. `transcript-index.ts` incrementally
streams and parses each line as JSON to build a `TranscriptSummary` — see
`docs/ARCHITECTURE.md` for the caching/incremental-scan contract itself;
this section covers only which JSONL shapes it recognizes.

Each line is parsed independently; a line that fails `JSON.parse` (including
a half-written trailing line with no newline yet) or that doesn't parse to
a plain object is skipped silently — never throws, never stops the scan.

For every line with a string `timestamp` field, `lastEntryAt` is updated to
it — **even for lines otherwise excluded below** (sidechain, meta). This
happens before any type/sidechain check, so `lastEntryAt` reflects the most
recent JSONL line of any recognized shape, not just ones that produced a
turn or a gist.

| Shape | Recognized as | Effect |
|---|---|---|
| `isSidechain: true` (any `type`) | excluded from the main-chain summary | only the `lastEntryAt` update above applies to the pre-existing fields — no turn, gist, `toolCounts`/`toolCallsTotal`, or snapshot `model`/`usage` change. **Since M4**, a sidechain `assistant` line is the one exception: its `model`+`usage` still feed the new aggregate-only fields below (`totalUsage`, `subagentUsage`, `modelBreakdown`), and the line itself is counted toward `subagents.sidechainLineCount`/`subagents.lastSidechainAt`. Nothing about the pre-M4 fields changed. |
| `type: "user"`, `isMeta: true` | excluded | skipped entirely (checked after the sidechain check) |
| `type: "user"`, `message.content` is a `string` (empty included — the code does not special-case `""`), or an array with ≥1 `{type:"text", text:string}` block | new turn | increments `turnCount`; opens a new entry in `recentTurns` with this text as `prompt` and `at: timestamp`; also sets the turn's `continuation` flag (see below) |
| `type: "user"`, content is tool-result-only, image-only, or otherwise has no text | not a turn | no-op beyond the `lastEntryAt` update, **except**: a `tool_result` block whose `tool_use_id` matches a pending Agent/Task dispatch (see "Subagent visibility" below) resolves that dispatch out of `subagents.running` |
| `type: "assistant"`, `message.content` is an array | updates current turn | does **not** open a new turn — attaches to the most-recently-opened one (see below) |
| any other `type` (`"system"`, attachment/agent-name/custom-title lines, …) | ignored | not part of the summary |

Assistant-line handling, once `message.content` is an array: each block
with `type: "text"` sets `lastAssistantGist` and the current turn's `gist`
(last one wins if there are several); each block with
`type: "tool_use"` and a string `name` increments `toolCounts[name]` and
`toolCallsTotal`, and appends `name` to the current turn's `toolNames`. The
"current turn" is always `recentTurns[recentTurns.length - 1]` — the last
user turn opened — regardless of how many assistant lines follow it.
`message.model` (if a string) and `message.usage` (if present) are also
applied on every assistant line, independent of the *turn* logic — they land
even when no turn is open. They are **not** independent of the sidechain
check: that check returns early for these two *snapshot* fields, so a
sidechain assistant line updates neither `model` nor `usage`, per the table
above — but (since M4) it does still feed `totalUsage`/`subagentUsage`/
`modelBreakdown`, which run before the sidechain early-return.

`TokenUsage` is read from `message.usage`'s snake_case fields, each
defaulting to `0` if missing or non-numeric:

```ts
inputTokens         // usage.input_tokens
outputTokens        // usage.output_tokens
cacheReadTokens      // usage.cache_read_input_tokens
cacheCreationTokens  // usage.cache_creation_input_tokens
contextTokens        // inputTokens + cacheReadTokens + cacheCreationTokens
```

### Usage/model aggregates, subagent visibility, continuation (M4)

Added in M4 to feed the dashboard's right-hand panel (total usage, per-model
breakdown, running subagents). All four are **additive**: `TranscriptSummary.model`
and `.usage` are unchanged and keep behaving as a last-*main-chain*-message
snapshot (`SessionCard.vue` renders `.usage` as `ctx`) — they are not totals,
and this PR does not touch what feeds them.

**`totalUsage: SummedUsage | null`** / **`subagentUsage: SummedUsage | null`** —
real sums (not snapshots), folded **once per distinct assistant `message.id`**,
not once per JSONL line. A real transcript writes one logical assistant
message as multiple JSONL lines — one per content block (`thinking`, then
`text`, then `tool_use`) — and every line belonging to that message repeats
an identical `message.usage` object: it is a running total *for the whole
message*, never a per-line delta. Folding it once per line therefore
inflated `totalUsage`/`subagentUsage`/`modelBreakdown` by however many lines
the message happened to be split across. The scanner instead folds each
distinct `message.id`'s usage at most once — except that an earlier all-zero
(or missing) usage does not "close" the id, so a later line for the same id
carrying a real, non-zero usage still gets folded in. When `message.id` is
missing or not a string (rare), the line falls back to the pre-dedup,
per-line behaviour. `totalUsage` sums main-chain **and** sidechain assistant
messages; `subagentUsage` sums sidechain-only. Main-chain-only usage is
`totalUsage` minus `subagentUsage` field-by-field (there is no separate third
field for it). Both are `null` until at least one qualifying assistant usage
has been seen — this distinguishes "zero tokens seen" from "no usage-bearing
message parsed yet" the same way `TranscriptSummary.usage` already does.

Note: `message.usage.iterations` is present on nearly every assistant line,
but it is always length 1 and identical to that message's top-level usage
fields — it is **not** a per-call/per-line breakdown, and must not be used to
attribute usage within a multi-line message.

This dedup state (`message.id` → whether its call/usage has been counted) is
kept in memory for the life of the indexed file and never evicted — on the
order of a thousand distinct assistant message ids for a large real
transcript, each a small fixed-size entry, so the memory cost is acceptable
for a process-lifetime cache.

`SummedUsage` intentionally has **no `contextTokens` field**, unlike
`TokenUsage`. `contextTokens` is `input + cacheRead + cacheCreation` *of one
message* — the size of that message's context window — and summing that
number across many messages does not produce a meaningful quantity (a
100-turn session's `contextTokens` don't add up to "200k tokens of context";
each message's context window mostly re-reads the same prior tokens). So the
summed types simply omit it rather than compute a number that would look
plausible but mean nothing.

**`modelBreakdown: ModelUsage[]`** — one entry per distinct `message.model`
string seen (main chain **and** sidechain), each `{ model, calls, inputTokens,
outputTokens, cacheReadTokens, cacheCreationTokens }`. Sorted by `calls`
descending, then `model` ascending as a tiebreak, for a stable render order.
`calls` counts distinct assistant **messages**, deduped by `message.id` using
the same rule as `totalUsage` above — a message split across several lines
increments `calls` once, not once per line. Summing every entry's four token
fields across the whole array equals `totalUsage` **only when every
usage-bearing message named a model**: an assistant message carrying usage
but no string `model` is folded into `totalUsage` and has no `modelBreakdown`
entry to attribute to, so the array sums to `totalUsage` minus that usage.
Do not treat the two as an invariant a consumer can assert on. In the other
direction, a message with a string `model` but no usable `usage` still
increments that model's `calls` (it happened), contributing `0` to all four
token fields.

**`subagents: SubagentSummary`** — `{ sidechainLineCount, lastSidechainAt,
running }`:

- `sidechainLineCount` / `lastSidechainAt`: count and latest timestamp of
  every `isSidechain: true` line of **any** `type` seen in this transcript.
  This is the literal "at minimum a count of sidechain lines + timestamp of
  the most recent one" signal, kept intentionally anonymous — it carries no
  identity, only a number and a time.
- `running: RunningSubagent[]` — the actually useful signal, and a
  **heuristic**: every `tool_use` block in the *main chain* named `"Task"` or
  `"Agent"` with a string `id` is treated as a subagent dispatch and kept in
  `running` (newest first, capped at 20) until a `tool_result` block with a
  matching `tool_use_id` appears later in the same file, at which point it's
  removed. Each entry is
  `{ toolUseId, description, subagentType, startedAt }`, where `description`/
  `subagentType` come from the dispatching block's `input.description` /
  `input.subagent_type` (`null` if not a string) and `startedAt` is that
  line's `timestamp`.

  **Failure modes of this heuristic** — read before trusting "N subagents
  running":
  1. **A dispatch that never gets a `tool_result` in this transcript** (the
     process died, the transcript was truncated, or the result genuinely
     never arrived) stays in `running` forever, capped at 20 entries — after
     that, the oldest unresolved dispatch is silently evicted to bound memory,
     so a sufficiently long-running/misbehaving session can under-report.
  2. **The dispatching tool is not named exactly `"Task"` or `"Agent"`.** This
     scanner only recognizes those two names; a differently-named or
     custom-framework dispatch tool (observed on at least one real machine
     during this task's investigation) is invisible to this heuristic.
  3. **Real subagent conversation content on current Claude Code CLI builds
     is not stored inline as `isSidechain: true` lines in the main
     transcript.** Empirically (checked against real transcripts during this
     task, not assumed), it lives in separate
     `<projectSlug>/<sessionId>/subagents/agent-<agentId>.jsonl` files
     (paired with `agent-<agentId>.meta.json` carrying `agentType`,
     `description`, `spawnDepth`, `toolUseId`), which this single-file
     scanner does not read. In practice this means `sidechainLineCount` is
     frequently `0` even on a transcript with real subagent activity, and
     `running` (derived from the main-chain dispatch/result pairing instead)
     is the only signal in this file that reliably reflects real subagent
     activity today. Reading the external `subagents/` directory to recover
     the sidechain-content-based signal for real, and/or to attribute
     `subagentUsage`/`modelBreakdown` entries to actual per-subagent token
     spend, is out of scope for this change and is a natural follow-up task.

**`TranscriptTurn.continuation: boolean`** — `true` when the turn's prompt
text matches, as an anchored (`^`), case-insensitive prefix (not a substring
search anywhere in the prompt), the auto-generated post-compaction preamble
"This session is being continued from a previous conversation that ran out
of context...". These turns are **flagged, never dropped**: `turnCount` and
every turn's `index` are unaffected, because `index` is transcript-global and
monotonic and doubles as a cache key elsewhere in the codebase — dropping a
turn would shift every later turn's `index`. A prompt that merely quotes or
references the phrase later in its text (not as its own prefix) is not
flagged.

Text captured for `prompt`/`gist` collapses whitespace and is capped at
2000 chars internally (`MAX_CAPTURE_LENGTH`); display-time truncation is a
second, separate limit — either limit being hit sets `truncated: true`.

The display limit applies **only to the top-level `lastUserPrompt` and
`lastAssistantGist`**: 400 chars via `getSummary`, 2000 via
`getDetailSummary`. Per-turn text inside `recentTurns[]` is always rendered
at 400 chars, whichever accessor is used — `toSummary()` passes
`SUMMARY_TEXT_LIMIT` to `turnToSummary()` unconditionally and never forwards
its own `textLimit` argument. So `/detail` does *not* give you longer
per-turn prompts than the session list does. The raw 2000-char capture is
retained in state, so surfacing more per turn is a one-line change, but no
caller gets it today.

`recentTurns` is a ring buffer capped at 20 entries (oldest dropped first),
but each turn's `index` counts across the *whole* transcript and is never
reset — so once a transcript has more than 20 turns, `recentTurns[0].index`
is not `0`.

**Known gap**: `TranscriptSummary.complete` is hardcoded `true` on every
non-null summary produced by `toSummary()` — there is no scan-in-progress
or partial-scan signal on this field. The real "nothing scanned yet"
signal is the *outer* `TranscriptSummary | null` being `null` (before the
first scan completes), not `complete` ever being `false`.

## Process facts

- Liveness: `process.kill(pid, 0)` (`process-info.ts`); `EPERM` counts as
  alive (process exists, just owned by someone else).
- tty + start time: `ps -o tty=,lstart= -p <pid>`, parsed with
  `/^(\S+)\s+(.+)$/`; tty is `null` when `ps` reports `"??"`.

### `procStart` vs. `ps lstart`: a UTC-vs-local timezone gotcha

The registry's `procStart` is a ctime-style string (e.g.
`"Wed Jan 15 09:30:00 2025"`) rendered in **UTC**. A live `ps -o lstart`
query on the same machine renders the *same kind of string* in **local**
time, with no timezone marker on either side. Comparing them naively (as
strings, or by feeding both through `new Date(str)`, which treats an
offset-less ctime string as local time either way) misfires by exactly the
local UTC offset.

`server/src/ctime.ts`'s `parseCtime(input, { utc })` requires the caller to
say which one it's parsing: `{ utc: true }` for `procStart` (registry),
`{ utc: false }` for a freshly-queried `ps -o lstart` string.
`server/src/pid-reuse.ts`'s `checkPidReuse(procStart, liveLstart,
toleranceMs = 2000)` uses this to return `"match" | "mismatch" | "unknown"`
— `"unknown"` (not `false`) when either string is missing or fails to
parse, since that's a materially different case from a confirmed mismatch.

This is why `server/vitest.config.ts` pins the server test environment's
`TZ` to `Asia/Bangkok` (UTC+7): several `ctime.ts`/`pid-reuse.ts` tests are
timezone-sensitive by construction, and a fixed non-UTC `TZ` is what
exercises the local-time parsing path deterministically in CI.
