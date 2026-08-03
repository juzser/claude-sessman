# Design — claude-sessman

Implements the **Hans Design System** (master lives in a private internal
repo). Global token/layout/UX rules apply; this file adds the repo-local
specifics. On conflict, the master wins — flag the conflict, don't fork the
rule. This repo must also have a row in the master's adopters registry; the
two land together.

This PR is **primitives and first-migration**. The Tailwind v4 upgrade, the
`hds-tokens.css` copy, the `scripts/design/` gate scripts and the
`design:gate` npm script all landed earlier and are already on `master`;
this PR does not touch them. What it adds is the component layer on top:
the six runtime dependencies those components need, the full primitive set
(see "Primitive inventory" below), the `cn` helper and the `@/*` path
alias, and a migration of the app shell (`web/index.html`, `App.vue`'s root
shell, `ThemeToggle.vue`) plus two components (`FocusButton.vue`,
`SessionFlowView.vue`) to `--ds-*` token utilities and the new primitives. It deliberately does **not** restyle `SessionCard.vue`,
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
| Banner | 2026-07-31 | Vendored, tone-mapped to the two banner channels the spec defines: load failure (with Retry, in place of the data) and submit failure (atop the form). Success is **not** a banner channel — it is a Toast — so the vendored `success` tone was removed rather than shipped inert; see "Known deviations". |
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
  hardcode lint exists to flag. It does not flag it, and the reason is worth
  recording: `web/src/style.css` *is* scanned (`.css` is in the linter's
  extension set), but the shim line contains `var(--`, which the linter
  treats as proof that a line is a token reference. A hardcoded fallback
  smuggled in as the second argument of `var()` is invisible to this gate.
  **Exit condition:** remove
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

- **2026-07-31 — Banner's `success` tone removed, not vendored inert.** The
  upstream Banner ships a working `success` tone (`bg-success-subtle
  text-success` + a check icon) directly beneath a header comment reading
  "Success: reported via toast, never a banner." The master spec agrees with
  the comment, not the code: "Mutation success that stays on the page →
  Toast." Vendoring it unchanged would have left live, working code inviting
  exactly the anti-pattern its own comment warns against — and to the next
  person reaching for it, a shipped tone reads as sanctioned. The `success`
  case is dropped from `TONE_CLASSES`, `TONE_ICONS` and the `BannerTone`
  union; `Banner` had no call sites, so nothing changed behaviourally. Adding
  a Banner-success channel is a master-spec change, not a per-repo one.
  **Exit condition:** none — this repo tracks the spec, and would revert only
  if the master gains a success banner channel.

- **2026-07-31 — Three vendored primitives were short of their spec contract.
  Closed 2026-08-03, ahead of the restructure.** All three were inert (no call
  site needed the missing piece) and the recorded exit condition was "close all
  three when the restructure PR brings these primitives into real use". They
  were closed earlier instead, so the restructure builds on primitives that
  already match `profile/components.md`:
  - `Card` omitted `shadow-raised`; the spec's recipe is "hairline ring **plus**
    `shadow-raised`". Fixed, together with a ring that was
    `ring-foreground/10` — an opacity-derived value, not a token — and is now
    `ring-1 ring-line`.
  - `Button` had no `loading` prop, though the spec says "`loading` disables
    the control and spins the icon". Added: it sets `disabled` and `aria-busy`,
    swaps the slot for the spinner on icon-only sizes, and carries
    `motion-reduce:animate-none`, which the master's own `Button.jsx` does not.
  - `SheetContent`'s icon-only close button had an `sr-only` label but no
    Tooltip; the spec requires `aria-label` **and** a Tooltip. It now uses the
    same `TooltipProvider > Tooltip > TooltipTrigger as-child` composition
    `ThemeToggle.vue` already uses, with `aria-label="Close"` carrying the
    accessible name — a tooltip is not an accessible name.

  Found while closing them, and fixed in the same pass: **the `cva` size map
  aliased `sm` and `icon-sm` to the 24px tier** (`h-control-sm` /
  `size-control-sm`). `profile/components.md` puts `default`/`sm`/`icon`/
  `icon-sm` at 32px and only `xs`/`icon-xs` at 24px, and the master's own
  `.hds-btn--sm` / `.hds-btn--icon-sm` both set
  `height:var(--ds-control-height)`. So `icon-sm` sat exactly *on* WCAG 2.5.8's
  24px target floor rather than clearing it. Provenance checked before fixing:
  upstream is correct, this was a defect in the hand-written Vue port. **That
  is the whole risk of a hand-written port — no gate catches it.** The
  byte-identical check in `adopters.md` covers `tokens.css` and the gate
  scripts; a wrong token inside a `cva` map is invisible to every gate we run.

