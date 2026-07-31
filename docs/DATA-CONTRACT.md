# Data contract

Everything this tool shows comes from files Claude Code itself already
writes to disk. **sessman never writes to `~/.claude`** — every read path
in this codebase is read-only toward it (`registry.ts`, `transcript.ts`,
`transcript-index.ts`, `subagent-index.ts`, `slug.ts`).

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
`toolCallsTotal` **unconditionally** (these are whole-transcript totals,
never capped). The "current turn" is always
`recentTurns[recentTurns.length - 1]` — the last user turn opened —
regardless of how many assistant lines follow it.
`message.model` (if a string) and `message.usage` (if present) are also
applied on every assistant line, independent of the *turn* logic — they land
even when no turn is open. They are **not** independent of the sidechain
check: that check returns early for these two *snapshot* fields, so a
sidechain assistant line updates neither `model` nor `usage`, per the table
above — but (since M4) it does still feed `totalUsage`/`subagentUsage`/
`modelBreakdown`, which run before the sidechain early-return.

### Per-turn tool calls: cap, `toolCallsOmitted`, and target extraction

Separately from the whole-transcript `toolCounts`/`toolCallsTotal` above,
each `tool_use` block is also folded into the *current turn's* own
`toolCalls` list — but only up to `MAX_TOOL_CALLS_PER_TURN` (40) entries.
Once a turn's `toolCalls` already holds 40, every further `tool_use` block
in that turn only increments `toolCallsOmitted` (a count, not a detail) —
it still counts toward the global `toolCounts`/`toolCallsTotal`, but never
appears in that turn's `toolCalls`, `toolNames`, or `filesTouched`.
`toolNames` is derived from the turn's own (capped) `toolCalls`
(`toolCalls.map(call => call.name)`), so it can under-count relative to
`toolCallsTotal` once a turn hits the cap.

Each recorded tool call's `target` is read from `block.input` by
`extractToolTarget`, in this exact precedence — first field present wins,
everything else falls through to `null`:

1. `input.file_path` (string) → target, and this call counts as a
   *file* target.
2. `input.notebook_path` (string) → target, also a file target.
3. `input.pattern` (string) → target, **not** a file target.
4. `input.command` (string) → target, **not** a file target.
5. none of the above → `target: null`.

A non-null target longer than `MAX_TOOL_TARGET_LENGTH` (120 chars) is hard
`.slice(0, 120)`'d — unlike `prompt`/`gist`, there is no companion
`truncated` flag on a tool-call target; the string is just shortened.

`filesTouched` is the turn's deduped, insertion-ordered list of *file*
targets only (from the `file_path`/`notebook_path` branches above), built
from a `Set` as calls are recorded. Because it's populated in the same
"only if under the cap" branch as `toolCalls`, a file-tool call that lands
past the 40-call cap is **not** added to `filesTouched` either, even though
it was still counted in `toolCallsTotal`.

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

