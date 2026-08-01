import { cva, type VariantProps } from "class-variance-authority"

// Dark-mode contrast fix: the literal `bg-primary text-on-primary` recipe
// measures 3.68:1 in dark mode (AA fail for normal text — see
// docs/DESIGN.md "Known deviations"). `--ds-info-bold` (#2563eb) measures
// 5.17:1 / 6.01:1 / 7.05:1 default/hover/pressed, all AA. Same convention
// used for Lozenge's `solid` variant.
export const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-control text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-on-primary hover:bg-primary-hover active:bg-primary-pressed dark:bg-info-bold dark:hover:bg-info-bold/90 dark:active:bg-info-bold/80",
        outline: "border border-line bg-transparent text-fg hover:bg-surface-sunken",
        secondary: "bg-surface-sunken text-fg hover:bg-surface-sunken/80",
        ghost: "bg-transparent text-fg hover:bg-surface-sunken",
        destructive: "bg-danger-bold text-on-bold hover:bg-danger-bold/90",
        link: "text-link underline-offset-4 hover:underline",
        inverse: "bg-surface text-fg hover:bg-surface/90",
        "inverse-ghost": "bg-transparent text-fg-inverse hover:bg-white/10",
      },
      size: {
        default: "h-control px-3",
        xs: "h-control-sm px-2 text-xs",
        sm: "h-control-sm px-2.5",
        icon: "size-control",
        "icon-xs": "size-control-sm",
        "icon-sm": "size-control-sm",
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
