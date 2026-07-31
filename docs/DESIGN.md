# Design — claude-sessman

Implements the **Hans Design System** (master: hans repo,
`knowledge/design-system/`). Global token/layout/UX rules apply; this file
adds the repo-local specifics. On conflict, the master wins — flag the
conflict, don't fork the rule. This repo must also have a row in the
master's `adopters.md`; the two land together.

This PR is **infrastructure only**: it upgrades the toolchain and lands the
tokens and gates, but does not restyle any existing screen. `App.vue` and
its child components still use raw Tailwind palette classes
(`bg-slate-950`, `text-slate-100`, ...) exactly as before. A follow-up PR
migrates them to `--ds-*` token utilities; see "Known deviations" below for
what that PR inherits.

## Declarations

- **Variant:** `dashboard` — a single live-session card grid with a detail
  drawer is the closest fit to the dashboard variant's Template 5 family
  (`profile/layouts-dashboard.md`); there is no list/detail/form CRUD flow
  that would call for `internal-tool`.
- **Tokens copy:** `web/src/styles/hds-tokens.css`, version `3.0.0` (copied
  2026-07-31). Byte-identical to the master's `profile/tokens.css` — verified
  with `diff`, exit 0. Never edit values locally; re-copy from master.
  Additive repo-only tokens go below the file's extension-point comment and
  nowhere else; nothing has been added there yet.
- **UI language:** `English` — all existing labels/copy are already English.
- **Date format:** N/A — this repo shows relative time ("Recent activity"),
  not calendar dates.
- **Delete semantics:** N/A — sessman has no delete action; sessions
  disappear from the list when their process exits.
- **Responsive floor:** 1024px (design-system default). Unchanged by this PR.

## Primitive inventory (closed set)

Empty. This repo has no shadcn-vue and has not vendored any primitive from
`profile/components.md` yet — every element in `web/src/components/` today
is a hand-rolled `<div>`/`<button>` styled with raw Tailwind utility classes,
predating this adoption. The follow-up visual-adoption PR is expected to
vendor the first primitives (at minimum Card, Button, Badge/Lozenge for
connection state) and add rows here in the same PR that introduces them.

| Primitive | Since | Notes |
|---|---|---|
| *(none vendored yet)* | | |

## Charts and illustrations

Neither is used in this repo. No charting library, no Open Doodle SVGs.
Delete this section if a future PR still finds neither applicable, or fill
it in per `profile/charts.md` / `profile/illustrations.md` when one is
introduced.

## Gates wired

Three of the master's four gates are copied into `scripts/design/` and
wired as an npm script; the fourth (adherence lint) cannot be wired from
this repo — see the note below the table.

| Gate | Command | Wired |
|---|---|---|
| Hardcode lint | `python3 scripts/design/lint_hardcodes.py web/src` | yes |
| Contrast | `python3 scripts/design/contrast.py "#fg" "#bg"` | yes (`npm run design:contrast -- "#fg" "#bg"`) |
| No-emoji | `python3 scripts/design/check_no_emoji.py web/src CLAUDE.md docs/DESIGN.md` | yes |
| Adherence lint | `npx oxlint -c <path-to>/hds/_adherence.oxlintrc.json <src>` | no — see below |

`npm run design:gate` runs the hardcode lint and the no-emoji lint together
(both take a directory and scan it). Contrast is a per-pair check — it takes
two hex values as arguments, not a directory, so it is not part of the
combined `design:gate` run; use `npm run design:contrast -- "#fg" "#bg"`
whenever a new color pairing needs a measured ratio. Never state a contrast
ratio or "WCAG pass" that wasn't produced by this script.

**Adherence lint is not wired.** The master's guidance is "point it at the
master's config in place; do not copy it in" — that assumes the adopter repo
is co-located with `knowledge/design-system/` (true for the reference
adopter, which lives in the same monorepo as the design system).
`claude-sessman` is a separate public GitHub repo with no filesystem or
network access to that config at lint time, so there is no "in place" to
point at. This is left as an open gap rather than silently worked around by
copying the 35KB ruleset in against the master's own instruction not to.
Revisit if the master publishes the adherence config somewhere a public
adopter can actually reach it.

