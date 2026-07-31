<script setup lang="ts">
import type { Component, HTMLAttributes } from "vue"
import { Inbox } from "@lucide/vue"
import { cn } from "@/lib/utils"

// Simplified from the upstream hans-dashboard EmptyState: this repo drops
// the `illustration`/`illustrationSize` props (no illustration set exists
// here) and keeps only the icon register. See docs/DESIGN.md "Known
// deviations".
withDefaults(
  defineProps<{
    icon?: Component
    title?: string
    description?: string
    inline?: boolean
    class?: HTMLAttributes["class"]
  }>(),
  {
    icon: () => Inbox,
    inline: false,
  },
)
</script>

<template>
  <div
    data-slot="empty-state"
    :data-inline="inline"
    :class="
      cn(
        'flex flex-col items-center gap-2 py-10 text-center',
        inline && 'flex-row items-center gap-3 py-0 text-left',
        $props.class,
      )
    "
  >
    <component :is="icon" v-if="!inline" class="text-fg-subtle size-icon-lg" />
    <div :class="cn('flex flex-col gap-1', inline && 'gap-0.5')">
      <p v-if="title" class="text-fg font-medium">{{ title }}</p>
      <p v-if="description" class="text-fg-subtle text-sm">{{ description }}</p>
      <slot />
    </div>
    <slot name="action" />
  </div>
</template>
