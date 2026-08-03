<script setup lang="ts">
import { ChevronRight, Maximize2 } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { TranscriptTurn } from "../lib/types";

defineProps<{
  /** Most recent turns, oldest first — rendered in the order given. */
  turns: TranscriptTurn[];
}>();

// Carries the turn's transcript-wide index, not its position in this strip:
// the parent opens the flow Sheet centred on that turn, and the retained
// window can start at any index once older turns are evicted.
const emit = defineEmits<{ expand: [turnIndex: number] }>();

/**
 * The reply slot takes the LLM summary when one exists and the raw captured
 * gist otherwise. Same slot, same classes either way — a summarized turn must
 * not be visually distinguishable from a raw one.
 */
function replyText(turn: TranscriptTurn): string {
  return turn.summary?.response ?? turn.gist.text;
}
</script>

<template>
  <TooltipProvider>
    <div role="list" aria-label="Recent turns" class="flex items-stretch gap-2 overflow-x-auto">
      <template v-for="(turn, position) in turns" :key="turn.index">
        <div
          role="listitem"
          class="flex min-w-40 flex-1 flex-col gap-1.5 rounded-lg bg-surface p-2.5 text-xs ring-1 ring-line"
        >
          <div class="flex items-start justify-between gap-1">
            <span class="text-caption text-fg-subtlest">Turn {{ turn.index + 1 }}</span>
            <Tooltip>
              <TooltipTrigger as-child>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  :aria-label="`Expand turn ${turn.index + 1}`"
                  @click="emit('expand', turn.index)"
                >
                  <Icon :icon="Maximize2" size="sm" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>View full flow</TooltipContent>
            </Tooltip>
          </div>
          <!-- The operator's own words, never summarized: whitespace-pre-wrap
               keeps their line breaks, line-clamp-3 caps the height without
               the component having to branch on prompt length. -->
          <p class="line-clamp-3 whitespace-pre-wrap text-xs text-fg wrap-anywhere">{{ turn.prompt.text }}</p>
          <p class="line-clamp-2 whitespace-pre-wrap text-xs text-fg-subtle wrap-anywhere">{{ replyText(turn) }}</p>
        </div>
        <Icon
          v-if="position < turns.length - 1"
          :icon="ChevronRight"
          size="sm"
          class="self-center text-fg-subtlest"
        />
      </template>
    </div>
  </TooltipProvider>
</template>
