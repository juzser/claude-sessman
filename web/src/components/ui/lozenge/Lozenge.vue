<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { cn } from "@/lib/utils"
import { lozengeVariants, type LozengeVariants } from "."

const props = withDefaults(
  defineProps<{
    tone?: LozengeVariants["tone"]
    variant?: LozengeVariants["variant"]
    class?: HTMLAttributes["class"]
  }>(),
  {
    tone: "neutral",
    variant: "subtle",
  },
)
</script>

<template>
  <span
    data-slot="lozenge"
    :data-tone="tone"
    :data-variant="variant"
    :class="cn(lozengeVariants({ tone, variant }), $props.class)"
  >
    <slot />
  </span>
</template>
