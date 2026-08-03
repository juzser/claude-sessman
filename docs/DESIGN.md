# Design — claude-sessman

Implements the **Hans Design System** (master lives in a private internal
repo). Global token/layout/UX rules apply; this file adds the repo-local
specifics. On conflict, the master wins — flag the conflict, don't fork the
rule. This repo must also have a row in the master's adopters registry; the
two land together.

Adoption landed in three passes, all now complete:

1. **Infrastructure** — the Tailwind v3→v4 upgrade (forced: HDS 3.0.0's
   tokens are `@theme inline` and fail *silently* on v3), the
   `hds-tokens.css` copy, the `scripts/design/` gate scripts and the
   `design:gate` npm script.
2. **Primitives and first migration** — the runtime dependencies, the full
   primitive set (see "Primitive inventory" below), the `cn` helper and the
   `@/*` path alias, and a migration of the app shell plus `FocusButton.vue`
   and `SessionFlowView.vue` to `--ds-*` token utilities.
3. **Main+Rail restructure** — the rest. Every `.vue` under `web/src` now
   uses token utilities; no raw Tailwind palette class (`bg-slate-950`,
   `text-slate-100`, ...) survives in app code. `SessionDetailDrawer.vue`
   and `TranscriptTurnList.vue` were not migrated but **deleted** — the
   restructure replaced the drawer with a Sheet and the turn list with a
   per-card `TurnStrip.vue`, so migrating them first would have been work
   thrown away.

See "Known deviations" below for what this leaves open, with the real gate
output for each.

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

No chart is drawn and no illustration asset set exists here: no charting
library, no Open Doodle SVGs.

The **chart palette tokens are used**, though, for the one thing the token
file's own comment sanctions besides charts — `web/src/lib/identicon.ts`
derives each session card's avatar gradient from `--ds-chart-1..8`. The
comment above those tokens reads: "For charts, avatars, and other
decorative-categorical colouring — never for status semantics. Assign in
order; cap at 8 series." The avatar is decorative-categorical (it
distinguishes two sessions in the same project at a glance) and carries no
status meaning; status lives on the card's Lozenge alone. See "Known
deviations" for the AA evidence behind the gradient's darkened stop.

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

There are **two** status axes in this UI, and they must not be conflated:

| Axis | What it reports | Where it renders |
|---|---|---|
| Socket connection | Whether *the dashboard* is receiving updates | `ConnectionLozenge.vue`, once, in the header |
| Session status | Whether *one session* is working, waiting, stale or ended | `SessionCard.vue`'s Lozenge, once per card |

`SessionFlowView.vue` also uses a Lozenge, but for neither axis — it carries
a notice about how many turns were trimmed from the flow graph.

### Socket connection

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