- **2026-08-03 — Remaining hand-port drift in `Button`/`Card`, deliberately not
  fixed here.** A design review comparing each vendored primitive against the
  pack *source* (not against the spec prose) surfaced five more divergences.
  None was introduced by the primitive work above, all are inert or
  near-invisible today, and each would change pixels in files the restructure
  is about to rewrite — so they are recorded rather than fixed mid-flight:
  - Base radius: `rounded-control` (6px) is applied to every size. The pack's
    `.hds-btn` base is `--ds-radius-lg` and only `sm`/`xs`/`icon-sm`/`icon-xs`
    step down to `--ds-radius-control`, so `default` and `icon` are 2px off.
  - `outline`: `bg-transparent` vs. the pack's `background:var(--ds-surface)`.
    Most visible in dark mode.
  - `secondary`: `bg-surface-sunken` + an opacity hover vs. the pack's
    `--ds-neutral-subtle` ground with a text-colour-only hover — a different
    token *and* a different hover mechanism.
  - `inverse` / `inverse-ghost`: hardcoded (`bg-surface text-fg`,
    `hover:bg-white/10`) instead of building from the ground-aware
    `--ds-btn-fg` / `--ds-btn-ground` custom properties. Inert here: `Highlight`,
    the surface that publishes them, is not vendored in this repo.
  - `Card` ring: `ring-line` (`--ds-border`) rather than the pack's
    `--ds-ring-card` composite, which `hds-tokens.css` already exposes as
    `shadow-ring-card`. Near-identical in light, slightly duller in dark.
  **Exit condition:** fold into the restructure PR, which is already rewriting
  the markup that consumes these variants.

- **2026-08-03 — `destructive` follows the profile, and the master disagrees
  with itself.** `profile/components.md` specifies a filled destructive button
  (`bg-danger-bold text-on-bold`); `hds/components/core/Button.jsx` implements
  a low-emphasis tinted one (`color-mix(in srgb, var(--ds-danger-bold) 10%,
  transparent)` on `--ds-danger-text`). This repo follows the profile, per the
  documented precedence. Recorded because it is not a port defect to fix here
  but a contradiction inside the master — the same shape as the
  primary/dark-mode contrast entry above. **Exit condition:** upstream picks
  one; this repo follows whichever survives.

- **2026-08-03 — `Sheet` has no consumer, so its dialog a11y contract is
  untested, not satisfied.** `SheetContent.test.ts` passes while reka-ui logs
  `DialogContent requires a DialogTitle` and `Missing Description or
  aria-describedby`. Those come from the test fixture mounting a bare body, not
  from the primitive: reka-ui puts the title/description obligation on the
  *consumer*, and no `.vue` in `web/src` imports `ui/sheet` yet. It is a
  fixture artifact today and a real a11y gap the moment someone wires the first
  `<Sheet>`. **Exit condition:** the first real consumer supplies a
  `SheetTitle` (visually hidden if the design has no visible one).

- **2026-07-31 — `Icon`'s size scale has no 10px step (upstream gap).**
  `ThemeToggle.vue` needs a `size-2.5` glyph, and `Icon`'s `cva` scale
  (`xs`/`sm`/`default`/`md`/`lg` = 3/3.5/4/5/6) has no step that small, so it
  and three other new call sites import the lucide component directly instead
  of routing through the `Icon` primitive as the convention asks. Reported as
  a missing step in the master's scale rather than patched around locally.
  **Exit condition:** upstream adds the step, or the convention is relaxed.

- **2026-07-31 — Real gate counts after this PR's migration.**
  `npm run design:gate` still fails, but the count dropped from this PR's
  starting baseline (130 hardcode / 17 no-emoji, both measured before any
  primitive was vendored) as the in-scope files were migrated. Current,
  honest counts, each attributed:
  - **Hardcode lint: 93 violations** (`python3 scripts/design/lint_hardcodes.py
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
    - `web/src/lib/time-ago.test.ts` no longer appears. It previously
      contributed 4 false positives — duration-string test fixtures (`"5s"`,
      `"59s"`, `"45s"`) read as styling values — which is what prompted the
      upstream fix (`juzser/hans#115`). The master's `lint_hardcodes.py` now
      skips test files by default, that script has been re-copied here, and
      the count fell 97 → 93 with no code change. The scan line now reports
      the skip explicitly (`Skipped 10 test file(s)`), so it cannot be
      misread as a clean pass.
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
  reason above), the byte-identical tokens copy, or a disclosed one-pixel
  non-token gap. **Exit condition:** the Main+Rail restructure resolves the
  four deferred files at once, by migrating them, rewriting them, or
  dropping them.
  Adherence lint is a separate, permanent gap for this repo — see the "Gates
  wired" section above, not repeated here.
