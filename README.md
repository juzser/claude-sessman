# claude-sessman

A local web dashboard that shows all currently-running Claude Code CLI
sessions on this machine — one card per session, live-updating, each showing
its most recent turns, plus a flow view of a session's turn history and a
"focus tab" action.

**Reads local files only. Binds to `127.0.0.1` only. Sends nothing off this
machine.** Everything it knows comes from files already on disk under
`~/.claude/` and from local `ps`/`git`/`osascript` calls against processes and
repos you already have running. The single network destination anywhere in
this codebase is `127.0.0.1:11434` — a local Ollama, used only by the optional
turn summarizer, which is **off by default** (`SESSMAN_SUMMARIZER=null`).
Nothing is ever sent to a remote host.

## Status

- **M1** — session registry parsed/enriched, live card grid (done).
- **M2** — transcript tail/index, detail drawer, "focus tab" action (done).
- **M3** — prompt-turn flow graph, `GET /api/sessions/:id/flow` (done).
- **M4** — two-column layout, per-card turn strip, shared flow Sheet, design
  system, subagent visibility, optional local summarizer (done).
- **Phase 2** — tmux relay (not started).

Full spec and decisions: [`docs/ROADMAP.md`](docs/ROADMAP.md).

## Quickstart

Node **>= 22** required (`.nvmrc` pins `22.23.1`). If your `PATH` resolves
an older `npm` ahead of that Node install, fix it before running anything:

```sh
nvm use          # or, without nvm's shell integration:
export PATH="$(dirname "$(command -v node)"):$PATH"
```

```sh
npm install        # installs both workspaces (server/, web/)
npm run dev        # starts the server (127.0.0.1:5178) and the web UI (127.0.0.1:5177) together
```

Open http://127.0.0.1:5177 — it proxies `/api` and `/ws` to the server.

See [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) for every script, env
override, test-filtering, and troubleshooting.

## Docs

| Doc | Covers |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | Agent-facing map: layout, conventions, safety invariants, gotchas |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Request/data flow, caching contracts, watcher/liveness model, web state ownership |
| [`docs/API.md`](docs/API.md) | HTTP + WebSocket routes, request/response shapes |
| [`docs/DATA-CONTRACT.md`](docs/DATA-CONTRACT.md) | Registry + transcript JSONL field shapes, tolerances, the `procStart`/`ps lstart` timezone gotcha |
| [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) | Scripts, env overrides, test conventions, troubleshooting |
| [`docs/DESIGN.md`](docs/DESIGN.md) | Design-system adoption: tokens, the vendored primitive inventory, gate scripts, known deviations |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Milestones, what's done vs. planned |

## Data at a glance

Claude Code itself writes everything this tool reads — sessman never writes
back to `~/.claude`:

- **Registry**: `~/.claude/sessions/<pid>.json`, one file per session
  (pid, cwd, status, timestamps, …).
- **Transcripts**: `~/.claude/projects/<slug>/<sessionId>.jsonl`. Never read
  in full — `transcript.ts` only stats size/mtime, and
  `transcript-index.ts` scans incrementally by byte offset, since some real
  transcripts reach tens of MB.
- **Process facts**: liveness via `process.kill(pid, 0)`, tty/start-time via
  `ps -o tty=,lstart=`, with a PID-reuse guard comparing the registry's UTC
  `procStart` against a freshly-queried local-time `ps lstart`.

Full field-by-field contract, tolerances, and the timezone gotcha behind the
PID-reuse guard: [`docs/DATA-CONTRACT.md`](docs/DATA-CONTRACT.md).

## Privacy

This is a public repo; the tool's actual data source is your real running
sessions. No transcript excerpts, real cwd/session-name values, or tokens
are ever committed here — every test fixture is synthetic data a test
writes into a temp directory at run time and cleans up afterward.
