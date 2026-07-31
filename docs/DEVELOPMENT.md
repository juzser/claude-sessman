# Development

## Prerequisites

- Node **>= 22** (`package.json`'s `engines.node`; `.nvmrc` pins `22.23.1`
  exactly — `nvm use` if you use nvm).
- `npm` (workspaces: `server`, `web` — see root `package.json`).

### Toolchain gotcha

If `node`/`npm` come from `nvm` (or any manager that shims `$PATH` only in
interactive shells), some tool integrations spawn npm scripts with a `$PATH`
that doesn't include your Node install, which breaks `npx`-based tools
(`tsc`, `vitest`, `vite`, `vue-tsc`, …) resolved from `node_modules/.bin`.
Verify first:

```sh
command -v node && command -v npm
```

If either is missing or looks wrong for your shell, prefix commands with:

```sh
export PATH="$(dirname "$(command -v node)"):$PATH"
```

## Install

```sh
git clone <this-repo>
cd claude-sessman
npm install   # installs both workspaces (server, web) from the root
```

## Scripts

All root scripts fan out to both workspaces (`server/package.json`,
`web/package.json`) via `npm run <script> --workspace=<name>`.

| Root script | Does |
|---|---|
| `npm run dev` | Runs `server`'s and `web`'s `dev` scripts concurrently (`&& … & wait`), so both watch/reload at once |
| `npm run build` | `server` build, then `web` build (sequential) |
| `npm test` | `server` tests, then `web` tests (sequential) |
| `npm run typecheck` | `server` typecheck, then `web` typecheck (sequential) |

Per-workspace scripts, if you want to run just one side
(`npm run <script> --workspace=server` / `--workspace=web`, or `cd
server`/`cd web` and run directly):

| Workspace | Script | Runs |
|---|---|---|
| `server` | `dev` | `tsx watch src/index.ts` |
| `server` | `build` | `tsc -p tsconfig.build.json` |
| `server` | `start` | `node dist/index.js` (run `build` first) |
| `server` | `typecheck` | `tsc --noEmit` |
| `server` | `test` | `vitest run` |
| `web` | `dev` | `vite` (dev server at `127.0.0.1:5177`, proxies `/api` and `/ws` to `127.0.0.1:5178` — see `web/vite.config.ts`) |
| `web` | `build` | `vue-tsc --noEmit && vite build` (typecheck is part of the build, not a separate step) |
| `web` | `preview` | `vite preview` |
| `web` | `typecheck` | `vue-tsc --noEmit` |
| `web` | `test` | `vitest run` |

Dev loop: `npm run dev` from the root starts both; the web dev server proxies
API/WS calls to the server dev process, so open `http://127.0.0.1:5177`.

## Running a subset of tests

Both workspaces use Vitest; pass a file path or `-t <pattern>` through the
workspace's `test` script:

```sh
cd server && npx vitest run transcript-index      # one file (by path fragment)
cd server && npx vitest run -t "rotation"          # by test-name pattern
cd web && npx vitest run SessionDetailDrawer
```

`server/vitest.config.ts` pins the test environment's `TZ` to `Asia/Bangkok`
(UTC+7) — several `ctime.ts`/`pid-reuse.ts` tests are timezone-sensitive by
construction (see `docs/DATA-CONTRACT.md`), so don't override `TZ` when
running server tests locally or those tests may pass/fail differently than
in CI. `web`'s Vitest config runs under `jsdom`.

## Env overrides (`server/src/config.ts`)

All overridable for tests/local runs against a fixture directory instead of
your real `~/.claude`:

| Var | Default | Overrides |
|---|---|---|
| `SESSMAN_CLAUDE_DIR` | `~/.claude/sessions` | registry directory |
| `SESSMAN_CLAUDE_PROJECTS_DIR` | `~/.claude/projects` | transcripts directory |
| `SESSMAN_HOST` | `127.0.0.1` | bind address — do not set this to `0.0.0.0` in a normal run; see `CLAUDE.md`'s safety invariants |
| `SESSMAN_PORT` | `5178` | bind port |

Fixture-directory recipe (mirrors what the server test suite does): create a
temp dir (e.g. `mkdtemp`), write synthetic `<pid>.json` registry files and
matching `.jsonl` transcripts under it, then point both env vars at it:

```sh
SESSMAN_CLAUDE_DIR=/tmp/sessman-fixture/sessions \
SESSMAN_CLAUDE_PROJECTS_DIR=/tmp/sessman-fixture/projects \
npm run dev --workspace=server
```

## Test conventions

- All tests use synthetic fixtures (temp directories created per test, e.g.
  via `mkdtemp`) — never point a test at a real `~/.claude`.
- No real absolute paths, session ids, or transcript content from any real
  machine appear in test fixtures or assertions, in keeping with this being
  a public repo (see `CLAUDE.md`'s privacy section) — invent synthetic
  values instead.
- Server tests run under Node's `node` environment; web tests run under
  `jsdom` (component mounting via `@vue/test-utils`).

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `npx`/`vitest`/`tsc` "command not found" during a script | `$PATH` toolchain gotcha above |
| `web`'s dev server can't reach `/api` or `/ws` | server dev process isn't running, or is bound to a different port than `web/vite.config.ts`'s proxy target |
| `watcher.test.ts`'s debounce test fails once | known timing-sensitive flake; rerun before treating it as a regression |
| A test touches your real `~/.claude` | should never happen — if it does, treat it as a bug (missing env override in that test), not expected behavior |
