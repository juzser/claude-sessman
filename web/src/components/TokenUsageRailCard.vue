<script setup lang="ts">
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Row, RowList } from "@/components/ui/row-list";
import { Separator } from "@/components/ui/separator";
import { formatTokenCount } from "../lib/transcript-format";
import type { ModelUsage, SummedUsage } from "../lib/types";

defineProps<{
  /** Field-wise total across every indexed session; null while none is. */
  total: SummedUsage | null;
  /** Already merged and sorted by the caller; rendered in the order given. */
  byModel: ModelUsage[];
}>();
</script>

<template>
  <Card class="gap-3">
    <CardHeader>
      <CardTitle class="text-card-title">Token usage</CardTitle>
    </CardHeader>
    <CardContent class="flex flex-col gap-3">
      <!-- null means "nothing indexed yet", zero means "indexed, and it really
           is zero". The rail has to keep those apart, so only the null case
           collapses to the empty line. -->
      <p v-if="total === null" class="text-sm text-fg-subtle">No usage yet.</p>
      <div v-else class="flex flex-col gap-1">
        <p class="text-caption text-fg-subtlest">Total</p>
        <div class="flex items-baseline gap-6">
          <p class="flex items-baseline gap-1.5">
            <span data-slot="total-value" class="text-hero tabular-nums text-fg">
              {{ formatTokenCount(total.inputTokens) }}
            </span>
            <span class="text-caption text-fg-subtlest">in</span>
          </p>
          <p class="flex items-baseline gap-1.5">
            <span data-slot="total-value" class="text-hero tabular-nums text-fg">
              {{ formatTokenCount(total.outputTokens) }}
            </span>
            <span class="text-caption text-fg-subtlest">out</span>
          </p>
        </div>
      </div>

      <!-- No models attributed yet is not its own state worth labelling: the
           card already says "No usage yet." when nothing is indexed, and a
           lone "By model" heading over nothing reads as a rendering fault. -->
      <template v-if="byModel.length > 0">
        <Separator />
        <div class="flex flex-col gap-1">
          <p class="text-caption text-fg-subtlest">By model</p>
          <RowList density="compact">
            <Row v-for="entry in byModel" :key="entry.model" :title="entry.model">
              <template #trailing>
                <span class="text-sm tabular-nums text-fg-subtle">{{ entry.calls }}×</span>
              </template>
            </Row>
          </RowList>
        </div>
      </template>
    </CardContent>
  </Card>
</template>
