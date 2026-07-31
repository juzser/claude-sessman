<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { useVModel } from "@vueuse/core"
import { cn } from "@/lib/utils"

const props = defineProps<{
  defaultValue?: string | number
  modelValue?: string | number
  class?: HTMLAttributes["class"]
}>()

const emits = defineEmits<{
  (e: "update:modelValue", payload: string | number): void
}>()

const modelValue = useVModel(props, "modelValue", emits, {
  passive: true,
  defaultValue: props.defaultValue,
})
</script>

<template>
  <input
    v-model="modelValue"
    data-slot="input"
    :class="
      cn(
        'border-input placeholder:text-fg-subtle selection:bg-primary selection:text-on-primary dark:bg-input/30 h-control w-full min-w-0 rounded-control border bg-transparent px-2.5 py-1 text-base shadow-xs transition-colors outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
        'focus-visible:border-line-bold focus-visible:ring-2 focus-visible:ring-focus/50',
        'aria-invalid:border-danger aria-invalid:ring-danger/20 dark:aria-invalid:ring-danger/40',
        $props.class,
      )
    "
  />
</template>
