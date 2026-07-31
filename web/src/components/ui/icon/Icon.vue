<script setup lang="ts">
import type { Component, HTMLAttributes } from "vue"
import { cn } from "@/lib/utils"
import { iconVariants, type IconVariants } from "."

const props = withDefaults(
  defineProps<{
    icon: Component
    size?: IconVariants["size"]
    class?: HTMLAttributes["class"]
  }>(),
  {
    size: "default",
  },
)
</script>

<template>
  <component
    :is="icon"
    data-slot="icon"
    aria-hidden="true"
    :class="cn(iconVariants({ size }), $props.class)"
  />
</template>
