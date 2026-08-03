<script setup lang="ts">
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Row, RowList } from "@/components/ui/row-list";
import type { RunningSubagentRow } from "../composables/useAggregateUsage";

defineProps<{
  /** Already sorted by the caller; rendered in the order given. */
  running: RunningSubagentRow[];
}>();

/** A run with no readable `.meta.json` is still a real run; name it generically. */
function agentLabel(row: RunningSubagentRow): string {
  return row.agentType ?? "Subagent";
}

/**
 * Session first: the rail's whole job is telling the operator *where* work is
 * happening, and the description is the detail that can be truncated away.
 */
function agentMeta(row: RunningSubagentRow): string {
  return row.description ? `${row.sessionName} · ${row.description}` : row.sessionName;
}
</script>

<template>
  <Card class="gap-3">
    <CardHeader>
      <CardTitle class="text-card-title">Running subagents</CardTitle>
    </CardHeader>
    <CardContent class="flex flex-col gap-3">
      <p v-if="running.length === 0" class="text-sm text-fg-subtle">No subagents running.</p>
      <template v-else>
        <p class="flex items-baseline gap-1.5">
          <span data-slot="running-count" class="text-hero tabular-nums text-fg">{{ running.length }}</span>
          <span class="text-caption text-fg-subtlest">running</span>
        </p>
        <RowList density="compact">
          <Row v-for="row in running" :key="row.key" :title="agentLabel(row)" :meta="agentMeta(row)" />
        </RowList>
      </template>
    </CardContent>
  </Card>
</template>
