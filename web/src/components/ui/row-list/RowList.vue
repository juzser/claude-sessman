<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { cn } from "@/lib/utils"

withDefaults(
  defineProps<{
    density?: "prose" | "compact"
    class?: HTMLAttributes["class"]
  }>(),
  {
    density: "prose",
  },
)
</script>

<template>
  <ul
    data-slot="row-list"
    :data-density="density"
    :class="
      cn(
        'flex list-none flex-col p-0 [&>li+li]:border-t [&>li+li]:border-line data-[density=prose]:[&>li]:py-2.5 data-[density=prose]:[&>li:first-child]:pt-0 data-[density=prose]:[&>li:last-child]:pb-0 data-[density=compact]:[&>li]:py-1',
        $props.class,
      )
    "
  >
    <slot />
  </ul>
</template>