Both Python gates that are wired need a `python3` on `PATH`. That's not part
of this repo's own toolchain (no `.python-version`, no Python step in CI,
`engines` in `package.json` only declares Node) — it works today because
`python3` ships on every macOS and Linux dev machine and on GitHub Actions'
default runners, but it is an unmanaged, undeclared dependency. If CI ever
runs on a minimal container without `python3`, these two gates need
`actions/setup-python` (or equivalent) added explicitly.

**The two wired gates currently fail against the pre-existing UI** — this is
expected, not a regression from this PR. See "Known deviations" below for
the real output and why it's deferred rather than fixed here.

## Status → lozenge mapping (app-wide, fixed)

No Lozenge/Badge primitive is vendored yet (see "Primitive inventory"
above), so nothing in the running UI uses this mapping today —
`SessionCard.vue` shows connection state as a plain colored dot
(`bg-emerald-400`/`bg-amber-400`/`bg-slate-500`), not a lozenge. This table
records the intended mapping for when that primitive is vendored, so the
visual-adoption PR doesn't have to invent one.

The domain statuses are exactly the members of `ConnectionState` in
`web/src/lib/ws-client.ts` (`"connecting" | "open" | "reconnecting" |
"closed"`), and all four are mapped, because the socket can report any of
them:

| Domain status | Lozenge | Why |
|---|---|---|
| `connecting` | info-subtle | First connect in flight (`attempt === 0`). "Informational, in progress" - nothing is degraded yet. |
| `open` | success-subtle | Live socket. "Active, live". |
| `reconnecting` | warning-subtle | Every retry after a drop. Degraded but still trying: not `danger` (nothing has failed for good) and not `info` (it has to read differently from a first connect). |
| `closed` | neutral-subtle | `setState("closed")` is reached only from the client's own `close()`, a deliberate teardown rather than a failure, so it belongs to "default, unset" and not to `danger`. |