**Closed 2026-08-03.** `App.vue` used to derive a `showDisconnectBanner`
boolean that treated `closed` and `reconnecting` identically ("Lost
connection, retrying"), contradicting the `closed` row above. That was
invisible only by coincidence — the sole `close()` call site is
`useSessions.ts`'s `onUnmounted` hook, so by the time the state was `closed`
the tree was already being torn down and the banner never painted. The
derived boolean is gone. `ConnectionLozenge.vue` renders all four states
from the table above directly, and it is **always mounted**, never `v-if`'d
away: its `aria-live="polite"` wrapper would not reliably announce a region
that appears at the same instant its text does.

### Session status

Mapped in `SessionCard.vue` from `statusVisualFor(status, alive)`:

| Domain status | Lozenge | Label |
|---|---|---|
| `busy` | warning-subtle | "Working" |
| `idle` | success-subtle | "Waiting on you" |
| `stale` | neutral-subtle | "Stale" |
| `dead` | neutral-subtle | "Ended" |

`busy` → warning and `idle` → success is a deliberate deviation from the
six-family semantics, at the operator's explicit instruction; see "Known
deviations". The tone lives on that one Lozenge — the card surface behind it
is identical for every status, so a wall of cards does not become a wall of
colour.

## Reference pages (normative)

`dashboard`:

| Template | Reference |
|---|---|
| App shell | `web/src/App.vue` — header (title, connection Lozenge, search Input, sort Button, ThemeToggle) over the page body |
| Page shell (Template 5 wrapper) | `web/src/App.vue` — the two-column grid: session cards left, `AggregatePanel.vue` rail right |
| 5A — overview, stat row + rail | `web/src/components/AggregatePanel.vue` — `TokenUsageRailCard.vue` (hero figures) + `RunningSubagentsRailCard.vue` |
| 5B — overview, single column | *(not built — there is no second page)* |
| 6 — full-canvas (if any) | `web/src/components/SessionFlowView.vue` inside `SessionFlowSheet.vue` — the Vue Flow pane is the closest thing to a full-canvas surface here, but it lives in a Sheet, not a page |

`App.vue` is still the only page. It now follows Template 5's main+rail
structure rather than the flat card list it predated this adoption with.
There is no router and no second route, so the "app shell" and "page shell"
rows point at the same file: the distinction the template draws between them
has no load to carry until a second page exists.

## Repo-specific patterns

Beyond what's already documented in the repo's own `CLAUDE.md`
(`composables/useSessions.ts` for the fetch+WS-subscribe pattern):

- **Theme persistence** in `ThemeToggle.vue` resolves in the order
  `localStorage` → `prefers-color-scheme` → dark fallback. Any future
  control that reads or changes theme should reuse that order rather than
  re-deriving it.
- **Summarized and unsummarized text share one slot.** A card's description
  takes the LLM `description` when there is one and the raw last prompt
  otherwise; the turn strip's reply line takes the LLM `response` or the raw
  gist. Same slot, same classes either way — nothing marks which of the two
  the operator is reading. This is on purpose: the summarizer is optional
  and off by default (`SESSMAN_SUMMARIZER=null`), so a visual "this was
  summarized" marker would turn a config choice into a UI inconsistency.
- **The operator's own prompt is never summarized and never re-flowed.**
  Both the turn strip and the expanded flow node render `turn.prompt.text`
  verbatim with `whitespace-pre-wrap`, so the line breaks they typed
  survive. Height is capped structurally (`line-clamp-3` in the strip, a
  `max-h-64 overflow-y-auto` region in the node) rather than by truncating
  the text. The collapsed flow node is the one exception: it shows a
  140-char single-line preview, with the whole text one click away.
- **Rail figures are folded, never fetched.** `useAggregateUsage.ts` derives
  the rail from the same session list the grid renders. Any future
  cross-session figure belongs in that composable, not in a new request —
  a second source could disagree with the cards beside it.

## Known deviations

- **2026-07-31 — Tailwind v4 border-color compat shim. Closed 2026-08-03.**
  The `@tailwindcss/upgrade` codemod had added a compatibility block to
  `web/src/style.css`:
  ```css
  @layer base {
    *, ::after, ::before, ::backdrop, ::file-selector-button {
      border-color: var(--color-gray-200, currentcolor);
    }
  }
  ```
  Tailwind v4 changed the default border color from a fixed gray to
  `currentcolor`; the shim restored the v3 default so every border-using
  element kept its appearance through the migration. It was kept while the
  primitive work was visually neutral by mandate, and its exit condition was
  "remove it in the same PR that restyles `App.vue` and its components, once
  every element that relied on the implicit default gets an explicit token
  utility instead". This is that PR, and the condition is met: every bare
  `border`/`border-b`/`border-t` utility left in `web/src` sits beside an
  explicit colour (`border-line` in `App.vue`, `SessionFlowView.vue`,
  `SessionFlowSheet.vue`, `SheetContent.vue`, `Button`, `Lozenge`;
  `border-input` in `Input.vue`; `border-transparent` in `Switch.vue`), there
  are no `<style>` blocks anywhere in the tree, and Vue Flow's own stylesheet
  is imported unlayered so `@layer base` never reached it. The block is
  deleted; a comment in its place says not to reintroduce it.

  Worth keeping on record: while it was there, the shim hardcoded a gray that
  bypassed the design system's own border token (`--ds-border`/`border-line`)
  and the hardcode lint never flagged it. `web/src/style.css` *is* scanned
  (`.css` is in the linter's extension set), but the shim line contains
  `var(--`, which the linter treats as proof that a line is a token
  reference. **A hardcoded fallback smuggled in as the second argument of
  `var()` is invisible to this gate** — an upstream blind spot that outlives
  this particular shim.

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

- **2026-08-03 — Remaining hand-port drift in `Button`/`Card`. Closed the same
  day, in this PR.** A design review comparing each vendored primitive against
  the pack *source* (not against the spec prose) surfaced five more
  divergences. None was introduced by the primitive work above; the recorded
  exit condition was "fold into the restructure PR, which is already rewriting
  the markup that consumes these variants", and that is what happened. All
  five, and what closing each one turned up:
  - **Base radius.** `rounded-control` (6px) was applied to every size; the
    pack's `.hds-btn` base is `--ds-radius-lg` and only
    `sm`/`xs`/`icon-sm`/`icon-xs` step down. The base is now `rounded-lg` and
    those four sizes carry an explicit `rounded-control`. Deliberately *not*
    left to `twMerge` to dedupe: this repo's `cn` is a bare `twMerge` with no
    custom class-group config, so it does not recognise a non-standard name
    like `rounded-control` as conflicting with `rounded-lg` — both would
    render and CSS source order would decide. Every size entry therefore sets
    exactly one radius class.
  - **`outline`.** `bg-transparent` → `bg-surface`, matching the pack's
    `background:var(--ds-surface)`.
  - **`secondary`.** `bg-surface-sunken` + an opacity hover → `bg-neutral-subtle
    text-fg-subtle hover:text-fg` — the pack's ground *and* its
    text-colour-only hover, which changes no background on hover at all.
  - **`inverse` / `inverse-ghost`.** Were hardcoded (`bg-surface text-fg`,
    `hover:bg-white/10`). `Highlight`, the surface that publishes
    `--ds-btn-fg`/`--ds-btn-ground`, is still not vendored here, so rather than
    leave them hardcoded they now read those custom properties with a fallback
    equal to the previous rendered value — `bg-[color:var(--ds-btn-fg,var(--ds-surface))]`
    and friends. Visually identical today; picks up a real ground automatically
    the day `Highlight` lands. The hover also switched from a background-opacity
    blend to the pack's plain `opacity:.88`.
  - **`Card` ring.** `ring-1 ring-line shadow-raised` → a single
    `shadow-[var(--ds-ring-card),var(--ds-shadow-raised)]`. The obvious fix —
    applying the exposed `shadow-ring-card` utility next to `shadow-raised` —
    **does not work**, and this is worth recording: both utilities write the
    same `--tw-shadow` custom property, so as two classes one silently
    overwrites the other and only CSS source order decides which. The pack's
    own recipe is one declaration with two comma-joined shadows, so that is
    what is reproduced. Both halves are still the same tokens those two
    utilities expose; no raw value is hardcoded.

  Each arbitrary value above was verified against real `vite build` output
  rather than trusted from Tailwind v4 syntax memory — including that the
  `color-mix` hover emits both a plain fallback rule and a `@supports`-gated
  enhanced one. Gate, tests and typecheck were re-measured after the change and
  are unchanged (23 files / 199 tests passing, `vue-tsc` exit 0, the same 9
  vendored-file hardcode findings recorded below). No `Button`/`Card` test
  asserted the old class strings, so no assertion needed updating — which is
  the same exposure the size-map defect above already illustrated.

- **2026-08-03 — `destructive` follows the profile, and the master disagrees
  with itself.** `profile/components.md` specifies a filled destructive button
  (`bg-danger-bold text-on-bold`); `hds/components/core/Button.jsx` implements
  a low-emphasis tinted one (`color-mix(in srgb, var(--ds-danger-bold) 10%,
  transparent)` on `--ds-danger-text`). This repo follows the profile, per the
  documented precedence. Recorded because it is not a port defect to fix here
  but a contradiction inside the master — the same shape as the
  primary/dark-mode contrast entry above. **Exit condition:** upstream picks
  one; this repo follows whichever survives.

- **2026-08-03 — `Sheet` had no consumer, so its dialog a11y contract was
  untested rather than satisfied. Closed the same day, in this PR.**
  `SheetContent.test.ts` passed while reka-ui logged `DialogContent requires a
  DialogTitle` and `Missing Description or aria-describedby`. Those came from
  the test fixture mounting a bare body, not from the primitive: reka-ui puts
  the title/description obligation on the *consumer*, and at the time no `.vue`
  in `web/src` imported `ui/sheet`. The recorded exit condition was "the first
  real consumer supplies a `SheetTitle` (visually hidden if the design has no
  visible one)". `SessionFlowSheet.vue` is that consumer and supplies both, and
  both are visible rather than hidden — `SheetTitle` carries the session name,
  `SheetDescription` its path (with the full `cwd` on the element's `title`,
  since the visible text is truncated). The fixture-level warnings in
  `SheetContent.test.ts` remain, and remain a fixture artifact.

- **2026-07-31 — `Icon`'s size scale has no 10px step (upstream gap).
  Still open, but narrower as of 2026-08-03.** `ThemeToggle.vue` needs a
  `size-2.5` glyph to sit inside the Switch thumb, and `Icon`'s `cva` scale
  (`xs`/`sm`/`default`/`md`/`lg` = 3/3.5/4/5/6) has no step that small, so its
  two lucide glyphs are rendered directly rather than routed through the `Icon`
  primitive as the convention asks. Reported as a missing step in the master's
  scale rather than patched around locally.

  The original entry also claimed "three other new call sites" did the same.
  That is no longer true and was not carried forward: `TurnStrip.vue`
  (`Maximize2`, `ChevronRight`) and `FocusButton.vue` (`Check`) all import the
  lucide component and pass it to `<Icon :icon="…" size="sm" />`, which *is*
  the convention — importing the lucide symbol is expected; bypassing the
  wrapper is not. `ThemeToggle.vue` is the only remaining bypass in app code.
  **Exit condition:** upstream adds the step, or the convention is relaxed.

- **2026-08-03 — `busy` is warning and `idle` is success, at the operator's
  instruction.** The six-family semantics would read a working session as
  "in progress" (info) and a session sitting at a prompt as unremarkable
  (neutral). This repo inverts the weight: `busy` → `warning-subtle`
  ("Working"), `idle` → `success-subtle` ("Waiting on you"). The reason is what
  the dashboard is *for* — it is scanned to answer "which session needs me
  right now", and the answer is the idle one, so idle is the state that should
  read as ready rather than as absence. Amber for busy is the complement: not a
  fault, just "do not expect an answer here yet".

  Two operator instructions pin this, both after seeing it rendered: *"Chỉ cần
  indicator đổi màu, ko cần đổi cả block session"* (only the indicator changes
  colour, not the whole session block) and *"Giữ nguyên màu hiện tại"* (keep
  the current colours). The first is the load-bearing half: because the tone is
  confined to one Lozenge and never reaches the card surface, a grid of twenty
  sessions does not become a wall of amber, which is the actual harm the
  six-family rule guards against. **Exit condition:** none while the operator
  holds this preference. Flagged, not forked.

- **2026-08-03 — Avatar gradients use the chart palette, darkened to 80%.**
  Two parts, one sanctioned and one a real deviation.

  The palette use itself is sanctioned, not a deviation: `hds-tokens.css`'s own
  comment above `--ds-chart-1..8` reads "For charts, avatars, and other
  decorative-categorical colouring — never for status semantics", and
  `lib/identicon.ts` uses them for exactly that. The avatar distinguishes two
  sessions in the same project at a glance and carries no status meaning;
  status lives on the card's Lozenge alone.

  The deviation is that the tokens are not used at full strength. Each stop is
  `color-mix(in srgb, var(--ds-chart-N) 80%, black)`, because the tile carries
  a white monogram and three of the eight swatches fail AA under white at full
  strength — and *which* swatch a session lands on is the luck of a hash, so
  it is not enough for most of them to pass. Measured with this repo's own
  contrast gate:
  ```
  $ python3 scripts/design/contrast.py "#ffffff" "#e8710a"   # chart-2
  Contrast #ffffff on #e8710a: 3.09:1
    Normal text  AA  (4.5:1): FAIL
  $ python3 scripts/design/contrast.py "#ffffff" "#0e9f6e"   # chart-3
  Contrast #ffffff on #0e9f6e: 3.39:1
    Normal text  AA  (4.5:1): FAIL
  $ python3 scripts/design/contrast.py "#ffffff" "#0891b2"   # chart-6
  Contrast #ffffff on #0891b2: 3.68:1
    Normal text  AA  (4.5:1): FAIL
  ```
  At 80% every swatch clears AA, the tightest by 0.11 (all eight measured with
  the same script, white on the mixed value): chart-1 7.24, chart-2 4.61,
  chart-3 5.01, chart-4 6.84, chart-5 7.88, chart-6 5.39, chart-7 7.07,
  chart-8 6.70. A gradient interpolated in sRGB never produces a pixel lighter
  than its lighter stop, so clearing both stops clears the whole tile — no
  mid-gradient sample can slip under. **Exit condition:** none, unless the
  master's chart palette is retuned for text-bearing grounds, which would make
  the mix unnecessary rather than merely conservative.

- **2026-07-31 — Real gate counts. Rewritten 2026-08-03 after the
  restructure.** The counts this entry used to carry (93 hardcode / 16
  no-emoji) were attributed largely to `SessionDetailDrawer.vue`,
  `TranscriptTurnList.vue`, `SessionCard.vue` and `App.vue`, deferred to "the
  Main+Rail restructure". That restructure is this PR. Two of those files no
  longer exist and the other two were rewritten, so those numbers are gone
  rather than reduced. Measured now:
  - **No-emoji lint: passes.**
    ```
    $ python3 scripts/design/check_no_emoji.py web/src CLAUDE.md docs/DESIGN.md
    Scanned 100 file(s).
    OK: no emoji in UI output or taste files.
    ```
    From a 17-finding baseline. The `identicon.ts` glyph set that contributed 4
    of them is gone: avatars are monogram-on-gradient now, no pictographs.
  - **Hardcode lint: 9 findings, every one inside a vendored file.**
    ```
    $ python3 scripts/design/lint_hardcodes.py web/src
    web/src/components/ui/tooltip/TooltipContent.vue:47: hardcoded px '2px' — use a token
    web/src/styles/hds-tokens.css:4: hardcoded hex '#2563eb' — use a token
    web/src/styles/hds-tokens.css:4: hardcoded hex '#3b82f6' — use a token
    web/src/styles/hds-tokens.css:92: hardcoded hex '#2563eb' — use a token
    web/src/styles/hds-tokens.css:227: hardcoded px '2px' — use a token
    web/src/styles/hds-tokens.css:227: hardcoded px '4px' — use a token
    web/src/styles/hds-tokens.css:227: hardcoded px '2px' — use a token
    web/src/styles/hds-tokens.css:517: hardcoded px '2px' — use a token
    web/src/styles/hds-tokens.css:521: hardcoded px '2px' — use a token

    Scanned 74 file(s). Skipped 24 test file(s) — pass --include-tests to lint them.
    FAIL: 9 hardcoded value(s). Map each to a token, or add a 'ds-allow-hardcode' comment for a justified exception.
    ```
    **Zero are in app code.** Eight are in `hds-tokens.css`, the byte-identical
    vendor copy, which this repo must never edit locally (see "Declarations");
    the ninth is `rounded-[2px]` on shadcn-vue's stock tooltip arrow. The
    standing decision is not to locally patch a copy-in file to satisfy a lint:
    a local edit is silently reverted by the next re-copy from master, which is
    strictly worse than a disclosed finding.

    Six of the eight `hds-tokens.css` findings are the linter misreading its
    own input, and the three distinct blind spots are worth naming because each
    is an upstream bug, not a token defect:
    - **Hexes inside CSS comments are flagged.** Lines 4 and 92 are prose
      explaining the dark-mode contrast rule; they mention `#3b82f6` and
      `#2563eb` as *subjects*, and no rule sets a colour there.
    - **`px` on the continuation line of a multi-line declaration is flagged.**
      Line 227 is the middle of `--ds-shadow-overlay`. The token context test
      only looks at the current line, so a declaration wrapped across lines
      loses its `--ds-*` anchor after the first.
    - **A hardcoded fallback inside `var(--token, <value>)` is *not* flagged** —
      the inverse failure, and the one that let the border-color shim sit
      unflagged for days (see that entry above).

    That leaves lines 517 and 521 as genuine raw `px` in the vendored base layer
    (`text-underline-offset: 2px`, `text-decoration-thickness: 2px`), which are
    still upstream's to fix, not this repo's.
  **Exit condition:** the app-code half is closed. What remains needs an
  upstream fix to `lint_hardcodes.py` (three blind spots) and to
  `hds-tokens.css` (two raw `px`); both are on the list to raise with the
  master. Adherence lint is a separate, permanent gap for this repo — see the
  "Gates wired" section above, not repeated here.

- **2026-08-03 — Expanded flow node uses one shared divider, not per-block
  boxes.** The spec's literal recipe for a bordered sub-block is `rounded-lg
  ring-1 ring-line bg-surface p-3`. `SessionFlowView.vue`'s expanded region
  (`border-t border-line pt-2`, around the prompt/reply pair) does not apply
  that recipe to the prompt and reply individually. The node itself is
  already a bordered, shadowed box (`rounded-lg border border-line
  bg-surface-raised ... shadow-lg`); nesting a second ring-and-background box
  for the prompt and a third for the reply inside that outer box would be
  box-in-box, not a clearer boundary. A plain top divider separates the two
  without adding that nesting. **Exit condition:** none — this is a
  deliberate simplification for this one shared container, not a drift to
  reconcile.
