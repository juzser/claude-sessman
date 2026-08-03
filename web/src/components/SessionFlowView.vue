<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { VueFlow, type VueFlowStore } from "@vue-flow/core";
import { Button } from "@/components/ui/button";
import { Lozenge } from "@/components/ui/lozenge";
import { buildFlowGraph } from "../lib/flow-model";
import { formatTurnTime, truncateLine } from "../lib/transcript-format";
import type { FlowSummary, TranscriptTurn } from "../lib/types";

const props = defineProps<{
  state: "loading" | "loaded" | "error";
  flow: FlowSummary | null;
  errorMessage: string;
  /**
   * Transcript-wide index of the turn the operator arrived on. The graph pans
   * to it instead of making them hunt for it in a lane hundreds of turns long.
   */
  focusTurnIndex?: number | null;
}>();

const emit = defineEmits<{ retry: [] }>();

const PROMPT_LINE_LENGTH = 140;
const FOCUS_PAN_MS = 300;

// Vue Flow measures each custom node's real DOM size itself; we only ever
// supply id/position/data, keyed by the turn's transcript-wide index so the
// vertical lane stays stable even when older turns fall outside the
// server's retained flow window.
const graph = computed(() => (props.flow ? buildFlowGraph(props.flow) : { nodes: [], edges: [] }));
const isEmpty = computed(() => props.state === "loaded" && props.flow !== null && graph.value.nodes.length === 0);

// Multiple turns can be expanded at once; keyed by the turn's transcript index.
const expandedTurns = ref<Set<number>>(new Set());

function toggleExpanded(turnIndex: number): void {
  const next = new Set(expandedTurns.value);
  if (next.has(turnIndex)) {
    next.delete(turnIndex);
  } else {
    next.add(turnIndex);
  }
  expandedTurns.value = next;
}

function isExpanded(turn: TranscriptTurn): boolean {
  return expandedTurns.value.has(turn.index);
}

function toolChipLabel(turn: TranscriptTurn): string {
  const count = turn.toolCalls.length;
  if (count === 0) return "no tool calls";
  return count === 1 ? "1 tool call" : `${count} tool calls`;
}

// Vue Flow hands its store over once the pane exists; there is nothing to pan
// before that, and the graph may still be loading when focusTurnIndex arrives.
const pane = ref<VueFlowStore | null>(null);

function panToFocusedTurn(): void {
  const store = pane.value;
  const turnIndex = props.focusTurnIndex;
  if (!store || turnIndex === null || turnIndex === undefined) return;

  const node = store.findNode(String(turnIndex));
  if (!node) return;

  // Node dimensions are measured, so centre on the node's middle rather than
  // its top-left corner, which would park it against the pane's edge.
  const x = node.position.x + (node.dimensions?.width ?? 0) / 2;
  const y = node.position.y + (node.dimensions?.height ?? 0) / 2;
  void store.setCenter(x, y, { zoom: 1, duration: FOCUS_PAN_MS });
}

function onPaneReady(store: VueFlowStore): void {
  pane.value = store;
  panToFocusedTurn();
}

watch(() => [props.focusTurnIndex, props.flow], panToFocusedTurn);

function retry(): void {
  emit("retry");
}
</script>

<template>
  <div>
    <p v-if="state === 'loading'" class="text-sm text-fg-subtle">Loading flow…</p>

    <div v-else-if="state === 'error'" class="flex flex-col items-start gap-2">
      <p class="text-sm text-danger">{{ errorMessage }}</p>
      <Button type="button" variant="outline" @click="retry">Retry</Button>
    </div>

    <p v-else-if="isEmpty" class="text-sm text-fg-subtlest">No turns recorded yet.</p>

    <p v-else-if="state === 'loaded' && !flow" class="text-sm text-fg-subtlest">
      This session's transcript hasn't been indexed yet — check back in a moment.
    </p>

    <div
      v-else-if="state === 'loaded' && flow"
      class="relative h-112 w-full overflow-hidden rounded-lg border border-line bg-surface-sunken/40"
    >
      <div v-if="flow.turnsDropped" class="absolute left-2 top-2 z-10">
        <Lozenge tone="warning" variant="subtle">
          Showing the most recent {{ flow.retainedTurnCount }} of {{ flow.turnCount }} turns
        </Lozenge>
      </div>
      <VueFlow
        :nodes="graph.nodes"
        :edges="graph.edges"
        :nodes-draggable="false"
        :nodes-connectable="false"
        :fit-view-on-init="true"
        :min-zoom="0.2"
        class="h-full w-full"
        @pane-ready="onPaneReady"
      >
        <template #node-default="{ data }">
          <div
            class="w-72 cursor-pointer rounded-lg border border-line bg-surface-raised p-2.5 text-xs shadow-lg"
            :class="{ 'z-20': isExpanded(data.turn) }"
            @click="toggleExpanded(data.turn.index)"
          >
            <div class="mb-1 flex items-center justify-between text-fg-subtlest">
              <span>turn #{{ data.turn.index + 1 }}</span>
              <span>{{ formatTurnTime(data.turn.at) }}</span>
            </div>
            <p class="text-fg" :title="data.turn.prompt.text">
              <span class="text-fg-subtlest">prompt:</span>
              {{ truncateLine(data.turn.prompt.text || "(no text)", PROMPT_LINE_LENGTH) }}
            </p>
            <p v-if="data.turn.gist.text" class="mt-1 text-fg-subtle" :title="data.turn.gist.text">
              <span class="text-fg-subtlest">reply:</span> {{ truncateLine(data.turn.gist.text, PROMPT_LINE_LENGTH) }}
            </p>
            <p class="mt-1.5 text-fg-subtle">{{ toolChipLabel(data.turn) }}</p>

            <div v-if="isExpanded(data.turn)" class="mt-2 max-h-40 overflow-y-auto border-t border-line pt-2">
              <ul v-if="data.turn.toolCalls.length > 0" class="flex flex-col gap-1">
                <li
                  v-for="(call, i) in data.turn.toolCalls"
                  :key="i"
                  class="rounded-sm border border-line px-1.5 py-0.5 text-[11px] text-fg-subtle"
                >
                  {{ call.name }}<span v-if="call.target"> — {{ call.target }}</span>
                </li>
              </ul>
              <p v-if="data.turn.toolCallsOmitted > 0" class="mt-1 text-[11px] text-fg-subtlest">
                +{{ data.turn.toolCallsOmitted }} more
              </p>
              <div v-if="data.turn.filesTouched.length > 0" class="mt-1.5 flex flex-wrap gap-1">
                <span
                  v-for="file in data.turn.filesTouched"
                  :key="file"
                  class="rounded-full border border-line px-1.5 py-0.5 text-[11px] text-fg-subtle"
                >
                  {{ file }}
                </span>
              </div>
            </div>
          </div>
        </template>
      </VueFlow>
    </div>
  </div>
</template>
