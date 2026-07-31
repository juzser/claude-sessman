<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { shortenPath } from "../lib/path";
import { fetchSessionDetail, fetchSessionFlow } from "../lib/sessman-api";
import { statusVisualFor } from "../lib/status";
import { formatDurationShort } from "../lib/time-ago";
import { formatTokenCount, sortToolCounts } from "../lib/transcript-format";
import type { EnrichedSession, FlowSummary, TranscriptSummary } from "../lib/types";
import FocusButton from "./FocusButton.vue";
import SessionFlowView from "./SessionFlowView.vue";
import TranscriptTurnList from "./TranscriptTurnList.vue";

const props = defineProps<{
  /** Non-null opens the drawer and fetches this session's detail. */
  sessionId: string | null;
  home: string;
}>();

const emit = defineEmits<{ close: [] }>();

type DrawerState = "idle" | "loading" | "loaded" | "error" | "not-found";

const state = ref<DrawerState>("idle");
const session = ref<EnrichedSession | null>(null);
const transcriptDetail = ref<TranscriptSummary | null>(null);
const errorMessage = ref("");

type Tab = "turns" | "flow";
const activeTab = ref<Tab>("turns");

type FlowLoadState = "idle" | "loading" | "loaded" | "error";
const flowState = ref<FlowLoadState>("idle");
const flowSummary = ref<FlowSummary | null>(null);
const flowErrorMessage = ref("");
// Which session's flow has already been fetched, so re-selecting the Flow
// tab for the same session doesn't refetch; a session switch resets this.
const flowLoadedForSessionId = ref<string | null>(null);

const closeButtonRef = ref<HTMLButtonElement | null>(null);
let lastFocused: HTMLElement | null = null;

const isOpen = computed(() => props.sessionId !== null);

async function load(sessionId: string): Promise<void> {
  state.value = "loading";
  const outcome = await fetchSessionDetail(sessionId);
  // The drawer may have moved on to a different (or no) session while this
  // fetch was in flight; a stale response must not overwrite newer state.
  if (props.sessionId !== sessionId) return;

  if (outcome.ok) {
    session.value = outcome.session;
    transcriptDetail.value = outcome.transcriptDetail;
    state.value = "loaded";
    return;
  }

  errorMessage.value = outcome.message;
  state.value = outcome.reason === "not-found" ? "not-found" : "error";
}

function retry(): void {
  if (props.sessionId) load(props.sessionId);
}

async function loadFlow(sessionId: string): Promise<void> {
  flowState.value = "loading";
  const outcome = await fetchSessionFlow(sessionId);
  // Same stale-response guard as load(): the drawer may have moved on to a
  // different (or no) session while this fetch was in flight.
  if (props.sessionId !== sessionId) return;

  if (outcome.ok) {
    flowSummary.value = outcome.transcriptFlow;
    flowLoadedForSessionId.value = sessionId;
    flowState.value = "loaded";
    return;
  }

  flowErrorMessage.value = outcome.message;
  flowState.value = "error";
}

function selectTab(tab: Tab): void {
  activeTab.value = tab;
  if (tab === "flow" && session.value && flowLoadedForSessionId.value !== session.value.sessionId) {
    void loadFlow(session.value.sessionId);
  }
}

function retryFlow(): void {
  if (session.value) void loadFlow(session.value.sessionId);
}

function close(): void {
  emit("close");
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.stopPropagation();
    close();
  }
}

watch(
  () => props.sessionId,
  async (next, prev) => {
    // A session switch (or close) must not leak the previous session's Flow
    // tab state into the next one.
    activeTab.value = "turns";
    flowState.value = "idle";
    flowSummary.value = null;
    flowErrorMessage.value = "";
    flowLoadedForSessionId.value = null;

    if (next === null) {
      lastFocused?.focus();
      lastFocused = null;
      state.value = "idle";
      session.value = null;
      transcriptDetail.value = null;
      return;
    }

    if (prev === null) {
      lastFocused = document.activeElement as HTMLElement | null;
    }

    void load(next);

    if (prev === null) {
      await nextTick();
      closeButtonRef.value?.focus();
    }
  },
);

const path = computed(() => (session.value ? shortenPath(session.value.cwd, props.home) : ""));
const statusVisual = computed(() =>
  session.value ? statusVisualFor(session.value.status, session.value.alive) : "dead",
);
const toolCounts = computed(() =>
  transcriptDetail.value ? sortToolCounts(transcriptDetail.value.toolCounts) : [],
);
const contextTokenLabel = computed(() =>
  transcriptDetail.value?.usage ? formatTokenCount(transcriptDetail.value.usage.contextTokens) : null,
);
</script>

