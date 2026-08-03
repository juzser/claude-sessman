<script setup lang="ts">
import { onUnmounted, ref } from "vue";
import { Check } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
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
    <Button
      type="button"
      variant="outline"
      :size="size === 'sm' ? 'xs' : 'default'"
      :disabled="state === 'pending'"
      title="Focus this session's terminal tab (Terminal.app only)"
      aria-label="Focus this session's terminal tab (Terminal.app only)"
      @click="onClick"
    >
      <span v-if="state === 'pending'">Focusing…</span>
      <span v-else-if="state === 'success'" class="inline-flex items-center gap-1">
        <Icon :icon="Check" size="sm" />
        Focused
      </span>
      <span v-else>Focus tab</span>
    </Button>
    <p v-if="state === 'error'" role="alert" class="max-w-56 text-right text-caption text-danger">
      {{ errorMessage }}
    </p>
  </div>
</template>
