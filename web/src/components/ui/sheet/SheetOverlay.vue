<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { DialogOverlay, type DialogOverlayProps } from "reka-ui"
import { cn } from "@/lib/utils"

// Note: upstream ships enter/exit fade classes here that require
// `tw-animate-css`, a dependency this repo deliberately does not add
// (see docs/DESIGN.md "Known deviations"). Omitted rather than shipped inert.
const props = defineProps<DialogOverlayProps & { class?: HTMLAttributes["class"] }>()
</script>

<template>
  <DialogOverlay
    data-slot="sheet-overlay"
    v-bind="props"
    :class="cn('fixed inset-0 z-50 bg-black/10 supports-backdrop-filter:backdrop-blur-xs', $props.class)"
  />
</template>