**Carry-forward for the visual PR.** `App.vue`'s `showDisconnectBanner`
currently treats `closed` and `reconnecting` identically ("Lost connection,
retrying"), which contradicts the `closed` row above. That is invisible
today only by coincidence: the sole `close()` call site is
`useSessions.ts`'s `onUnmounted` hook, so by the time the state is `closed`
the component tree is already being torn down and the banner never paints.
Split the two states when the banner is restyled instead of relying on that
coincidence.

## Reference pages (normative)

`dashboard`:

| Template | Reference |
|---|---|
| App shell | *(not yet built)* |
| Page shell (Template 5 wrapper) | *(not yet built)* |
| 5A — overview, stat row + rail | *(not yet built)* |
| 5B — overview, single column | *(not yet built)* |
| 6 — full-canvas (if any) | *(not yet built)* |

`App.vue` is the only page today and predates this adoption — it does not
yet follow any Template 5 structure. This table is intentionally empty; the
visual-adoption PR fills it in as it restyles `App.vue` into the first
reference page.

## Repo-specific patterns

None yet beyond what's already documented in the repo's own `CLAUDE.md`
(`composables/useSessions.ts` for the fetch+WS-subscribe pattern). Nothing
UX-relevant has been standardized beyond the master because no page has been
restyled under this design system yet.

## Known deviations

- **2026-07-31 — Tailwind v4 border-color compat shim kept.** The
  `@tailwindcss/upgrade` codemod added a compatibility block to
  `web/src/style.css`:
  ```css
  @layer base {
    *, ::after, ::before, ::backdrop, ::file-selector-button {
      border-color: var(--color-gray-200, currentcolor);
    }
  }
  ```
  Tailwind v4 changed the default border color from a fixed gray to
  `currentcolor`; this shim restores the v3 default so every existing
  border-using element keeps its current appearance. It is kept
  deliberately — this PR is visually neutral by mandate, and removing the
  shim would change every unstyled border in the app. It hardcodes a gray
  default that bypasses the design system's own border token
  (`--ds-border`/`border-line`), which is exactly the class of thing the
  hardcode lint exists to flag (and, correctly, does not flag here — the
  lint only scans `web/src`, not `style.css`). **Exit condition:** remove
  this block in the same PR that restyles `App.vue` and its components,
  once every element that relied on the implicit default gets an explicit
  `border-line` (or other token) utility instead.

- **2026-07-31 — Shadcn bridge present but unconsumed.** The bridge block
  ships in this repo's tokens file (it is part of the byte-identical master
  copy); nothing here reads it. Do not rebuild it. The
  reference adopter (hans-dashboard) absorbed most of the HDS 3.0.0 upgrade
  cost through a shadcn-vue "bridge" block in its tokens file, which maps
  shadcn's own CSS variable names (`--background`, `--primary`, ...) onto
  `--ds-*` values, plus a second `@theme inline` block turning those into
  Tailwind utilities. That block is present in the copied `hds-tokens.css`
  here too (it's part of the byte-identical master file), but nothing in
  this repo consumes it — `claude-sessman` has no shadcn-vue and its future
  primitives (per "Primitive inventory" above) will be built directly
  against `--ds-*` utilities, not through the bridge. This changes what a
  future major token bump costs here: the reference adopter can often
  absorb a bridge-side rename without touching component code, while this
  repo's components will reference `--ds-*` names directly and take the
  full diff of any renamed token. Accepted for now since there's no
  shadcn-vue to bridge from; revisit if this repo ever vendors shadcn-vue
  primitives instead of hand-rolling on top of `--ds-*`.

- **2026-07-31 — Button recipe vs. dark-mode `--ds-primary` contrast.**
  `profile/components.md`'s Button recipe specifies `bg-primary
  text-on-primary`. `hds-tokens.css`'s own comment on dark `--ds-primary`
  (`#3b82f6`) says it "is a surface/border/icon colour here, not a ground
  for white body copy — under white it measures 3.68:1" and prescribes
  `--ds-info-bold` (`#2563eb`, both themes) for a saturated ground carrying
  white text in dark mode. Independently measured with this repo's own
  copy of the contrast gate:
  ```
  $ python3 scripts/design/contrast.py "#3b82f6" "#ffffff"
  Contrast #3b82f6 on #ffffff: 3.68:1

    Normal text  AA  (4.5:1): FAIL
    Normal text  AAA (7.0:1): FAIL
    Large text   AA  (3.0:1): PASS
    Large text   AAA (4.5:1): FAIL
    UI / graphics    (3.0:1): PASS
  ```
  This confirms the token file's own claim: taken literally, the Button
  recipe ships an AA failure for normal-weight white body text in dark mode.
  Following the reference adopter's resolution of the same upstream
  contradiction: when a future Button primitive is vendored here, its dark
  variant uses `--ds-info-bold` as the filled ground, not `--ds-primary`, and
  this deviation carries forward until the master's own Button recipe is
  fixed upstream.

- **2026-07-31 — Design gates wired but not yet passing.** `npm run
  design:gate` runs today and fails against the pre-existing UI, which
  predates this adoption and has not been migrated to `--ds-*` tokens:
  - Hardcode lint: 130 violations, all raw Tailwind palette classes
    (`bg-slate-950`, `text-slate-100`, `border-amber-500`, ...) across
    `SessionCard.vue`, `TranscriptTurnList.vue`, `FocusButton.vue`, plus a
    few false-positive duration-string matches in
    `web/src/lib/time-ago.test.ts` (test fixtures like `"5s"`, not styling
    values).
  - No-emoji lint: 17 findings — mostly em-dashes in existing template copy
    (`App.vue`, `SessionCard.vue`, `SessionDetailDrawer.vue`,
    `SessionFlowView.vue`), one literal check-mark glyph in
    `FocusButton.vue`, and four decorative pictographs (a star, a
    four-pointed sparkle, a plus, and a hamburger-menu glyph) in
    `web/src/lib/identicon.ts`'s avatar glyph set. (Deliberately described
    rather than reproduced here — quoting the literal characters would trip
    this same gate against this file.)
  None of this is a regression from this PR — it is the true, pre-existing
  state of the UI, and this PR does not touch any of these files' visual
  behavior by mandate. **Exit condition:** resolved incrementally by the
  visual-adoption PR(s) that migrate each component to `--ds-*` utilities,
  replace em-dashes in UI copy, and either replace or explicitly
  `ds-allow-hardcode`-annotate the `identicon.ts` glyph set (a case worth
  deciding deliberately — those are avatar-generator glyphs, not literal
  emoji in product chrome).
  Adherence lint is a separate, permanent gap for this repo — see the "Gates
  wired" section above, not repeated here.
