# Architecture

## Data flow

```
~/.claude/sessions/*.json          ~/.claude/projects/<slug>/<id>.jsonl
        │                                       │
        ▼                                       ▼
  registry.ts                          transcript.ts (stat only: size/mtime)
  (parse + validate)                   transcript-index.ts (incremental JSONL scan)
        │                                       │
        ▼                                       │
  enrich.ts ◄──────────── git-info.ts ──────────┤
   (per session:                (per cwd:            (per session:
    liveness, pid-reuse,         branch/dirty,         turn/gist/usage
    tty, uptime)                 cached)                summary, cached)
        │
        ▼
  sessions-service.ts (getSessions: enrich all, filter to alive unless includeDead)
        │
        ├─ GET  /api/sessions              ──► web: useSessions() initial load
        ├─ GET  /api/sessions/:id/detail   ──► (no web consumer today, see docs/API.md)
        ├─ GET  /api/sessions/:id/flow     ──► web: SessionFlowSheet fetch → flow-model.ts → SessionFlowView.vue
        ├─ POST /api/sessions/:id/focus    ──► web: FocusButton
        └─ WS   /ws  (broadcast on change) ──► web: ws-client (reconnect + backoff)
                    ▲
                    │ triggers a fresh getSessions() + broadcast
             watcher.ts (fs.watch + 2s poll, both debounced together)
                    │
        watches ~/.claude/sessions/ for any change
```

`app.ts`/`server.ts` and the web app never read `~/.claude` directly —
every read goes through `registry.ts`/`transcript.ts`/`transcript-index.ts`.

## Module responsibilities

`server/src/`:

| Module | Responsibility | Invariant |
|---|---|---|
| `config.ts` | env → `AppConfig` | host defaults `127.0.0.1`, never `0.0.0.0` |
| `registry.ts` | parse `~/.claude/sessions/*.json` | never throws; a bad file is skipped, not fatal |
| `process-info.ts` | live pid → tty/lstart, liveness | `ps`/`kill(pid,0)` only, no writes |
| `ctime.ts` | ctime string → epoch ms | caller must state UTC vs. local explicitly |
| `pid-reuse.ts` | compare recorded vs. live start time | returns `"unknown"`, never guesses |
| `git-info.ts` | per-cwd branch/dirty, cached | never blocks the caller (see below) |
| `transcript.ts` | stat a transcript file | never reads its contents |
| `transcript-index.ts` | incremental JSONL scan → summary | never re-reads consumed bytes (see below) |
| `summarizer.ts` | summarization backend contract + `NullSummarizer` | every implementation must resolve `null` on failure, never throw |
| `ollama-client.ts` | HTTP client for Ollama's `/api/generate` | only ever calls the configured loopback URL (`127.0.0.1:11434` by default); never throws |
| `ollama-lifecycle.ts` | probe/spawn/stop the `ollama serve` process | only kills a child it spawned itself, never an operator-started instance |
| `summary-cache.ts` | on-disk per-turn summary cache | keyed by `(sessionId, turnIndex)`; a `null` result is never persisted |
| `slug.ts` | cwd → transcript path | pure, no I/O |
| `enrich.ts` | fold the above into `EnrichedSession` | runs process-info + transcript stat concurrently (`Promise.all`) |
| `sessions-service.ts` | the one shared read path | same function backs REST and WS, so they can't disagree |
| `terminal-focus.ts` | AppleScript-driven tab focus | tty passed as its own `execFile` argv element, never interpolated into script text |
| `watcher.ts` | detect registry changes | always polls, even if `fs.watch` works |
| `app.ts` | HTTP routes + local-origin guard | tty for focus is always server-resolved, never client-supplied |
| `server.ts` | wires HTTP + WS onto one `http.Server` | one `getSessions()` call feeds every push |

`web/src/`: see `CLAUDE.md`'s repo layout table; state ownership is covered
below rather than repeated here.

## Caching contract: stale-while-revalidate

`GitInfoCache` (`git-info.ts`, TTL 5000ms) and `TranscriptIndexCache`
(`transcript-index.ts`, TTL 1000ms) share one shape, even though they cache
different things. Any change to either must preserve this decision tree —
it's what makes `getSessions()` non-blocking regardless of how slow `git`
or a transcript scan is:

