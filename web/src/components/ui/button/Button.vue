<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { computed } from "vue"
import { Loader2 } from "@lucide/vue"
import { Primitive, type PrimitiveProps } from "reka-ui"
import { cn } from "@/lib/utils"
import { Icon } from "@/components/ui/icon"
import { buttonVariants, type ButtonVariants } from "."

interface Props extends PrimitiveProps {
  variant?: ButtonVariants["variant"]
  size?: ButtonVariants["size"]
  class?: HTMLAttributes["class"]
  loading?: boolean
  disabled?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  as: "button",
  loading: false,
  disabled: false,
})

// Icon-only sizes have no room for a label beside the spinner, so the
// spinner replaces the slot entirely instead of sitting next to it.
const isIconOnly = computed(() => props.size === "icon" || props.size === "icon-xs" || props.size === "icon-sm")
</script>

<template>
  <Primitive
    data-slot="button"
    :as="as"
    :as-child="asChild"
    :data-variant="variant"
    :data-size="size"
    :disabled="disabled || loading"
    :aria-busy="loading || undefined"
    :class="cn(buttonVariants({ variant, size }), props.class)"
  >
    <template v-if="isIconOnly">
      <Icon v-if="loading" :icon="Loader2" size="sm" class="animate-spin motion-reduce:animate-none" />
      <slot v-else />
    </template>
    <template v-else>
      <Icon v-if="loading" :icon="Loader2" size="sm" class="animate-spin motion-reduce:animate-none" />
      <slot />
    </template>
  </Primitive>
</template>
