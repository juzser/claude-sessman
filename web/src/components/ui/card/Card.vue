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
        // The pack's card recipe is `box-shadow: var(--ds-ring-card), var(--ds-shadow-raised)`:
        // a hairline inset ring plus the raised drop shadow, in ONE declaration.
        // hds-tokens.css exposes each half as its own utility (`shadow-ring-card`,
        // `shadow-raised`), but both compile to the same `--tw-shadow` custom
        // property, so using them as two separate classes makes the later one
        // silently replace the earlier one instead of combining (verified against
        // the compiled build output). A single arbitrary `shadow-[...]` value
        // referencing both tokens, comma-joined exactly as the pack does, is the
        // only way to get both effects at once.
        'group/card shadow-[var(--ds-ring-card),var(--ds-shadow-raised)] bg-card text-card-foreground flex flex-col gap-4 overflow-hidden rounded-xl py-4 text-sm has-[>img:first-child]:pt-0 has-data-[slot=card-footer]:pb-0 data-[size=sm]:gap-3 data-[size=sm]:py-3',
        $props.class,
      )
    "
  >
    <slot />
  </div>
</template>