1. **No entry yet** for this key → kick off a background refresh, return
   `null` immediately (nothing known yet).
2. **Entry exists, still within the TTL** → return the cached value as-is;
   no refresh triggered.
2. **Entry exists, past the TTL, no refresh in flight** → kick off a
   background refresh (fire-and-forget), but still return the *last-known*
   value immediately — the caller never awaits the refresh.
3. **Entry exists, past the TTL, a refresh already in flight** → do not
   start a second one (deduped via a `pending` promise field); return the
   last-known value immediately, same as above.

The caller (`enrich.ts`) never `await`s either cache — both calls are
synchronous reads that happen to also (sometimes) trigger async work on the
side. A slow/hung `git` process or a multi-MB transcript scan can delay
*that key's next refresh*, never the current `/api/sessions` response.

**Retention bound.** `TranscriptIndexCache` additionally caps the number of
sessions it retains at `MAX_CACHED_SESSIONS` (50), evicting the
least-recently-*accessed* entry (not least-recently-written) once over the
cap, via a private `store()` helper that every cache write funnels through.
An entry with a refresh still in flight (`pending` non-null) is never
evicted — the cache is allowed to transiently exceed the cap rather than
drop an awaited refresh. Evicting a session's `IndexState` also drops that
session's `subagentIndex` and its per-agent `assistantMessageDedup` maps
with it, since they live inside the evicted `IndexState`; this is why
capping the outer cache is sufficient and no second eviction policy was
added for those inner maps. `GitInfoCache` has no such cap — it's smaller
per entry and out of scope for this change.

The cap alone isn't sufficient against a working set larger than
`MAX_CACHED_SESSIONS`, though: the registry never prunes dead sessions, and
the periodic poll/broadcast re-enriches every registry record, dead or
alive, every `pollIntervalMs` (2s — see `watcher.ts`) forever. A count-based
LRU cap facing an unbounded, always-touched working set just thrashes —
every entry evicted this tick gets re-inserted (as a miss, forcing a full
rescan) next tick, with dead entries crowding out sessions someone is
actually watching. Raising the cap only moves that threshold; idle-based
eviction doesn't help either, since a dead session touched every poll tick
never goes idle. The actual fix is at the call site, not in this cache:
`enrich.ts`'s `enrichSession` only calls into `TranscriptIndexCache` for
sessions it has already determined are alive, so a registry's dead sessions
never enter this cache via the periodic path at all — see `docs/API.md`'s
`GET /api/sessions` note and `docs/DATA-CONTRACT.md`'s `transcriptSummary`
discussion for the resulting `null` contract. With dead sessions excluded,
the real working set is an operator's live sessions — comfortably under 50
— restoring `MAX_CACHED_SESSIONS` to its intended role as a safety net
rather than the primary bound.

## Caching contract: incremental transcript scan

`transcript-index.ts`'s scan of a `.jsonl` transcript is the most
regression-sensitive piece of this codebase — a change that breaks any of
these turns an O(delta) tail into an O(file size) read on every poll tick,
against files that can reach tens of MB:

- Per-session state tracks a byte `offset` — the position immediately after
  the last complete (newline-terminated) line successfully parsed.
- A refresh only ever reads from `offset` onward
  (`createReadStream({ start: offset })`), never from byte 0, unless a
  rotation is detected (below).
- Only newline-terminated lines advance `offset`. A trailing partial line
  (no newline yet, e.g. the writer is mid-append) is buffered as `leftover`
  and left unconsumed — it's re-read whole on the next tick, never
  double-counted or parsed as if complete.
- Memory use is bounded independent of file size: at most the current
  read chunk plus one pending partial line is ever buffered.
- **Rotation** — `stats.ino !== prior.ino || stats.size < prior.offset` —
  is the *only* condition allowed to reset to `emptyState()` and rescan
  from byte 0. Anything else re-scanning from 0 is a regression.
  `transcript-index.test.ts` asserts this directly: it writes a sentinel
  value into bytes already scanned and fails if the scanner ever re-reads
  them.