<template>
  <div
    v-if="isOpen"
    class="fixed inset-0 z-20 flex justify-end bg-slate-950/60"
    @keydown="onKeydown"
    @click.self="close"
  >
    <section
      role="dialog"
      aria-modal="true"
      aria-labelledby="session-detail-title"
      class="flex h-full w-full max-w-lg flex-col gap-5 overflow-y-auto border-l border-slate-800 bg-slate-950 p-6 shadow-xl"
    >
      <header class="flex items-start justify-between gap-3">
        <h2 id="session-detail-title" class="text-base font-semibold text-slate-100">
          {{ session?.name ?? path ?? "Session detail" }}
        </h2>
        <button
          ref="closeButtonRef"
          type="button"
          class="shrink-0 rounded-lg border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:border-slate-500"
          @click="close"
        >
          Close
        </button>
      </header>

      <p v-if="state === 'loading'" class="text-sm text-slate-400">Loading session detail…</p>

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

      <p v-else-if="state === 'not-found'" class="text-sm text-amber-300">
        This session is no longer running — it may have exited while this drawer was open.
      </p>

      <div v-else-if="state === 'loaded' && session" class="flex flex-col gap-5">
        <section class="flex flex-wrap items-center gap-2 text-xs text-slate-400">
          <span :title="session.cwd">{{ path }}</span>
          <span
            v-if="session.git"
            :class="session.git.dirty ? 'text-amber-300' : 'text-slate-300'"
          >
            {{ session.git.branch }}<span v-if="session.git.dirty">*</span>
          </span>
          <span>pid {{ session.pid }}</span>
          <span>tty {{ session.tty ?? "—" }}</span>
          <span>uptime {{ formatDurationShort(session.uptimeSec) }}</span>
          <span>status: {{ session.status }} ({{ statusVisual }})</span>
        </section>

        <FocusButton :session-id="session.sessionId" />

        <template v-if="transcriptDetail">
          <nav class="flex gap-1 text-xs" role="tablist">
            <button
              type="button"
              role="tab"
              :aria-selected="activeTab === 'turns'"
              class="rounded-full border px-3 py-1"
              :class="
                activeTab === 'turns'
                  ? 'border-slate-400 text-slate-100'
                  : 'border-slate-700 text-slate-400 hover:border-slate-500'
              "
              @click="selectTab('turns')"
            >
              Turns
            </button>
            <button
              type="button"
              role="tab"
              :aria-selected="activeTab === 'flow'"
              class="rounded-full border px-3 py-1"
              :class="
                activeTab === 'flow'
                  ? 'border-slate-400 text-slate-100'
                  : 'border-slate-700 text-slate-400 hover:border-slate-500'
              "
              @click="selectTab('flow')"
            >
              Flow
            </button>
          </nav>

          <template v-if="activeTab === 'turns'">
            <section>
              <h3 class="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Last prompt</h3>
              <p class="whitespace-pre-wrap text-sm text-slate-200">
                {{ transcriptDetail.lastUserPrompt?.text || "—"
                }}<span v-if="transcriptDetail.lastUserPrompt?.truncated">…</span>
              </p>
            </section>

            <section>
              <h3 class="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Last reply gist</h3>
              <p class="whitespace-pre-wrap text-sm text-slate-200">
                {{ transcriptDetail.lastAssistantGist?.text || "—"
                }}<span v-if="transcriptDetail.lastAssistantGist?.truncated">…</span>
              </p>
            </section>

            <section class="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-400 sm:grid-cols-3">
              <span>model: {{ transcriptDetail.model ?? "unknown" }}</span>
              <span>{{ transcriptDetail.turnCount }} turns</span>
              <span>{{ transcriptDetail.toolCallsTotal }} tool calls</span>
              <template v-if="transcriptDetail.usage">
                <span>input {{ formatTokenCount(transcriptDetail.usage.inputTokens) }}</span>
                <span>output {{ formatTokenCount(transcriptDetail.usage.outputTokens) }}</span>
                <span>context {{ contextTokenLabel }}</span>
              </template>
            </section>

            <section v-if="toolCounts.length > 0">
              <h3 class="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Tool calls</h3>
              <ul class="flex flex-wrap gap-1.5 text-xs text-slate-300">
                <li
                  v-for="tool in toolCounts"
                  :key="tool.name"
                  class="rounded-full border border-slate-700 px-2 py-0.5"
                >
                  {{ tool.name }} × {{ tool.count }}
                </li>
              </ul>
            </section>

            <section>
              <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Recent turns</h3>
              <TranscriptTurnList :turns="transcriptDetail.recentTurns" />
            </section>
          </template>

          <section v-else>
            <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Flow</h3>
            <SessionFlowView
              :state="flowState === 'idle' ? 'loading' : flowState"
              :flow="flowSummary"
              :error-message="flowErrorMessage"
              @retry="retryFlow"
            />
          </section>
        </template>

        <p v-else class="text-sm text-slate-500">
          This session's transcript hasn't been indexed yet — check back in a moment.
        </p>
      </div>
    </section>
  </div>
</template>
