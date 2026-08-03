import { cva, type VariantProps } from "class-variance-authority"

// Dark-mode contrast fix: the literal `bg-primary text-on-primary` recipe
// measures 3.68:1 in dark mode (AA fail for normal text — see
// docs/DESIGN.md "Known deviations"). `--ds-info-bold` (#2563eb) measures
// 5.17:1 / 6.01:1 / 7.05:1 default/hover/pressed, all AA. Same convention
// used for Lozenge's `solid` variant.
export const buttonVariants = cva(
  // Base carries the pack's default radius (--ds-radius-lg, rounded-lg). Only
  // the 24px-tier sizes step down to --ds-radius-control below — see the
  // `size` map — matching `.hds-btn` vs. `.hds-btn--sm`/`--xs`/`--icon-sm`/
  // `--icon-xs` in the pack's Button.jsx. Each size entry sets exactly one
  // radius utility so no two conflicting `rounded-*` classes are ever present
  // at once (this repo's `cn` is a bare `twMerge` with no custom class-group
  // config, so it cannot be trusted to dedupe a non-standard radius name).
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-on-primary hover:bg-primary-hover active:bg-primary-pressed dark:bg-info-bold dark:hover:bg-info-bold/90 dark:active:bg-info-bold/80",
        outline: "border border-line bg-surface text-fg hover:bg-surface-sunken",
        // Pack's `.hds-btn--secondary` is a `--ds-neutral-subtle` ground with
        // a text-colour-only hover (no background change) — not the
        // `bg-surface-sunken` + opacity-hover pair this repo used before.
        secondary: "bg-neutral-subtle text-fg-subtle hover:text-fg",
        ghost: "bg-transparent text-fg hover:bg-surface-sunken",
        destructive: "bg-danger-bold text-on-bold hover:bg-danger-bold/90",
        link: "text-link underline-offset-4 hover:underline",
        // Ground-aware pair, mirroring the pack's `.hds-btn--inverse(-ghost)`.
        // `--ds-btn-fg` / `--ds-btn-ground` are published by `Highlight`,
        // which is not vendored in this repo, so every reference below
        // falls back to the ordinary surface/text tokens — same rendered
        // result as before, but wired through the real custom properties so
        // these variants pick up the ground automatically the day
        // `Highlight` is vendored, instead of staying hardcoded forever.
        inverse:
          "bg-[color:var(--ds-btn-fg,var(--ds-surface))] text-[color:var(--ds-btn-ground,var(--ds-text))] hover:opacity-[0.88]",
        "inverse-ghost":
          "bg-transparent text-[color:var(--ds-btn-fg,currentColor)] hover:bg-[color:color-mix(in_srgb,var(--ds-btn-fg,currentColor)_12%,transparent)]",
      },
      size: {
        default: "h-control px-3",
        xs: "h-control-sm px-2 text-xs rounded-control",
        sm: "h-control px-2.5 rounded-control",
        icon: "size-control",
        "icon-xs": "size-control-sm rounded-control",
        "icon-sm": "size-control rounded-control",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
)

export type ButtonVariants = VariantProps<typeof buttonVariants>

export { default as Button } from "./Button.vue"
