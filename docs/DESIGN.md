# Design — claude-sessman

Implements the **Hans Design System** (master lives in a private internal
repo). Global token/layout/UX rules apply; this file adds the repo-local
specifics. On conflict, the master wins — flag the conflict, don't fork the
rule. This repo must also have a row in the master's adopters registry; the
two land together.

This PR is **infrastructure and first-migration**: it upgrades the
toolchain, lands the tokens and gates, vendors the full primitive set (see
"Primitive inventory" below), and migrates the app shell (`web/index.html`,
`App.vue`'s root shell, `ThemeToggle.vue`) plus two components
(`FocusButton.vue`, `SessionFlowView.vue`) to `--ds-*` token utilities and
the new primitives. It deliberately does **not** restyle `SessionCard.vue`,
`SessionDetailDrawer.vue`, or `TranscriptTurnList.vue` — those still use raw
Tailwind palette classes (`bg-slate-950`, `text-slate-100`, ...) exactly as
before, because all three are owned by the follow-up Main+Rail restructure
task, which reshapes the same markup it would restyle. `App.vue`'s
header/input/banner/error-state chrome is deferred to that task for the same
reason. See "Known deviations" below for the exact gate counts this leaves
and what the follow-up PR inherits.

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

All 14 primitives called for by `profile/components.md` are vendored as of
this PR, at `web/src/components/ui/<name>/`. Eleven are copied in from
shadcn-vue following the reference adopter's vendoring pattern (own copy,
never a package dependency); three have no shadcn-vue equivalent and are
hand-built directly against `--ds-*` utilities instead. Vendored primitives
consume the shadcn-bridge class names (`bg-background`, `text-foreground`,
`bg-card`, `text-muted-foreground`, ...) exactly as shadcn-vue ships them —
`hds-tokens.css`'s bridge block exists precisely so vendored components can
do this unmodified; see "Known deviations" below for why an earlier draft
of this doc said the opposite.

| Primitive | Since | Notes |
|---|---|---|
| Card | 2026-07-31 | Vendored. `CardTitle`/`CardDescription` use `font-heading` in place of upstream's non-existent `cn-font-heading` class (typo fix, disclosed below). |
| Button | 2026-07-31 | Vendored. Dark-mode `default` variant uses `dark:bg-info-bold` instead of `bg-primary` (contrast fix, disclosed below). |
| Icon | 2026-07-31 | Hand-built (no shadcn-vue equivalent). `cva`-sized wrapper (`xs`/`sm`/`default`/`md`/`lg`) around any lucide icon component; every icon call site should route through it rather than importing lucide directly. |
| Lozenge | 2026-07-31 | Hand-built (no shadcn-vue equivalent). Built directly against `--ds-*` status-tone utilities per "Status → lozenge mapping" below; `solid` variant uses the same `dark:bg-info-bold` contrast fix as Button. |
| Skeleton | 2026-07-31 | Vendored, unmodified. |
| Banner | 2026-07-31 | Vendored, tone-mapped to the fixed channel set (load-failure/submit-failure/success) documented in the component's own header comment. |
| EmptyState | 2026-07-31 | Vendored, simplified: dropped the `illustration`/`illustrationSize` props (no illustration asset set exists in this repo yet; disclosed in-file). |
| Sheet | 2026-07-31 | Vendored. Enter/exit animation classes (`animate-in`, `slide-in-from-*`, ...) omitted; they require the `tw-animate-css` package, which this repo deliberately does not add (disclosed below). Sheets open/close without a slide transition as a result. |
| Switch | 2026-07-31 | Vendored, unmodified. Used by `ThemeToggle.vue`. |
| Toolbar | 2026-07-31 | Hand-built (no shadcn-vue equivalent). Built directly against `--ds-*` utilities. |
| Input | 2026-07-31 | Vendored, unmodified. |
| Tooltip | 2026-07-31 | Vendored. Same `tw-animate-css` omission as Sheet (no fade-in/zoom-in on open). Used by `ThemeToggle.vue`'s icon-only trigger. |
| RowList / Row | 2026-07-31 | Vendored at `ui/row-list/`, unmodified. Not yet consumed by any page. |
| Separator | 2026-07-31 | Vendored, unmodified. |

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
is co-located with the design system's own repo (true for the reference
adopter, which lives in the same private monorepo as the design system).
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

Lozenge is now vendored (see "Primitive inventory" above), but nothing in
the running UI uses this specific mapping yet: `SessionCard.vue` still
shows connection state as a plain colored dot
(`bg-emerald-400`/`bg-amber-400`/`bg-slate-500`), not a lozenge, because
`SessionCard.vue` is out of this PR's scope by mandate. `SessionFlowView.vue`
does use the vendored Lozenge in this PR, but for a different, unrelated
notice (how many turns were trimmed from the flow graph), not for
connection status. This table records the intended mapping for when
`SessionCard.vue` is migrated, so that follow-up PR doesn't have to invent
one.

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
(`composables/useSessions.ts` for the fetch+WS-subscribe pattern). This PR
adds one: theme persistence in `ThemeToggle.vue` resolves in the order
`localStorage` → `prefers-color-scheme` → dark fallback; any future control
that needs to read or change theme should reuse that order rather than
re-deriving it.

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

