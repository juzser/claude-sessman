# CLAUDE.md

Guidance for AI agents (and humans) working in this repo.

## What this is

`claude-sessman` — local web dashboard showing all currently-running Claude Code CLI sessions on this machine. Node 22 + TypeScript monorepo (npm workspaces): `server/` (Hono + `ws`, reads `~/.claude/sessions` and `~/.claude/projects/**/*.jsonl`, does the enrichment) and `web/` (Vue 3 + Vite + Tailwind card grid + detail drawer).

Reads local files only, binds to `127.0.0.1` only, sends nothing anywhere — see "Safety invariants" before touching anything security-relevant.

## Sequencing

- **M1** — session registry parsed/enriched, card grid.
- **M2 (done)** — transcript tail/index, detail drawer, "focus tab" action.
- **M3 (done)** — prompt-turn flow graph (Vue Flow) via `GET /api/sessions/:id/flow`, deterministic summaries only, no LLM calls yet.
- **Phase 2** — tmux relay (`send-keys`/`capture-pane`, xterm.js).

Full spec and decisions: `docs/ROADMAP.md`.

## Repo layout

`server/src/` (by concern):
- entry/wiring: `index.ts`, `config.ts`, `app.ts` (Hono routes + local-origin guard), `server.ts` (HTTP+WS wiring, broadcast)
- domain types: `types.ts`
- session pipeline: `registry.ts` → `enrich.ts` → `sessions-service.ts`
- process facts: `process-info.ts`, `ctime.ts`, `pid-reuse.ts`
- caches: `git-info.ts` (branch/dirty), `transcript-index.ts` (incremental JSONL scan + summary/detail), `transcript.ts` (stat-only size/mtime)
- misc: `slug.ts` (cwd → transcript path), `terminal-focus.ts` (AppleScript), `watcher.ts` (fs.watch + poll fallback)
- every non-trivial module has a colocated `*.test.ts`

`web/src/` (by concern):
- `App.vue` — root state (sessions, query/sort, selected session, 1s clock)
- `components/` — `SessionCard.vue`, `SessionDetailDrawer.vue`, `TranscriptTurnList.vue`, `SessionFlowView.vue` (Vue Flow rendering, presentational only), `FocusButton.vue`
- `composables/useSessions.ts` — initial fetch + WS subscribe
- `lib/` — pure logic + API client: `ws-client.ts`, `sessman-api.ts`, `types.ts` (duplicated from the server, see below), `status.ts`, `sort-filter.ts`, `time-ago.ts`, `path.ts`, `identicon.ts`, `transcript-format.ts`, `flow-model.ts` (pure `/flow` payload → Vue Flow nodes/edges mapping) — each with a colocated `*.test.ts`

Docs: `docs/ARCHITECTURE.md`, `docs/API.md`, `docs/DEVELOPMENT.md`, `docs/DATA-CONTRACT.md`, `docs/ROADMAP.md`.

## Commands

Run from repo root; see `docs/DEVELOPMENT.md` for the full breakdown (per-workspace scripts, vitest filters, troubleshooting).

| Command | Does |
|---|---|
| `npm install` | installs both workspaces |
| `npm run dev` | starts server (`127.0.0.1:5178`) + web (`127.0.0.1:5177`) |
| `npm test` | vitest run, server then web |
| `npm run typecheck` | `tsc --noEmit` (server), `vue-tsc --noEmit` (web) |
| `npm run build` | `tsc` build (server), `vue-tsc --noEmit && vite build` (web) |

Toolchain gotcha: this repo pins Node `22.23.1` (`.nvmrc`, ships npm 10.9.8). If a machine's `PATH` finds an older Homebrew `npm` ahead of the pinned Node's, installs/builds misbehave. Fix before running anything:

```sh
nvm use          # or, without nvm's shell integration:
export PATH="$(dirname "$(command -v node)"):$PATH"
npm --version    # must print 10.x, not 6.x
```

## Conventions

- TypeScript strict everywhere (`server/tsconfig.json`, `web/tsconfig.json`).
- Server is ESM/NodeNext — relative imports need an explicit `.js` specifier (e.g. `import { loadConfig } from "./config.js"`), even though the source file is `.ts`.
- Web is Vue 3 `<script setup>` + Tailwind utility classes; no CSS files.
- Pure logic lives in `lib/` (both workspaces) with a colocated `*.test.ts`; components/routes stay thin.
- Vitest everywhere: server env is `node` (TZ pinned to `Asia/Bangkok` — see `docs/DATA-CONTRACT.md` for why), web env is `jsdom`.
- Server and web keep separate copies of the shared domain types (`server/src/types.ts` vs `web/src/lib/types.ts`) on purpose — no build-time dependency between workspaces.

## Testing rules

- Every test uses synthetic fixtures written to a `mkdtemp` temp dir at run time (registry JSON, transcript JSONL) and cleans up in `afterEach`.
- Never assume or depend on the operator's real `~/.claude` state, real pids, or real timezone — tests must pass identically on any machine/CI.
- `server/vitest.config.ts` pins `TZ=Asia/Bangkok` deliberately — some tests are timezone-sensitive (see `docs/DATA-CONTRACT.md`).

## Privacy (public repo)

This is a public GitHub repo whose actual data source is the operator's real, private Claude Code sessions. Never commit: a real absolute path from a contributor's machine, a real session id, a real transcript excerpt, a username/hostname, or a token. Example paths in docs/tests use `~/.claude/...` or an obviously synthetic path like `/Users/dev/projects/demo-app`.

## Workflow

Side branch → PR into `master`. Never push to `master`, never force-push, never merge from an agent session — a human reviews and merges.

## Safety invariants

Do not weaken any of these without discussing it first:

- Server binds `127.0.0.1` only (`config.ts` default host, never `0.0.0.0`).
- Read-only toward `~/.claude` — nothing in this codebase ever writes there.
- No outbound network calls anywhere (only local `ps`/`git`/`osascript`).
- All non-GET routes require the local-origin guard in `app.ts`: an `X-Sessman-Client` header plus an allow-listed (or absent) `Origin` — see `docs/API.md`.
- "Focus tab" invokes `osascript` via `execFile` with the tty as its own argv element (never string-concatenated into the script); the tty is always server-resolved (never from the request body) and validated against `/^ttys\d+$/` before use.

## Gotchas

- `procStart` (registry, UTC ctime string) vs. `ps -o lstart` (local time, no marker) — compared via `ctime.ts`/`pid-reuse.ts`, which parse each in its own source timezone. A naive string comparison misfires by exactly the local UTC offset. See `docs/DATA-CONTRACT.md`.
- `fs.watch` misses changes on macOS in some cases; `watcher.ts` always also runs a 2s poll fallback, which doubles as the session-liveness recheck.
- Transcripts can reach tens of MB; never read one whole — `transcript-index.ts` scans incrementally by byte offset and never re-reads already-consumed bytes.
- "Focus tab" only supports Apple's `Terminal.app` (looks up the tab by `tty of t`); other terminal emulators (iTerm2, etc.) return a "could not focus" error instead of switching tabs.
