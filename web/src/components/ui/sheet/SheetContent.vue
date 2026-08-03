<script setup lang="ts">
import { computed, type HTMLAttributes } from "vue"
import { XIcon } from "@lucide/vue"
import {
  DialogClose,
  DialogContent,
  DialogPortal,
  useForwardPropsEmits,
  type DialogContentEmits,
  type DialogContentProps,
} from "reka-ui"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import SheetOverlay from "./SheetOverlay.vue"

const props = withDefaults(
  defineProps<
    DialogContentProps & {
      class?: HTMLAttributes["class"]
      side?: "top" | "right" | "bottom" | "left"
      showCloseButton?: boolean
    }
  >(),
  {
    side: "right",
    showCloseButton: true,
  },
)
const emits = defineEmits<DialogContentEmits>()

const delegatedProps = computed(() => {
  const { class: _class, side: _side, showCloseButton: _showCloseButton, ...delegated } = props
  return delegated
})

const forwarded = useForwardPropsEmits(delegatedProps, emits)

// Note: upstream ships per-side slide-in/slide-out classes here that
// require `tw-animate-css`, a dependency this repo deliberately does not
// add (see docs/DESIGN.md "Known deviations"). Sheets open/close without
// a slide transition rather than shipping inert animation classes.
const sideClasses: Record<string, string> = {
  right: "inset-y-0 right-0 h-full w-3/4 border-l border-line sm:max-w-sm",
  left: "inset-y-0 left-0 h-full w-3/4 border-r border-line sm:max-w-sm",
  top: "inset-x-0 top-0 h-auto border-b border-line",
  bottom: "inset-x-0 bottom-0 h-auto border-t border-line",
}
</script>

<template>
  <DialogPortal>
    <SheetOverlay />
    <DialogContent
      data-slot="sheet-content"
      v-bind="forwarded"
      :class="cn('bg-background fixed z-50 flex flex-col gap-4 shadow-lg', sideClasses[side], $props.class)"
    >
      <slot />
      <TooltipProvider v-if="showCloseButton">
        <Tooltip>
          <TooltipTrigger as-child>
            <DialogClose as-child>
              <Button variant="ghost" size="icon-sm" class="absolute top-3 right-3" aria-label="Close">
                <XIcon />
              </Button>
            </DialogClose>
          </TooltipTrigger>
          <TooltipContent>Close</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </DialogContent>
  </DialogPortal>
</template>
