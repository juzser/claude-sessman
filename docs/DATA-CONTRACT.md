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
| `isSidechain: true` (any `type`) | excluded | only the `lastEntryAt` update above applies; no turn, gist, usage, or tool count |
| `type: "user"`, `isMeta: true` | excluded | skipped entirely (checked after the sidechain check) |
| `type: "user"`, `message.content` is a `string` (empty included — the code does not special-case `""`), or an array with ≥1 `{type:"text", text:string}` block | new turn | increments `turnCount`; opens a new entry in `recentTurns` with this text as `prompt` and `at: timestamp` |
| `type: "user"`, content is tool-result-only, image-only, or otherwise has no text | not a turn | no-op beyond the `lastEntryAt` update |
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
check: that check returns early, so a sidechain assistant line updates
neither, per the table above.

`TokenUsage` is read from `message.usage`'s snake_case fields, each
defaulting to `0` if missing or non-numeric:

```ts
inputTokens         // usage.input_tokens
outputTokens        // usage.output_tokens
cacheReadTokens      // usage.cache_read_input_tokens
cacheCreationTokens  // usage.cache_creation_input_tokens
contextTokens        // inputTokens + cacheReadTokens + cacheCreationTokens
```

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
