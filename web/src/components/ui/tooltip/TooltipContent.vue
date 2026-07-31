<script setup lang="ts">
import { computed, type HTMLAttributes } from "vue"
import {
  TooltipArrow,
  TooltipContent,
  TooltipPortal,
  useForwardPropsEmits,
  type TooltipContentEmits,
  type TooltipContentProps,
} from "reka-ui"
import { cn } from "@/lib/utils"

// Note: upstream shadcn-vue ships enter/exit animation classes here
// (animate-in/fade-in-0/zoom-in-95/slide-in-from-*) that require the
// `tw-animate-css` package. This repo deliberately does not add that
// dependency (see docs/DESIGN.md "Known deviations"), so those classes
// are omitted rather than shipped as dead weight.
const props = withDefaults(
  defineProps<TooltipContentProps & { class?: HTMLAttributes["class"] }>(),
  {
    sideOffset: 0,
  },
)
const emits = defineEmits<TooltipContentEmits>()

const delegatedProps = computed(() => {
  const { class: _class, ...delegated } = props
  return delegated
})

const forwarded = useForwardPropsEmits(delegatedProps, emits)
</script>

<template>
  <TooltipPortal>
    <TooltipContent
      data-slot="tooltip-content"
      v-bind="forwarded"
      :class="
        cn(
          'bg-foreground text-background z-50 w-fit rounded-md px-3 py-1.5 text-xs text-balance',
          $props.class,
        )
      "
    >
      <slot />
      <TooltipArrow class="bg-foreground fill-foreground z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px]" />
    </TooltipContent>
  </TooltipPortal>
</template>
