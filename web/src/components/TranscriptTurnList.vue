<script setup lang="ts">
import { computed } from "vue";
import { formatTurnTime } from "../lib/transcript-format";
import type { TranscriptTurn } from "../lib/types";

const props = defineProps<{
  turns: TranscriptTurn[];
}>();

// recentTurns arrives oldest-first (a ring buffer appended in transcript
// order); the drawer wants newest-first so the latest activity is at the top.
const newestFirst = computed(() => [...props.turns].reverse());
</script>

<template>
  <ol v-if="newestFirst.length > 0" class="flex flex-col gap-3">
    <li
      v-for="turn in newestFirst"
      :key="turn.index"
      class="rounded-lg border border-slate-800 bg-slate-900/40 p-3 text-sm"
    >
      <div class="mb-1.5 flex items-center justify-between text-xs text-slate-500">
        <span>turn #{{ turn.index + 1 }}</span>
        <span>{{ formatTurnTime(turn.at) }}</span>
      </div>
      <p class="text-slate-200">
        <span class="text-slate-500">prompt:</span> {{ turn.prompt.text || "(no text)" }}<span v-if="turn.prompt.truncated">…</span>
      </p>
      <p v-if="turn.gist.text" class="mt-1 text-slate-300">
        <span class="text-slate-500">reply:</span> {{ turn.gist.text }}<span v-if="turn.gist.truncated">…</span>
      </p>
      <p v-if="turn.toolNames.length > 0" class="mt-1.5 flex flex-wrap gap-1">
        <span
          v-for="(toolName, i) in turn.toolNames"
          :key="`${turn.index}-${i}`"
          class="rounded-full border border-slate-700 px-1.5 py-0.5 text-[11px] text-slate-400"
        >
          {{ toolName }}
        </span>
      </p>
    </li>
  </ol>
  <p v-else class="text-sm text-slate-500">No turns recorded yet.</p>
</template>