- **2026-07-31 — Correction: the shadcn bridge is consumed, on purpose.**
  An earlier draft of this entry (written before any primitive was vendored)
  said the bridge block in `hds-tokens.css` was "present but unconsumed" and
  that this repo's primitives would be built directly against `--ds-*`
  utilities instead of the bridge. That turned out to be wrong once
  vendoring actually started. `hds-tokens.css`'s own comment on the bridge's
  second `@theme inline` block says utilities like `bg-background`,
  `border-border`, and `text-muted-foreground` exist specifically so that
  "vendored shadcn-vue primitives consume these names" — that is exactly
  what the 11 vendored primitives in this PR do (`Card`, `Sheet`, `Switch`,
  `Tooltip`, and the rest use shadcn-vue's stock class names verbatim, e.g.
  `TooltipContent.vue`'s `bg-foreground text-background`). This is correct,
  not a violation: rebuilding those recipes against `--ds-*` names directly
  would just be reproducing what the bridge already resolves to, with more
  code to maintain. The distinction that does hold: the 3 hand-built
  primitives with no shadcn-vue recipe to inherit (`Icon`, `Lozenge`,
  `Toolbar`) are built directly against `--ds-*` utilities, because there is
  no vendored shadcn-vue class name for them to consume. Kept as a "known
  deviations" entry rather than deleted so the wrong initial assumption and
  its correction are both on record.

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
  contradiction, the vendored Button's dark `default` variant uses
  `--ds-info-bold` as the filled ground, not `--ds-primary` (same fix
  applied to Lozenge's `solid` variant). This deviation carries forward
  until the master's own Button recipe is fixed upstream.

- **2026-07-31 — Design gates wired; real counts after this PR's migration.**
  `npm run design:gate` still fails, but the count dropped from this PR's
  starting baseline (130 hardcode / 17 no-emoji, both measured before any
  primitive was vendored) as the in-scope files were migrated. Current,
  honest counts, each attributed:
  - **Hardcode lint: 97 violations** (`python3 scripts/design/lint_hardcodes.py
    web/src`), by file:
    - `SessionDetailDrawer.vue` (37), `TranscriptTurnList.vue` (11),
      `SessionCard.vue` (16) and `App.vue` (16, its remaining
      header/input/banner/error-state chrome) — deliberately not migrated.
      All four are owned by the follow-up Main+Rail restructure task, which
      rewrites this markup rather than merely recolouring it; the drawer and
      the turn list may not survive that restructure at all. Migrating them
      here would be work thrown away, so the restructure PR carries them.
    - `hds-tokens.css` (8) — hex/px values inside the byte-identical vendor
      copy of the master's own tokens file. Not this repo's to fix; the
      lint scans `web/src` broadly and the tokens file happens to live
      under it, but its contents are never edited locally (see
      "Declarations" above).
    - `web/src/lib/time-ago.test.ts` (4) — false-positive matches on
      duration-string test fixtures (`"5s"`, `"59s"`, `"45s"`), not styling
      values. **This is already fixed upstream** (the master's
      `lint_hardcodes.py` now skips test files), but that fix has not been
      re-copied into this repo yet; re-copying the script is a separate,
      later change. Once it lands, this repo's count drops from 97 to 93
      with no code change here.
    - `SessionFlowView.vue` (3) and `FocusButton.vue` (1) — `text-[11px]`
      hardcodes in files this PR *did* migrate. Left as-is: the nearest
      token, `text-caption`/`text-xs`, is 12px, one pixel larger, and
      swapping it would be a real (if tiny) visual change outside this
      PR's visually-neutral mandate for these two labels.
    - `TooltipContent.vue` (1) — `rounded-[2px]` on the tooltip arrow,
      copied verbatim from shadcn-vue's own stock recipe. Same reasoning as
      the two above: not worth a bespoke token for one arrow corner.
  - **No-emoji lint: 16 findings** (`python3 scripts/design/check_no_emoji.py
    web/src CLAUDE.md docs/DESIGN.md`; not part of `npm run design:gate`
    directly, since that script's `&&` chain never reaches it while the
    hardcode lint fails), by file:
    - `App.vue` (1), `SessionCard.vue` (4), `SessionDetailDrawer.vue` (5),
      `SessionFlowView.vue` (2) — em-dashes in pre-existing template copy,
      untouched by this PR for the same reasons as the hardcode-lint
      attribution above.
    - `web/src/lib/identicon.ts` (4) — decorative pictographs (a star, a
      four-pointed sparkle, a plus, and a hamburger-menu glyph) in the
      avatar glyph set. (Deliberately described rather than reproduced here;
      quoting the literal characters would trip this same gate against this
      file.) Out of scope for this PR.
    - This is one *better* than the 17-finding baseline: `FocusButton.vue`'s
      literal check-mark glyph (previously appended to its "Focused" label)
      is gone, replaced by the vendored `Icon` primitive rendering lucide's
      `Check` next to the plain text label, and the five em-dashes this PR's
      own new primitive comments introduced along the way (`ThemeToggle.vue`,
      `Banner.vue`, `SheetOverlay.vue`, `SheetContent.vue`, `SheetTitle.vue`)
      were rewritten before this count was taken.
  None of the remaining findings are a regression from this PR — each is
  either a pre-existing file this PR deliberately does not touch (with a
  reason above), the byte-identical tokens copy, a pending-but-not-yet-
  applied upstream fix, or a disclosed one-pixel non-token gap. **Exit
  condition:** the Main+Rail restructure resolves the four deferred files at
  once (by migrating them, rewriting them, or dropping them), and the
  hardcode-lint script's test-file-skip fix is re-copied from master.
  Adherence lint is a separate, permanent gap for this repo — see the "Gates
  wired" section above, not repeated here.
