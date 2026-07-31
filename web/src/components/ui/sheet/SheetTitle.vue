<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { DialogTitle, type DialogTitleProps } from "reka-ui"
import { cn } from "@/lib/utils"

// Note: the upstream design system reference uses a class `cn-font-heading`
// here, which is not a real Tailwind utility — it is a silent no-op. The
// correct, generated utility is `font-heading` (see hds-tokens.css's
// `--font-heading: var(--ds-font-heading)`), used here instead. See
// docs/DESIGN.md "Known deviations".
const props = defineProps<DialogTitleProps & { class?: HTMLAttributes["class"] }>()
</script>

<template>
  <DialogTitle
    data-slot="sheet-title"
    v-bind="props"
    :class="cn('text-foreground font-heading text-base font-medium', $props.class)"
  >
    <slot />
  </DialogTitle>
</template>