- The scanner holds a single ring buffer (`state.recentTurns`) capped at
  `MAX_FLOW_TURNS` (100): pushing a 101st turn shifts the oldest out. Each
  turn's own `index` counts across the *entire* transcript and is never
  reset by the ring buffer — so the buffer's oldest retained turn no longer
  has `index: 0` once a transcript has more than 100 turns.
  `GET /api/sessions/:id/detail` (and `TranscriptSummary.recentTurns`) only
  ever exposes the *last* `MAX_RECENT_TURNS` (20) turns of that buffer;
  `GET /api/sessions/:id/flow` exposes the whole retained buffer instead.
  See `docs/DATA-CONTRACT.md` for the full line-shape contract this scan
  implements and `docs/API.md` for both response shapes.
- At most one scan is in flight per session (`pending`), so a watcher tick
  and a concurrent `/detail` request against the same session dedupe into
  one scan.

## Turn summarizer

`summarizer.ts` defines the `Summarizer` contract (`summarizeTurn`,
`summarizeSession`, `close`) and the always-safe `NullSummarizer` fallback
every implementation must degrade to on any failure — never throw.
`ollama-client.ts`'s `OllamaSummarizer` is the real backend: a thin HTTP
client over Ollama's `POST /api/generate` that likewise always resolves
`null` instead of throwing (network failure, non-2xx, timeout, or an
unparseable reply). **It is opt-in.** A default install runs
`NullSummarizer`, shows the real prompt/response text, and never spawns an
Ollama server, because keeping one resident costs memory and CPU for the
entire time sessman is up and the plain-text fallback is good enough to not
charge every operator for that by default. **`http://127.0.0.1:11434` (loopback-only) is the sole
network destination this codebase is ever allowed to call** — no other
host, and this tool never binds or calls out to anything but loopback.

Four env vars, read once by `config.ts`'s `loadConfig` (see its doc comment
there for exact defaults), select and configure the summarizer:

| Env var | Purpose |
|---|---|
| `SESSMAN_SUMMARIZER` | `"ollama"` opts in to summarization; anything else, including unset (the default), gets `NullSummarizer` with zero Ollama calls and no process spawned |
| `SESSMAN_OLLAMA_MODEL` | model name passed to Ollama's `/api/generate` (default `qwen2.5:3b`) |
| `SESSMAN_OLLAMA_URL` | Ollama base URL (default `http://127.0.0.1:11434`) |
| `SESSMAN_CACHE_DIR` | on-disk summary cache root, deliberately outside `~/.claude` (default `~/.cache/claude-sessman`) |

