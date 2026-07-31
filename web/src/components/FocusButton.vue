<script setup lang="ts">
import { onUnmounted, ref } from "vue";
import { focusSession } from "../lib/sessman-api";

const props = withDefaults(
  defineProps<{
    sessionId: string;
    /** "sm" for the unobtrusive card footer control, "md" for the drawer. */
    size?: "sm" | "md";
  }>(),
  { size: "md" },
);

type FocusState = "idle" | "pending" | "success" | "error";

const state = ref<FocusState>("idle");
const errorMessage = ref("");
let resetTimer: ReturnType<typeof setTimeout> | null = null;

async function onClick(): Promise<void> {
  if (state.value === "pending") return;
  state.value = "pending";
  errorMessage.value = "";

  const outcome = await focusSession(props.sessionId);

  if (outcome.ok) {
    state.value = "success";
    resetTimer = setTimeout(() => {
      if (state.value === "success") state.value = "idle";
    }, 2000);
    return;
  }

  state.value = "error";
  errorMessage.value = outcome.message;
}

onUnmounted(() => {
  if (resetTimer !== null) clearTimeout(resetTimer);
});
</script>

<template>
  <div class="inline-flex flex-col items-end gap-1">
    <button
      type="button"
      :disabled="state === 'pending'"
      class="inline-flex items-center gap-1 rounded-lg border border-slate-700 text-slate-200 transition hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-60"
      :class="size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-3 py-1.5 text-sm'"
      title="Focus this session's terminal tab (Terminal.app only)"
      aria-label="Focus this session's terminal tab (Terminal.app only)"
      @click="onClick"
    >
      <span v-if="state === 'pending'">Focusing…</span>
      <span v-else-if="state === 'success'">Focused ✓</span>
      <span v-else>Focus tab</span>
    </button>
    <p v-if="state === 'error'" role="alert" class="max-w-[14rem] text-right text-[11px] text-red-400">
      {{ errorMessage }}
    </p>
  </div>
</template>