**Since the M4 follow-up**, both fields also fold in usage summed from the
real `subagents/agent-<agentId>.jsonl` sidecar files described below (see
"Real subagent files" under `subagents: SubagentSummary`) — read `subagentUsage`
as "sidechain-derived usage plus real-subagent-file-derived usage", not
sidechain-only. This combine happens fresh on every read
(`transcript-index.ts`'s `combineUsage`, called from `toSummary`) from two
sources that are never mutated together — the inline-scan accumulator
(`IndexState.totalUsage`/`subagentUsage`, populated only by JSONL lines in the
*main* transcript file) and a sum freshly recomputed each call from
`IndexState.subagentIndex` (populated only from bytes in the sibling
`subagents/` files) — so calling `getSummary` twice with no intervening scan,
or scanning when nothing changed, never re-adds either source. The two
sources are sums over disjoint bytes on disk, so combining them by addition
cannot double-count the same event; the one case that could plausibly look
like an overlap — a subagent whose `toolUseId` is *also* tracked by the
main-chain running heuristic (see `running` below) — still contributes its
file-derived usage exactly once, because `RunningSubagent` carries no usage
figure of its own to add (pinned by a regression test in
`transcript-index.test.ts`, describe block "real subagent visibility via
subagents/ directory (M4 follow-up)").

Note: `message.usage.iterations` is present on nearly every assistant line,
but it is always length 1 and identical to that message's top-level usage
fields — it is **not** a per-call/per-line breakdown, and must not be used to
attribute usage within a multi-line message.

This dedup state (`message.id` → whether its call/usage has been counted) is
kept in memory for the life of the indexed file and never evicted — on the
order of a thousand distinct assistant message ids for a large real
transcript, each a small fixed-size entry. It must live on `IndexState` rather
than inside a single parse run: the indexer is incremental, the poll interval
is short, and a writer emits one line per content block, so a multi-line
message routinely straddles a poll boundary and its later lines are parsed
with the earlier ones' state already committed. Scoping the map to one parse
run would silently restore the per-line double count.

Bounding it, honestly: that "thousand entries" figure is per transcript, and
`TranscriptIndexCache` holds one `IndexState` per `sessionId` it has ever been
asked about — including dead sessions, since callers pass `includeDead: true`
— and never evicts an entry. So the real ceiling is a thousand entries times
however many sessions the process has seen since it started, not a thousand
overall. Every other field on `IndexState` is either O(1) or explicitly capped
(`recentTurns` by `MAX_FLOW_TURNS`, `pendingSubagents` by
`MAX_RUNNING_SUBAGENTS`); this is the first that grows with transcript length,
so it makes the missing session-level eviction matter in a way it did not
before. The session cache's unbounded growth is pre-existing and out of scope
here; capping it (the `MAX_RUNNING_SUBAGENTS` eviction is a usable template)
is the fix, not capping this map.

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
running, agents }`:

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
     `description`, `spawnDepth`, `toolUseId`) — **read since the M4
     follow-up**, see "Real subagent files" immediately below. In practice
     this still means `sidechainLineCount` stays `0` on any transcript
     produced by these CLI builds even though real subagent activity
     happened — that specific anonymous counter is not backfilled from the
     sidecar files, only `agents`/`subagentUsage`/`totalUsage` are.

### Real subagent files: `subagents/agent-<agentId>.jsonl` + `.meta.json`

Read by `server/src/subagent-index.ts`, a self-contained module with no
import in either direction to/from `transcript-index.ts` (they share only
the `streamAppend` byte-offset scanner from `jsonl-stream.ts`). For a
transcript at `<dir>/<sessionId>.jsonl`, the sibling directory is
`<dir>/<sessionId>/subagents/`; every `agent-<agentId>.jsonl` found there
(matched by filename, not by directory listing order) is scanned
incrementally the same way the main transcript is — byte-offset resumption,
one JSON-parsed line at a time, usage folded once per distinct
`message.assistant` `id` (the identical multi-line-message dedup rule
documented above, applied independently per agent file).

Each `agent-<agentId>.jsonl` is paired with an `agent-<agentId>.meta.json`
carrying exactly four keys:

| Key | Type | Notes |
|---|---|---|
| `agentType` | `string` | the dispatched subagent's type/persona |
| `description` | `string` | the one-line task description passed to the dispatch |
| `spawnDepth` | `number` | how many levels of subagent nesting deep this dispatch is |
| `toolUseId` | `string` | the **join key** — matches the `id` of the `tool_use` block in the *main chain* that dispatched this subagent (the same id `RunningSubagent.toolUseId`/`subagents.running[].toolUseId` tracks) |

`subagents.agents: SubagentAgentSummary[]` is one entry per discovered
`agent-<agentId>.jsonl`, sorted by `agentId`:
`{ agentId, agentType, description, spawnDepth, toolUseId, usage, running }`.
`agentType`/`description`/`spawnDepth`/`toolUseId` are `null` when the
`.meta.json` is missing, unreadable, malformed JSON, not an object, or has
the wrong type for that key — the `.jsonl` file is still scanned and
reported regardless (a subagent is never dropped just because its meta
sidecar is broken or hasn't been written yet). `usage` is `null` until at
least one qualifying assistant usage has been seen in that agent's own
file, same convention as `totalUsage`/`subagentUsage`. `running` is `true`
exactly while `toolUseId` (from `.meta.json`) still has an unresolved entry
in the main-chain running heuristic (`state.pendingSubagents`) — i.e. no
`tool_result` matching that dispatch has arrived yet in the main transcript;
it's independent of whether the agent's own `.jsonl` file is still growing.
A finished subagent whose dispatch was never seen as pending in the main
chain at all (older transcript, or the dispatch predates this scanner having
run) is still reported, just with `running: false`.

Degrades to an empty `agents: []`, never throwing, when: the `subagents/`
directory doesn't exist yet (older CLI build, or this session hasn't
dispatched a subagent yet); an individual `agent-<agentId>.jsonl` disappears
mid-scan; a line fails to parse (including a half-written trailing line, the
same tolerance as the main transcript); or `readdir`/`stat` fails for any
other reason. Each agent file's meta lookup and content scan degrade
independently — a broken sidecar for one agent never affects another's
entry.

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
`getDetailSummary`. Per-turn text inside `recentTurns[]`/`turns[]` is
always rendered at 400 chars, no matter which accessor produced it —
`toSummary()` passes `SUMMARY_TEXT_LIMIT` to `turnToSummary()`
unconditionally and never forwards its own `textLimit` argument, and
`toFlowSummary()` (the `/flow` payload) does the same: it doesn't take a
`textLimit` parameter at all and always passes `SUMMARY_TEXT_LIMIT`. So
neither `/detail` nor `/flow` gives you longer per-turn prompts than the
plain session list does. The raw 2000-char capture is retained in state, so
surfacing more per turn is a one-line change, but no caller gets it today.

The scanner holds a single ring buffer (`state.recentTurns`) capped at
`MAX_FLOW_TURNS` (100 entries, oldest dropped first); each turn's `index`
counts across the *whole* transcript and is never reset — so once a
transcript has more than 100 turns, the buffer's oldest retained turn no
longer has `index: 0`. `GET /api/sessions/:id/detail`'s `recentTurns` field
only ever exposes the *last* `MAX_RECENT_TURNS` (20) turns of that buffer
(`state.recentTurns.slice(-MAX_RECENT_TURNS)`); `GET /api/sessions/:id/flow`
exposes the whole retained buffer instead, oldest first — see
`docs/API.md` for both response shapes.

### Flow payload (`FlowSummary`, `GET /api/sessions/:id/flow`)

```ts
{
  turnCount: number;          // state.turnCount — total turns ever seen,
                               // including any since evicted from the buffer
  retainedTurnCount: number;  // state.recentTurns.length — <= MAX_FLOW_TURNS (100)
  turnsDropped: boolean;      // turnCount > retainedTurnCount
  turns: TranscriptTurn[];    // state.recentTurns, oldest first, unsliced
}
```

`turns` is the entire retained ring buffer (up to 100 entries), not just the
last 20 `/detail` exposes — so a transcript with, say, 60 turns returns all
60 via `/flow` but only the most recent 20 via `/detail`. Each entry is the
same `TranscriptTurn` shape documented above (`prompt`/`gist` truncation,
the tool-call cap, `filesTouched`), oldest-first, matching `recentTurns`'
own insertion order rather than being reversed.

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
