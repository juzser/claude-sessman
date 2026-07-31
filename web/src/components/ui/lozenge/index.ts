import { cva, type VariantProps } from "class-variance-authority"

// Hand-built: no shadcn-vue equivalent exists for this primitive. Ported
// from the upstream design system's Lozenge reference component,
// translated to this repo's cva + cn() conventions.
//
// The `solid` variant's literal recipe (bg-primary/text-on-primary)
// measures 3.68:1 in dark mode — AA fail for normal text (same defect as
// Button's `default` variant; see button/index.ts and docs/DESIGN.md
// "Known deviations"). Fixed the same way: dark:bg-info-bold.
export const lozengeVariants = cva(
  "inline-flex items-center gap-1 whitespace-nowrap rounded-pill px-2 py-0.5 text-xs font-medium",
  {
    variants: {
      tone: {
        neutral: "",
        info: "",
        success: "",
        warning: "",
        danger: "",
        discovery: "",
      },
      variant: {
        subtle: "",
        bold: "",
        outline: "border border-line bg-transparent text-fg",
        solid: "bg-primary text-on-primary dark:bg-info-bold dark:text-on-bold",
      },
    },
    compoundVariants: [
      { tone: "neutral", variant: "subtle", class: "bg-neutral-subtle text-neutral" },
      { tone: "info", variant: "subtle", class: "bg-info-subtle text-info" },
      { tone: "success", variant: "subtle", class: "bg-success-subtle text-success" },
      { tone: "warning", variant: "subtle", class: "bg-warning-subtle text-warning" },
      { tone: "danger", variant: "subtle", class: "bg-danger-subtle text-danger" },
      { tone: "discovery", variant: "subtle", class: "bg-discovery-subtle text-discovery" },
      { tone: "neutral", variant: "bold", class: "bg-neutral-bold text-on-bold" },
      { tone: "info", variant: "bold", class: "bg-info-bold text-on-bold" },
      { tone: "success", variant: "bold", class: "bg-success-bold text-on-bold" },
      { tone: "warning", variant: "bold", class: "bg-warning-bold text-warning-on-bold" },
      { tone: "danger", variant: "bold", class: "bg-danger-bold text-on-bold" },
      { tone: "discovery", variant: "bold", class: "bg-discovery-bold text-on-bold" },
    ],
    defaultVariants: {
      tone: "neutral",
      variant: "subtle",
    },
  },
)

export type LozengeVariants = VariantProps<typeof lozengeVariants>

export { default as Lozenge } from "./Lozenge.vue"
