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

// The pack sizes a button's icon per control tier (16 / 14 / 12 px), so one
// fixed spinner size reads off-weight against a static icon in the same slot:
// too small on the 32px tiers, too large on the 24px ones. Mirrors the pack's
// ICON_SIZE map through the Icon primitive's own token sizes.
const SPINNER_SIZE = {
  default: "default",
  sm: "sm",
  xs: "xs",
  icon: "default",
  "icon-sm": "default",
  "icon-xs": "xs",
} as const

const spinnerSize = computed(() => SPINNER_SIZE[props.size ?? "default"])
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
      <Icon v-if="loading" :icon="Loader2" :size="spinnerSize" class="animate-spin motion-reduce:animate-none" />
      <slot v-else />
    </template>
    <template v-else>
      <Icon v-if="loading" :icon="Loader2" :size="spinnerSize" class="animate-spin motion-reduce:animate-none" />
      <slot />
    </template>
  </Primitive>
</template>
