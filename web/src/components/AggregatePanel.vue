<script setup lang="ts">
import { toRef } from "vue";
import RunningSubagentsRailCard from "./RunningSubagentsRailCard.vue";
import TokenUsageRailCard from "./TokenUsageRailCard.vue";
import { useAggregateUsage } from "../composables/useAggregateUsage";
import type { EnrichedSession } from "../lib/types";

const props = defineProps<{
  /** The same list the main column renders, folded here and never re-fetched. */
  sessions: EnrichedSession[];
}>();

const aggregate = useAggregateUsage(toRef(props, "sessions"));
</script>

<template>
  <!-- A region, deliberately not a live region: these figures move on every
       socket frame, and announcing them would talk over whatever the operator
       is actually reading. -->
  <aside role="region" aria-label="Aggregate usage across all sessions" class="flex flex-col gap-6">
    <TokenUsageRailCard :total="aggregate.total" :by-model="aggregate.byModel" />
    <RunningSubagentsRailCard :running="aggregate.running" />
  </aside>
</template>
