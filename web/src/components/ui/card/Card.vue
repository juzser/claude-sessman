<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { cn } from "@/lib/utils"

withDefaults(
  defineProps<{
    size?: "default" | "sm"
    class?: HTMLAttributes["class"]
  }>(),
  {
    size: "default",
  },
)
</script>

<template>
  <div
    data-slot="card"
    :data-size="size"
    :class="
      cn(
        'group/card ring-foreground/10 bg-card text-card-foreground flex flex-col gap-4 overflow-hidden rounded-xl py-4 text-sm ring-1 has-[>img:first-child]:pt-0 has-data-[slot=card-footer]:pb-0 data-[size=sm]:gap-3 data-[size=sm]:py-3',
        $props.class,
      )
    "
  >
    <slot />
  </div>
</template>
