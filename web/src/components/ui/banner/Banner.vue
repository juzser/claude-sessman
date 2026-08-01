<script setup lang="ts">
import { computed, type HTMLAttributes } from "vue"
import { CircleAlert, Info, TriangleAlert } from "@lucide/vue"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { BannerTone } from "."

// Fixed channel mapping (per design spec, do not add new channels here):
// - Load failure: banner replaces the data region, with a Retry action.
// - Submit failure: banner sits atop the form being submitted.
// - Success: reported via toast, never a banner. There is deliberately no
//   `success` tone below. A working one would make the anti-pattern this
//   comment warns about look sanctioned. Adding a Banner-success channel is a
//   change to the design system's master spec, not a local addition here.
const TONE_CLASSES: Record<BannerTone, string> = {
  danger: "bg-danger-subtle text-danger",
  warning: "bg-warning-subtle text-warning",
  info: "bg-info-subtle text-info",
}

const TONE_ICONS = {
  danger: CircleAlert,
  warning: TriangleAlert,
  info: Info,
} as const

const props = withDefaults(
  defineProps<{
    tone?: BannerTone
    message?: string
    onRetry?: () => void
    retryLabel?: string
    class?: HTMLAttributes["class"]
  }>(),
  {
    tone: "info",
    retryLabel: "Retry",
  },
)

const icon = computed(() => TONE_ICONS[props.tone])
const role = computed(() => (props.tone === "danger" ? "alert" : "status"))
</script>

<template>
  <div
    data-slot="banner"
    :role="role"
    :class="cn('flex items-center gap-2 rounded-control px-3 py-2 text-sm', TONE_CLASSES[tone], $props.class)"
  >
    <component :is="icon" class="size-icon-sm shrink-0" />
    <div class="flex-1">
      <slot>{{ message }}</slot>
    </div>
    <Button v-if="onRetry" size="xs" variant="outline" @click="onRetry">
      {{ retryLabel }}
    </Button>
  </div>
</template>