`ollama-lifecycle.ts`'s `startOllamaLifecycle` runs once at server startup
(`server.ts`'s `startServer`), and only when `SESSMAN_SUMMARIZER=ollama`
selected the Ollama path — on the default `"null"` config it is never called
at all, so no probe and no spawn ever happen. When it does run it is
fire-and-forget — never awaited *during startup*, so a slow or missing Ollama can never delay the HTTP/WS server
coming up. The promise it returns is retained and awaited inside `close()`,
which is what stops a shutdown racing the spawn from orphaning a
self-spawned `ollama serve`; do not "simplify" that back into reading a
variable a `.then()` assigns. It probes
`/api/tags`, and only spawns `ollama serve` itself if that probe fails. The
one hard rule governing it: **it only ever kills the child it spawned
itself.** `stop()` is a no-op if this process merely found an Ollama the
operator already had running, or if the `ollama` binary was missing
entirely (in which case it also logs once; every subsequent
`OllamaSummarizer` call against the still-unreachable server just resolves
`null`, so the net effect matches running with `NullSummarizer`).

`summary-cache.ts`'s `createSummaryCache(cacheDir)` persists successful
summaries as one JSON file per session at
`<cacheDir>/summaries/<sessionId>.json`, keyed by `turnIndex` — i.e. the
on-disk cache key is the pair **`(sessionId, turnIndex)`**, mirroring the
in-memory `MutableTurn.summary` it backs. A `null` result is never written,
so a transient failure is retried on the next refresh tick rather than
sticking forever; concurrent writes to the same session are serialized
through a per-session write-lock queue so two overlapping `summarizeTurn`
calls can't clobber each other's entries. Each session's file is pruned on
every write to the `MAX_CACHED_TURNS_PER_SESSION` (20) entries with the
highest `turnIndex`, so a long-running session's cache can't grow
unbounded — the margin above the 3-turn read window below is deliberate,
tolerating turns being summarized out of strict order without evicting one
a read still wants.

**Only the 3 most recent turns of a session ever carry a summary, and it is
never backfilled onto older turns.** This is enforced at *read* time, not
write time: `transcript-index.ts`'s `summaryWindowIndices()` recomputes the
current last-3-turn-index window fresh on every `toSummary`/`toFlowSummary`
call, so a turn that ages out of the window immediately stops exposing
whatever summary it collected earlier — it can never present a stale value
just because it used to be recent. Summarization itself happens inside the
same background refresh that already backs the stale-while-revalidate cache
above (`refreshOne` → `refreshRecentTurnSummaries`), so it inherits that
mechanism's non-blocking guarantee for free: a caller of
`getSummary`/`getDetailSummary`/`getFlowSummary` always gets the last-known
state synchronously and never waits on a summarizer call. A turn is only
ever submitted for summarization once its assistant has actually replied
(internal `gist !== null`); an in-progress turn with no reply yet is skipped
until it does. Up to 3 eligible turns per refresh tick are summarized
concurrently (`Promise.all`), not sequentially.

## Watcher, poll, and liveness model

`watcher.ts` always runs **both** an `fs.watch` listener and a poll
fallback (`setInterval`, default 2000ms, `unref()`ed so it can't keep the
process alive on its own) — `fs.watch` is wrapped in try/catch and known to
miss changes on macOS in some cases, so the poll is not optional. Both
paths funnel into one debounced `trigger()` (default 150ms), so a burst of
near-simultaneous file writes collapses into a single broadcast.

This same poll tick **doubles as the liveness recheck** the spec calls for
(`server.ts`'s comment on `startServer`): every tick re-reads the registry
and re-enriches every session from scratch, which re-derives `alive` fresh
each time. There is no separate liveness timer.

`alive` itself is `isProcessAlive(pid) && pidReuse !== "mismatch"`:

- `isProcessAlive` — `process.kill(pid, 0)`; `EPERM` still counts as alive
  (the process exists, it's just not owned by the caller).
- `pidReuse` guards against a stale registry file outliving its process: it
  compares the registry's recorded `procStart` (UTC ctime string) against a
  freshly-queried `ps -o lstart` for whatever process currently holds that
  pid (local time, no marker). `ctime.ts` parses each string in its actual
  source timezone; `pid-reuse.ts` then compares within a tolerance
  (default 2000ms) and reports `"match" | "mismatch" | "unknown"` — never
  a plain boolean, since "couldn't determine" is a distinct, real case from
  a confirmed mismatch. A `"mismatch"` means the pid now belongs to an
  unrelated process (reused by the OS since the registry file was written)
  and the session is treated as not alive even though `kill(pid, 0)`
  succeeds. See `docs/DATA-CONTRACT.md` for the full timezone analysis.

## Web-side state ownership

- **`App.vue`** owns UI-local state: filter `query`, `sortMode`, `home`
  (fetched once from `/api/health`, used only to shorten displayed paths),
  a 1s `now` tick (drives relative-time labels like "updated 3s ago"), and
  `selectedSessionId` (which session's detail drawer, if any, is open).
- **`useSessions.ts`** owns the session list and WS connection lifecycle:
  one REST fetch (`GET /api/sessions`) on mount for the initial list, then
  `createSessionSocket` opens `/ws`. Every subsequent `{type:"sessions"}`
  frame **replaces the whole list** — there is no incremental patching, so
  the WS payload is the single source of truth for "currently alive
  sessions" from the first frame onward. Reconnect/backoff state
  (`connectionState`) is separate from the session data itself; `App.vue`
  only uses it to show/hide a "lost connection, retrying…" banner.
- **`useAggregateUsage.ts`** takes the *same* session list the grid renders
  and folds it into the right rail's totals: a field-wise token sum, a
  per-model call tally, and the running-subagent list. It issues no request
  of its own, so the rail can never disagree with the cards beside it, and
  the rail costs nothing per WS frame beyond the fold.
- **`SessionFlowSheet.vue`** does **not** share the WS-fed session list for
  its flow data. Opening it (a non-null `session` prop) triggers its own
  one-shot `GET /api/sessions/:id/flow` fetch; the graph is *not* refreshed
  by later WS pushes while the Sheet stays open — only a manual "Retry"
  click, or closing and reopening it, re-fetches. This is a deliberate
  simplification (see "Known limitations" below), not an accidental
  omission. The session *header* is the exception: `App.vue` resolves the
  open session against the live list on every frame rather than capturing
  it on click, so the title, path and usage line stay current and the Sheet
  closes itself when its session ends.
  - **Stale-response guard**: `loadFlow(sessionId)` closes over the id it
    was called with; once the `await fetchSessionFlow(sessionId)` resolves,
    it checks `if (props.session?.sessionId !== sessionId) return` before
    touching any ref. This stops a slow response for a session the operator
    has since closed or switched away from from overwriting the Sheet's
    current (newer, or absent) state. `retryFlow()` additionally refuses to
    start a second request while one is in flight, so two responses cannot
    resolve out of order with the loser winning.
- **`web/src/lib/flow-model.ts`** is pure and deterministic: its
  `buildFlowGraph()` maps a `FlowSummary` payload straight to Vue Flow
  nodes/edges with no I/O and no randomness — a node's `id` and vertical
  `position` are both derived solely from that turn's own `index`, not its
  position in the `turns` array, so relayout is stable even as older turns
  age out of the server's retention window.
- **`web/src/components/SessionFlowView.vue`** is purely presentational —
  it renders whatever `flow`/`state`/`errorMessage`/`focusTurnIndex` props
  `SessionFlowSheet.vue` passes it and emits a `retry` event; it does not
  fetch anything itself and holds no stale-response guard of its own (that
  logic lives one level up, in `loadFlow()` above). It owns exactly two
  pieces of local state: which nodes the operator has expanded, and the Vue
  Flow store handle it uses to pan to `focusTurnIndex`.

## Known limitations / non-goals

- The flow Sheet's graph is a snapshot as of when it was opened, not a live
  view — it does not re-fetch on WS pushes while open.
- No auth beyond the local-origin guard (`X-Sessman-Client` header +
  `Origin` allowlist) — a defense against a random web page, not
  general-purpose auth; this is a single-user local tool by design.
- No terminal embedding or message-sending into a session — that's the
  Phase 2 tmux-relay scope (`docs/ROADMAP.md`), not implemented here.
- Server-side, the last 3 recent turns now carry a real cheap-LLM
  `summary` field (see "Turn summarizer" above), but
  `web/src/lib/flow-model.ts` does not read that field: the flow graph's
  rendered per-node content is still built straight from the deterministic
  `FlowSummary`/`TranscriptTurn` fields it already used before this field
  existed.
- "Focus tab" only supports `Terminal.app`; other terminal emulators
  return a focus-failed error rather than switching tabs (by design, not
  a bug to fix here).
- `server/src/transcript.ts`'s own doc comment is stale: it still says
  content parsing is "out of scope for M1... see M2", but M2
  (`transcript-index.ts`) already implements incremental content parsing.
  Flagged here rather than edited, since this is a documentation-only pass.
- `TranscriptSummary.complete` is hardcoded `true` on every non-null
  summary — see `docs/DATA-CONTRACT.md`'s "known gap" note.
- Closed: `/detail`'s `recentTurns[]` used to cap per-turn prompt/gist text
  at 400 chars regardless of accessor. `toSummary()` now forwards its own
  `textLimit` to `turnToSummary()`, so `/detail` gives every turn in its
  window the same 2000-char cap as its top-level fields; `/flow` is
  unaffected and still caps at 400 (see `docs/DATA-CONTRACT.md`).
- `watcher.test.ts`'s debounce test has been observed to fail once on a
  timing fluke and pass cleanly on immediate rerun; treat a single failure
  there as a flake worth rerunning, not a regression, unless it recurs.
