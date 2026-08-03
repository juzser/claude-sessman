<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { shortenPath } from "../lib/path";
import { fetchSessionFlow } from "../lib/sessman-api";
import { displayNameFor } from "../lib/sort-filter";
import { formatTokenCount } from "../lib/transcript-format";
import type { EnrichedSession, FlowSummary } from "../lib/types";
import SessionFlowView from "./SessionFlowView.vue";

/**
 * "Unexpected server response (503)." is true but tells the operator nothing
 * they can act on, so an unclassified failure gets copy instead. A vanished
 * session and an unreachable server each say something specific, so those are
 * kept.
 */
const GENERIC_FLOW_FAILURE = "We couldn't load this session's flow.";

const props = defineProps<{
  /** The session whose flow is open; null keeps the sheet shut. */
  session: EnrichedSession | null;
  /** Turn the operator expanded from the card strip, for the graph to pan to. */
  focusTurnIndex: number | null;
  home: string;
}>();

const emit = defineEmits<{ close: [] }>();

const flowState = ref<"loading" | "loaded" | "error">("loading");
const flow = ref<FlowSummary | null>(null);
const flowErrorMessage = ref("");

const name = computed(() => (props.session ? displayNameFor(props.session) : ""));
const path = computed(() => (props.session ? shortenPath(props.session.cwd, props.home) : ""));

/**
 * The card used to carry a single figure labelled "ctx" that actually summed
 * input and output. It lives here now, split by direction, so the number the
 * operator reads is the number the label promises.
 */
const usage = computed(() => {
  const totals = props.session?.transcriptSummary?.totalUsage;
  if (!totals) return null;
  return { input: formatTokenCount(totals.inputTokens), output: formatTokenCount(totals.outputTokens) };
});

async function loadFlow(sessionId: string): Promise<void> {
  flowState.value = "loading";
  flow.value = null;
  flowErrorMessage.value = "";

  const outcome = await fetchSessionFlow(sessionId);

  // The operator can close and reopen on another session faster than a request
  // returns; a late reply for a session we are no longer showing is dropped.
  if (props.session?.sessionId !== sessionId) return;

  if (outcome.ok) {
    flow.value = outcome.transcriptFlow;
    flowState.value = "loaded";
    return;
  }
  flowErrorMessage.value = outcome.reason === "unknown" ? GENERIC_FLOW_FAILURE : outcome.message;
  flowState.value = "error";
}

function retryFlow(): void {
  // Two in-flight requests can resolve out of order, and the loser would win.
  if (flowState.value === "loading" || !props.session) return;
  void loadFlow(props.session.sessionId);
}

watch(
  () => props.session?.sessionId ?? null,
  (sessionId) => {
    if (sessionId === null) return;
    void loadFlow(sessionId);
  },
  { immediate: true },
);

function onOpenChange(open: boolean): void {
  if (!open) emit("close");
}
</script>

<template>
  <Sheet :open="session !== null" @update:open="onOpenChange">
    <SheetContent class="w-full gap-0 sm:max-w-2xl">
      <SheetHeader class="border-b border-line">
        <SheetTitle class="truncate">{{ name }}</SheetTitle>
        <SheetDescription class="truncate" :title="session?.cwd">{{ path }}</SheetDescription>
        <p v-if="usage" data-slot="session-usage" class="mt-1 text-xs text-fg-subtle">
          {{ usage.input }} in · {{ usage.output }} out
        </p>
      </SheetHeader>

      <div class="min-h-0 flex-1 overflow-y-auto p-4">
        <SessionFlowView
          :key="session?.sessionId"
          :state="flowState"
          :flow="flow"
          :error-message="flowErrorMessage"
          :focus-turn-index="focusTurnIndex"
          @retry="retryFlow"
        />
      </div>
    </SheetContent>
  </Sheet>
</template>
