import { cva, type VariantProps } from "class-variance-authority"

// Hand-built: shadcn-vue has no dedicated Icon primitive either — its own
// convention is to import a lucide icon component directly wherever one is
// needed. This wrapper exists so every icon in this repo renders at one of
// a small set of token-driven sizes instead of each call site inventing its
// own `size-*`/`h-*`/`w-*` value. See docs/DESIGN.md "Known deviations".
export const iconVariants = cva("inline-block shrink-0", {
  variants: {
    size: {
      xs: "size-3",
      sm: "size-3.5",
      default: "size-4",
      md: "size-5",
      lg: "size-6",
    },
  },
  defaultVariants: {
    size: "default",
  },
})

export type IconVariants = VariantProps<typeof iconVariants>

export { default as Icon } from "./Icon.vue"
