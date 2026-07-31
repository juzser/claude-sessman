# API reference

Server: `server/src/app.ts` (routes), `server/src/server.ts` (HTTP+WS wiring).
Base URL in dev: `http://127.0.0.1:5178` (proxied by the web dev server at
`http://127.0.0.1:5177` under `/api` and `/ws` — see `web/vite.config.ts`).

All responses are JSON. Field types below reference the shapes in
`docs/DATA-CONTRACT.md`; example values are synthetic.

## Local-origin guard

Applies to **every route except `GET`/`HEAD`/`OPTIONS`** (today, just the
`POST` focus route below). This is defense-in-depth against a random web
page driving a mutating action against a locally-running sessman server —
not general-purpose auth.

1. The request must send header `X-Sessman-Client: 1`. Missing/wrong value:

   ```
   403 { "error": "This endpoint requires the sessman client." }
   ```

2. If the request carries an `Origin` header at all, it must be one of
   `http://localhost:5177`, `http://127.0.0.1:5177`, or the server's own
   origin (`http://<config.host>:<config.port>`, passed in as
   `selfOrigin`). An `Origin` present but not in that set:

   ```
   403 { "error": "Request origin is not allowed." }
   ```

   No `Origin` header at all (e.g. a same-origin `fetch` or most non-browser
   clients) passes this check — only the client-header check applies.

## `GET /api/health`

```ts
// 200
{ ok: true, home: string }  // home = os.homedir() on the machine running the server
```

The web client uses `home` only to render `~/…/project` instead of a full
absolute `cwd`; it's the only way it learns the server's home directory.

## `GET /api/sessions`

Query: `includeDead` — pass `1` to include sessions the server considers no
longer alive; any other value (or omitted) returns alive sessions only.

```ts
// 200
{ sessions: EnrichedSession[] }
```

Same enrichment path (`sessions-service.ts` → `getSessions`) backs both this
route and the WS broadcast below, so both always agree.

## `GET /api/sessions/:sessionId/detail`

Looks the session up among **all** sessions (`includeDead: true` internally
— a session that just died is still findable here so its detail can still
be opened).

```ts
// 404 — no session with this id, dead or alive
{ error: "Session not found" }

// 200
{
  session: EnrichedSession;
  transcriptDetail: TranscriptSummary | null; // 2000-char lastUserPrompt/lastAssistantGist, not 400.
                                              // recentTurns[] stays at 400 — see docs/DATA-CONTRACT.md
}
```

## `GET /api/sessions/:sessionId/flow`

Backs the drawer's Flow tab (`SessionDetailDrawer.vue` → `SessionFlowView.vue`).
Same lookup as `/detail`: looks the session up among **all** sessions
(`includeDead: true` internally), so a session that just died is still
findable here. Being a `GET`, it is **not** subject to the local-origin
guard above.

```ts
// 404 — no session with this id, dead or alive
{ error: "Session not found" }

// 200
{
  session: EnrichedSession;
  transcriptFlow: FlowSummary | null; // null until the transcript index has completed its first scan
}
```

`FlowSummary` (`server/src/transcript-index.ts`):

```ts
{
  turnCount: number;          // total turns seen across the whole transcript,
                               // including any evicted from the retained window
  retainedTurnCount: number;  // turns.length; <= MAX_FLOW_TURNS (100)
  turnsDropped: boolean;      // turnCount > retainedTurnCount, i.e. the oldest
                               // turns were evicted from the flow window
  turns: TranscriptTurn[];    // oldest first — the whole retained ring buffer,
                               // not just the last MAX_RECENT_TURNS (20) /detail exposes
}
```

Each `TranscriptTurn` in `turns` has the same shape `/detail`'s `recentTurns[]`
uses (see `docs/DATA-CONTRACT.md`), including `toolCalls` (up to
`MAX_TOOL_CALLS_PER_TURN` = 40 entries, `{ name, target }`) and
`toolCallsOmitted` (how many further tool calls in that turn weren't recorded
individually once the cap was hit). Per-turn `prompt`/`gist` text is always
truncated at 400 chars here too — see the known gap in `docs/DATA-CONTRACT.md`.

## `POST /api/sessions/:sessionId/focus`

