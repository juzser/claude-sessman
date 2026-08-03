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
- `App.vue` — root state (sessions, query/sort, expanded session + turn, 1s clock) and the two-column shell: session grid on the left, aggregate rail on the right
- `components/` — `SessionCard.vue` (one live session: avatar, status Lozenge, description, turn strip), `TurnStrip.vue` (the card's three most recent turns, left to right), `SessionFlowSheet.vue` (owns the `/flow` fetch and the Sheet chrome), `SessionFlowView.vue` (Vue Flow rendering, presentational only), `AggregatePanel.vue` → `TokenUsageRailCard.vue` + `RunningSubagentsRailCard.vue` (the right rail), `ConnectionLozenge.vue`, `FocusButton.vue`, `ThemeToggle.vue`
- `components/ui/` — the vendored design-system primitives; see `docs/DESIGN.md` for the closed set and what deviates from the master
- `composables/` — `useSessions.ts` (initial fetch + WS subscribe), `useAggregateUsage.ts` (folds the same session list into the rail's totals, never re-fetching)
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

## UI rules (Hans Design System — variant `dashboard`)

Hard rules — violating any of these is a review blocker, not a style nit.
Full detail (declarations, primitive inventory, lozenge mapping, reference
pages, known deviations) lives in `docs/DESIGN.md`; this section is the
enforcement surface an agent always has in context when touching `web/`.
This adoption is infrastructure-only so far (tokens + gates land in this
PR); no existing screen has been restyled yet, so several rules below
describe the target state, not `web/`'s current contents — `docs/DESIGN.md`'s
"Known deviations" tracks exactly where the gap is.

1. **Tokens only.** Colors, radii, shadows, control sizes and type roles come
   from `web/src/styles/hds-tokens.css` utilities (`bg-surface`,
   `text-fg-subtle`, `border-line`, `rounded-control`, `h-control`,
   `bg-success-subtle`, `text-body` / `text-caption` / `text-card-title` /
   `text-section` / `text-page-title` / `text-hero`...). Never raw hex, never
   Tailwind palette classes (`bg-slate-100`), never arbitrary values
   (`w-[437px]`, `text-[13px]`), never a raw size class where a type role
   exists. Never edit token values in this repo — the master copy lives in
   the design system.
2. **Closed component set.** Build only from the primitives inventoried in
   `docs/DESIGN.md` (currently empty — nothing has been vendored yet).
   Missing something → vendor from shadcn-vue + add to the inventory in the
   same PR. Never hand-roll a lookalike, never add a UI dependency — icon
   pack, chart library, date picker, animation library — without the
   operator's explicit OK.
3. **Every page instantiates one layout template**, as recorded in
   `docs/DESIGN.md`. Template 5 (dashboard overview, ± rail) belongs to
   `variant: dashboard`, defined in `layouts-dashboard.md`. At most one
   `Highlight` per page, and exactly one `<h1>`. No freeform page
   structures. When in doubt, copy the reference page, don't improvise.
4. **Three mandatory states.** Every remote-data surface implements and
   tests loading (skeleton), error (banner + a wired Retry), and empty
   states. Empty means the fetch succeeded and returned nothing — falling
   back to it on failure is a silent degrade, and there is no best-effort
   tier.
5. **No dead state.** Every exposed composable state (`error`, `saving`, ...)
   is rendered somewhere and covered by a test.
6. **Race-guard mutations.** Disable the firing control while in flight AND
   early-return guard in the action itself.
7. **Both themes.** Verify light and dark in a real browser before calling
   UI work done. No `dark:` overrides against raw colors.
8. **One density — this repo's variant's.** `p-6` page padding, `gap-6`
   section gaps, 32px controls (`h-control`), 14px body, auto-height `py-*`
   card rows in two sanctioned steps, `text-card-title` card titles. Never
   run two densities in one repo.
9. **One UI language: English.** No mixed-language surfaces.
10. **Destructive actions** go through AlertDialog naming the exact object;
    feedback follows the fixed channel mapping in `docs/DESIGN.md` (inline
    for validation, banner for failures, toast only for success/background).
    N/A today — sessman has no destructive action.
11. **Reference pages win.** `docs/DESIGN.md`'s Reference pages table is
    normative once populated — when a rule and a reference seem to
    conflict, flag it; never silently invent a third way.
12. **Run the design gates before calling UI work done** and report their
    real output: `npm run design:gate` (hardcode lint + no-emoji, from
    `scripts/design/`) and `npm run design:contrast -- "#fg" "#bg"` for any
    new color pairing. There is no adherence-lint script in this repo — see
    `docs/DESIGN.md`'s "Gates wired" section for why it can't be wired here.
    Never state a contrast ratio or "WCAG pass" you did not measure this
    way. Zero emoji in new/changed UI, code, and copy — the pre-existing
    findings tracked in `docs/DESIGN.md` are a known, separate deviation; do
    not extend that exception to new code.
13. **8-state completeness.** Interactive components account for default,
    hover, focus, active, disabled, loading, error, selected — mark N/A
    explicitly in the PR when a state doesn't apply.
14. **Illustrations are rationed.** Not used in this repo today. If ever
    introduced: only the Open Doodles, two per page maximum, never at the
    same size, never on a data card or error screen.
15. **Charts are token-driven.** Not used in this repo today. If ever
    introduced: inline SVG from `--ds-chart-1..8`, capped at 8 series, never
    reused for status.

## Gotchas

- `procStart` (registry, UTC ctime string) vs. `ps -o lstart` (local time, no marker) — compared via `ctime.ts`/`pid-reuse.ts`, which parse each in its own source timezone. A naive string comparison misfires by exactly the local UTC offset. See `docs/DATA-CONTRACT.md`.
- `fs.watch` misses changes on macOS in some cases; `watcher.ts` always also runs a 2s poll fallback, which doubles as the session-liveness recheck.
- Transcripts can reach tens of MB; never read one whole — `transcript-index.ts` scans incrementally by byte offset and never re-reads already-consumed bytes.
- "Focus tab" only supports Apple's `Terminal.app` (looks up the tab by `tty of t`); other terminal emulators (iTerm2, etc.) return a "could not focus" error instead of switching tabs.
