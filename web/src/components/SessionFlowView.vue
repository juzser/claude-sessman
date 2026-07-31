<script setup lang="ts">
import { computed, ref } from "vue";
import { VueFlow } from "@vue-flow/core";
import { buildFlowGraph } from "../lib/flow-model";
import { formatTurnTime, truncateLine } from "../lib/transcript-format";
import type { FlowSummary, TranscriptTurn } from "../lib/types";

const props = defineProps<{
  state: "loading" | "loaded" | "error";
  flow: FlowSummary | null;
  errorMessage: string;
}>();

const emit = defineEmits<{ retry: [] }>();

const PROMPT_LINE_LENGTH = 140;

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

function retry(): void {
  emit("retry");
}
</script>

<template>
  <div>
    <p v-if="state === 'loading'" class="text-sm text-slate-400">Loading flow…</p>

    <div v-else-if="state === 'error'" class="flex flex-col items-start gap-2">
      <p class="text-sm text-red-300">{{ errorMessage }}</p>
      <button
        type="button"
        class="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:border-slate-500"
        @click="retry"
      >
        Retry
      </button>
    </div>

    <p v-else-if="isEmpty" class="text-sm text-slate-500">No turns recorded yet.</p>

    <p v-else-if="state === 'loaded' && !flow" class="text-sm text-slate-500">
      This session's transcript hasn't been indexed yet — check back in a moment.
    </p>

    <div
      v-else-if="state === 'loaded' && flow"
      class="relative h-[28rem] w-full overflow-hidden rounded-lg border border-slate-800 bg-slate-900/40"
    >
      <p
        v-if="flow.turnsDropped"
        class="absolute left-2 top-2 z-10 rounded-full border border-amber-700 bg-slate-950/80 px-2 py-0.5 text-[11px] text-amber-300"
      >
        Showing the most recent {{ flow.retainedTurnCount }} of {{ flow.turnCount }} turns
      </p>
      <VueFlow
        :nodes="graph.nodes"
        :edges="graph.edges"
        :nodes-draggable="false"
        :nodes-connectable="false"
        :fit-view-on-init="true"
        :min-zoom="0.2"
        class="h-full w-full"
      >
        <template #node-default="{ data }">
          <div
            class="w-72 cursor-pointer rounded-lg border border-slate-700 bg-slate-900 p-2.5 text-xs shadow-lg"
            :class="{ 'z-20': isExpanded(data.turn) }"
            @click="toggleExpanded(data.turn.index)"
          >
            <div class="mb-1 flex items-center justify-between text-slate-500">
              <span>turn #{{ data.turn.index + 1 }}</span>
              <span>{{ formatTurnTime(data.turn.at) }}</span>
            </div>
            <p class="text-slate-200" :title="data.turn.prompt.text">
              <span class="text-slate-500">prompt:</span>
              {{ truncateLine(data.turn.prompt.text || "(no text)", PROMPT_LINE_LENGTH) }}
            </p>
            <p v-if="data.turn.gist.text" class="mt-1 text-slate-300" :title="data.turn.gist.text">
              <span class="text-slate-500">reply:</span> {{ truncateLine(data.turn.gist.text, PROMPT_LINE_LENGTH) }}
            </p>
            <p class="mt-1.5 text-slate-400">{{ toolChipLabel(data.turn) }}</p>

            <div v-if="isExpanded(data.turn)" class="mt-2 max-h-40 overflow-y-auto border-t border-slate-800 pt-2">
              <ul v-if="data.turn.toolCalls.length > 0" class="flex flex-col gap-1">
                <li
                  v-for="(call, i) in data.turn.toolCalls"
                  :key="i"
                  class="rounded border border-slate-700 px-1.5 py-0.5 text-[11px] text-slate-300"
                >
                  {{ call.name }}<span v-if="call.target"> — {{ call.target }}</span>
                </li>
              </ul>
              <p v-if="data.turn.toolCallsOmitted > 0" class="mt-1 text-[11px] text-slate-500">
                +{{ data.turn.toolCallsOmitted }} more
              </p>
              <div v-if="data.turn.filesTouched.length > 0" class="mt-1.5 flex flex-wrap gap-1">
                <span
                  v-for="file in data.turn.filesTouched"
                  :key="file"
                  class="rounded-full border border-slate-700 px-1.5 py-0.5 text-[11px] text-slate-400"
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
