# claude-sessman

A local web dashboard that shows all currently-running Claude Code CLI
sessions on this machine — one card per session, live-updating.

**Reads local files only. Binds to `127.0.0.1` only. Sends nothing anywhere.**
Everything it knows comes from files already on disk under `~/.claude/` and
from local `ps`/`git` calls against processes and repos you already have
running; there is no outbound network call anywhere in this codebase.

## Status: M1

Card grid of live sessions: name/cwd, git branch, status dot, uptime, live
"updated Ns ago", filter, sort. No embedded terminal, no message sending, no
transcript rendering yet — see `docs/ROADMAP.md` for M2 (transcript tail +
detail drawer), M3 (prompt-turn flow graph), and Phase 2 (tmux relay).

## Running it

### Toolchain gotcha: use nvm's npm, not Homebrew's

Homebrew's `npm` (6.x) cannot reliably install packages against a Node 22
runtime. This repo pins `22.23.1` via `.nvmrc` (ships npm 10.9.8). Before any
`npm` command:

```sh
nvm use          # picks up .nvmrc
# or, without nvm's shell integration:
export PATH="$(dirname "$(command -v node)"):$PATH"
```

Confirm `npm --version` is 10.x before installing — if it prints `6.x`, your
`PATH` is still finding the Homebrew shim ahead of nvm's.

### Install and run

```sh
npm install        # installs both workspaces (server/, web/)
npm run dev        # starts the server (127.0.0.1:5178) and the web UI (127.0.0.1:5177) together
```

Open http://127.0.0.1:5177 — it proxies `/api` and `/ws` to the server.

Other scripts, run from the repo root (fan out to both workspaces):

```sh
npm test           # vitest, server then web
npm run typecheck  # tsc --noEmit (server), vue-tsc --noEmit (web)
npm run build      # tsc build (server), vite build (web)
```

Env overrides for the server (mainly for pointing tests/dev at a fixture dir
instead of your real `~/.claude`):

| Var | Default |
|---|---|
| `SESSMAN_CLAUDE_DIR` | `~/.claude/sessions` |
| `SESSMAN_CLAUDE_PROJECTS_DIR` | `~/.claude/projects` |
| `SESSMAN_HOST` | `127.0.0.1` |
| `SESSMAN_PORT` | `5178` |

## Data contract

Claude Code itself writes everything this tool reads; sessman never writes
back to `~/.claude`.

**Registry** — `~/.claude/sessions/<pid>.json`, one file per session:

```json
{
  "pid": 12345,
  "sessionId": "…",
  "cwd": "/path/to/project",
  "startedAt": 1732900000000,
  "procStart": "Wed Nov 29 10:00:00 2023",
  "version": "…",
  "peerProtocol": 1,
  "kind": "…",
  "entrypoint": "…",
  "name": "optional /rename value",
  "status": "busy | idle | anything else the CLI emits",
  "updatedAt": 1732900100000,
  "statusUpdatedAt": 1732900100000
}
```

Malformed JSON, missing `name`, and unrecognised `status` values are all
handled without throwing; unrecognised status normalises to `"unknown"`.

**Transcripts** — `~/.claude/projects/<slug>/<sessionId>.jsonl`, where `slug`
is `cwd` with every `/` and `.` replaced by `-`. M1 only stats these files
(size, mtime) to show they exist — it never reads their contents. Some real
transcripts run into the tens of MB; reading one into memory just to show a
dashboard card would be wasteful and is out of scope until M2 needs an
actual tail.

**Process facts** — liveness via `process.kill(pid, 0)`, tty/start-time via
`ps -o tty=,lstart= -p <pid>`.

**PID-reuse guard, and a real timezone gotcha found while building this**:
the registry's `procStart` is a ctime-style string rendered in **UTC**, with
no timezone marker — but a live `ps -o lstart` query on the same machine
renders in **local time**. Naively comparing the two strings misfires by
exactly the local UTC offset (verified here on a UTC+7 machine: a genuinely
alive process's live `lstart` looked "wrong" by 7 hours against its own
registry `procStart` until this was accounted for). `server/src/ctime.ts` and
`server/src/pid-reuse.ts` parse each string in its actual source timezone
before comparing, and report `"match" | "mismatch" | "unknown"` rather than
a boolean, since a missing/malformed `procStart` is a real, distinct case
from a confirmed mismatch.

## Privacy

This is a public repo; the tool's actual data source is your real running
sessions. No transcript excerpts, real cwd/session-name values, or tokens
are ever committed here — every test fixture is synthetic data a test
writes into a temp directory at run time and cleans up afterward.