Subject to the local-origin guard above. The tty to focus is **always**
resolved server-side (from the session's live process info) — never taken
from the request body — so a client cannot point this at an arbitrary tty.

```ts
// 404 — no session with this id, dead or alive
{ error: "Session not found" }

// 422 — session found, but it has no resolvable/valid tty
{
  error:
    "No terminal tab could be resolved for this session (it may not be running in a tty, " +
    "or the tty could not be determined)."
}

// 502 — a tty was resolved, but the focus attempt itself failed
{ error: string } // focusRunner's own error message, or "Could not focus that terminal tab." if none

// 200
{ ok: true }
```

The 422 case also covers a tty that fails validation against
`/^ttys\d+$/` — anything `ps`/AppleScript reports that doesn't look like a
macOS Terminal tty is treated the same as "no tty". The 502 case's runner
message, when present, always names Apple Terminal-only support — see
`docs/DATA-CONTRACT.md`/`CLAUDE.md` for why (only `Terminal.app` is
supported; other terminal emulators fail here by design, not by bug).

## WebSocket: `/ws`

No subprotocol, no auth handshake (same single-user-local-tool posture as
the REST routes; not gated by the local-origin guard, since WS handshakes
are GET requests). One frame shape, sent two ways:

```ts
{ type: "sessions"; data: EnrichedSession[] } // always all currently-alive sessions
```

- **On connect**: the server immediately pushes one frame with the
  current session list (best-effort — a failure here is swallowed; the
  next watcher tick will retry, so a slow client never sees a stuck
  connection).
- **On every registry change** the watcher observes (`watcher.ts`: debounced
  `fs.watch` events, or its 2s poll fallback — see `docs/ARCHITECTURE.md`),
  the server broadcasts one fresh frame to every currently-`OPEN` client.

The web client (`web/src/lib/ws-client.ts`) reconnects on close with
exponential backoff: `delay = min(baseMs * 2**attempt, maxMs)`, defaults
`baseMs=500`, `maxMs=15000`, resetting `attempt` to `0` on a successful
`onopen`. A frame that isn't valid JSON, or doesn't match
`{ type: "sessions", data: Array }`, is silently ignored.

## `EnrichedSession` shape

Canonical definition: `server/src/types.ts` (mirrored, not imported, in
`web/src/lib/types.ts` — see `CLAUDE.md`). Synthetic example:

```ts
{
  // from the registry file (server/src/registry.ts)
  pid: 4242,
  sessionId: "8e6f9b2a-0000-4a11-9c3e-1234567890ab",
  cwd: "/Users/dev/projects/demo-app",
  startedAt: 1737000000000,
  procStart: "Wed Jan 15 09:30:00 2025", // UTC ctime string, or null
  version: "1.2.3",
  peerProtocol: 1,
  kind: "cli",
  entrypoint: "claude",
  name: null,                 // optional /rename value
  status: "busy",             // or "unknown" if missing/empty in the file
  updatedAt: 1737000090000,
  statusUpdatedAt: 1737000090000,
  sourceFile: "/Users/dev/.claude/sessions/4242.json",

  // derived (server/src/enrich.ts)
  alive: true,
  pidReuse: "match",          // "match" | "mismatch" | "unknown"
  tty: "ttys004",             // or null
  uptimeSec: 90,
  lastActivityAgoSec: 5,
  projectSlug: "-Users-dev-projects-demo-app",
  transcriptPath: "/Users/dev/.claude/projects/-Users-dev-projects-demo-app/8e6f9b2a-0000-4a11-9c3e-1234567890ab.jsonl",
  transcriptSize: 48213,       // or null if the transcript file doesn't exist (yet)
  transcriptMtime: 1737000088000,
  transcriptSummary: { /* TranscriptSummary | null — docs/DATA-CONTRACT.md */ },
  git: { branch: "main", dirty: false }, // or null (not a git repo, git missing, or any git failure)
}
```

## `null` vs. absent semantics

Every optional field is always **present with an explicit `null`**, never
omitted — the client never needs an `in`/`hasOwnProperty` check:

| Field | `null` means |
|---|---|
| `procStart`, `version`, `peerProtocol`, `kind`, `entrypoint`, `name`, `updatedAt`, `statusUpdatedAt` | missing or wrong-typed in the registry JSON file |
| `tty` | live process lookup found no tty (`ps` reported `"??"`), or the process couldn't be inspected |
| `transcriptSize`, `transcriptMtime` | the transcript file doesn't exist yet (`stat` failed) |
| `transcriptSummary` | no scan of this transcript has completed yet (first poll tick still in flight) — **not** the same as an empty transcript, which produces a real summary with `turnCount: 0` |
| `git` | `cwd` is not inside a git repo, `git` isn't installed, or any other git failure |
| `pidReuse: "unknown"` (not `null` — it's a 3-value enum, not nullable) | `procStart` or the live `ps lstart` value is missing/unparseable, so reuse can't be checked either way |

## `TranscriptSummary` usage/model/subagent aggregates (M4)

`transcriptSummary` (both here and in `EnrichedSession`) also carries
`totalUsage`, `subagentUsage`, `modelBreakdown`, and `subagents` — full
shapes, null semantics, and the `running`-subagent heuristic's failure modes
are documented in `docs/DATA-CONTRACT.md`, not repeated here. In short:
`totalUsage`/`subagentUsage` are real running sums (`null` until any
qualifying usage is seen), `modelBreakdown` is a `calls`-desc/`model`-asc
sorted array that always sums to `totalUsage`, and `subagents.running` is a
best-effort list of not-yet-resolved `Task`/`Agent` dispatches (identity
recovered from the dispatch's own `tool_use` block, not invented).

Each entry in `transcriptDetail.recentTurns`/`FlowSummary`'s turns also now
carries `continuation: boolean` — `true` for a turn whose prompt is the
auto-generated post-compaction preamble. These turns are flagged, not
dropped, so `index` stays transcript-global and monotonic (see
`docs/DATA-CONTRACT.md`).
