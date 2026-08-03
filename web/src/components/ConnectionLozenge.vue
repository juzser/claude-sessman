<script setup lang="ts">
import { computed } from "vue";
import { Lozenge, type LozengeVariants } from "@/components/ui/lozenge";
import type { ConnectionState } from "../lib/ws-client";

const props = defineProps<{ state: ConnectionState }>();

/**
 * One always-rendered indicator for all four socket states — it replaces the
 * old derived "should I show a banner?" boolean, which conflated `reconnecting`
 * (degraded, still trying) with `closed` (our own deliberate teardown).
 *
 * `reconnecting` is warning rather than danger because nothing has failed for
 * good yet, and `closed` is neutral rather than danger for the same reason.
 */
const STATES: Record<ConnectionState, { tone: LozengeVariants["tone"]; label: string }> = {
  connecting: { tone: "info", label: "Connecting…" },
  open: { tone: "success", label: "Live" },
  reconnecting: { tone: "warning", label: "Reconnecting…" },
  closed: { tone: "neutral", label: "Disconnected" },
};

const current = computed(() => STATES[props.state]);
</script>

<template>
  <!-- The live region is the wrapper, not the Lozenge, and it is never
       v-if'd away: a region that appears at the same moment its text does
       is not reliably announced. -->
  <div aria-live="polite" aria-atomic="true">
    <Lozenge :tone="current.tone" variant="subtle">{{ current.label }}</Lozenge>
  </div>
</template>
