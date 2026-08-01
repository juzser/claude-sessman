<script setup lang="ts">
import { computed, type HTMLAttributes } from "vue"
import {
  SwitchRoot,
  SwitchThumb,
  useForwardPropsEmits,
  type SwitchRootEmits,
  type SwitchRootProps,
} from "reka-ui"
import { cn } from "@/lib/utils"

const props = withDefaults(
  defineProps<
    SwitchRootProps & {
      class?: HTMLAttributes["class"]
      size?: "sm" | "default"
    }
  >(),
  {
    size: "default",
  },
)
const emits = defineEmits<SwitchRootEmits>()

const delegatedProps = computed(() => {
  const { class: _class, size: _size, ...delegated } = props
  return delegated
})

const forwarded = useForwardPropsEmits(delegatedProps, emits)
</script>

<template>
  <SwitchRoot
    v-bind="forwarded"
    data-slot="switch"
    :data-size="size"
    :class="
      cn(
        'group/switch peer inline-flex shrink-0 items-center rounded-full border border-transparent shadow-xs transition-colors outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input',
        'group-data-[size=default]/switch:h-5.5 group-data-[size=default]/switch:w-9.5 group-data-[size=sm]/switch:h-4.5 group-data-[size=sm]/switch:w-7.5',
        $props.class,
      )
    "
  >
    <SwitchThumb
      data-slot="switch-thumb"
      :class="
        cn(
          'pointer-events-none flex items-center justify-center rounded-full bg-background shadow-lg ring-0 transition-transform data-[state=unchecked]:translate-x-0',
          'group-data-[size=default]/switch:size-4 group-data-[size=default]/switch:data-[state=checked]:translate-x-4',
          'group-data-[size=sm]/switch:size-3.5 group-data-[size=sm]/switch:data-[state=checked]:translate-x-3',
        )
      "
    >
      <slot name="thumb" />
    </SwitchThumb>
  </SwitchRoot>
</template>
