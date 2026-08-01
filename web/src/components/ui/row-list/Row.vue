<script setup lang="ts">
import { computed, useAttrs, type HTMLAttributes } from "vue"
import { cn } from "@/lib/utils"

defineOptions({ inheritAttrs: false })

defineProps<{
  title?: string
  meta?: string
  class?: HTMLAttributes["class"]
}>()

const attrs = useAttrs()
const isInteractive = computed(() => Boolean(attrs.onClick))
</script>

<template>
  <li data-slot="row" class="list-none">
    <component
      :is="isInteractive ? 'button' : 'div'"
      v-bind="attrs"
      :class="
        cn(
          'flex w-full items-center justify-between gap-3 text-left',
          isInteractive && 'cursor-pointer',
          $props.class,
        )
      "
    >
      <div class="flex min-w-0 flex-col">
        <span class="text-fg truncate text-sm">{{ title }}</span>
        <span v-if="meta" class="text-fg-subtle truncate text-xs">{{ meta }}</span>
      </div>
      <div class="shrink-0">
        <slot name="trailing" />
      </div>
    </component>
  </li>
</template>
