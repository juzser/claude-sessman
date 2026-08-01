<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { cn } from "@/lib/utils"

// Hand-built: no shadcn-vue equivalent exists for this primitive. Ported
// from the upstream design system's Toolbar reference component, translating
// its toolbar / toolbar-end / toolbar-count / toolbar-sunken CSS classes to
// Tailwind utilities via cn().
withDefaults(
  defineProps<{
    count?: number
    sunken?: boolean
    class?: HTMLAttributes["class"]
  }>(),
  {
    sunken: false,
  },
)
</script>

<template>
  <div
    data-slot="toolbar"
    :data-sunken="sunken"
    :class="
      cn(
        'flex items-center gap-3 rounded-control px-3 py-2',
        sunken ? 'bg-surface-sunken' : 'bg-surface',
        $props.class,
      )
    "
  >
    <div data-slot="toolbar-content" class="flex min-w-0 flex-1 items-center gap-3">
      <slot />
    </div>
    <span v-if="count !== undefined" data-slot="toolbar-count" class="text-fg-subtle text-xs">
      {{ count }}
    </span>
    <div data-slot="toolbar-end" class="flex shrink-0 items-center gap-2">
      <slot name="end" />
    </div>
  </div>
</template>
