<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import SessionCard from "./components/SessionCard.vue";
import SessionDetailDrawer from "./components/SessionDetailDrawer.vue";
import { useSessions } from "./composables/useSessions";
import { filterSessions, sortSessions, type SortMode } from "./lib/sort-filter";

const { sessions, connectionState, loaded, error } = useSessions();

const query = ref("");
const sortMode = ref<SortMode>("recent");
const home = ref("");
const now = ref(Date.now());
const selectedSessionId = ref<string | null>(null);

let tickTimer: ReturnType<typeof setInterval> | null = null;

onMounted(async () => {
  tickTimer = setInterval(() => {
    now.value = Date.now();
  }, 1000);

  try {
    const res = await fetch("/api/health");
    if (res.ok) {
      const body = (await res.json()) as { home: string };
      home.value = body.home;
    }
  } catch {
    // Non-fatal: cards just fall back to showing the raw cwd.
  }
});

onUnmounted(() => {
  if (tickTimer !== null) clearInterval(tickTimer);
});

const visibleSessions = computed(() => sortSessions(filterSessions(sessions.value, query.value), sortMode.value));

const sortLabel = computed(() => {
  switch (sortMode.value) {
    case "recent":
      return "Recent activity";
    case "name":
      return "Name";
    case "project":
      return "Project";
    default:
      return sortMode.value;
  }
});

function cycleSortMode(): void {
  const order: SortMode[] = ["recent", "name", "project"];
  const idx = order.indexOf(sortMode.value);
  sortMode.value = order[(idx + 1) % order.length];
}

const showDisconnectBanner = computed(
  () => connectionState.value === "reconnecting" || connectionState.value === "closed",
);
</script>

<template>
  <div class="min-h-screen bg-slate-950 text-slate-100">
    <div
      v-if="showDisconnectBanner"
      class="sticky top-0 z-10 bg-amber-500/90 px-4 py-2 text-center text-sm font-medium text-slate-950"
    >
      Lost connection to the sessman server — retrying…
    </div>

    <header class="flex flex-col gap-3 border-b border-slate-800 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div class="flex items-center gap-3">
        <h1 class="text-lg font-semibold">claude-sessman</h1>
        <span class="rounded-full bg-slate-800 px-2.5 py-0.5 text-xs text-slate-300">
          {{ visibleSessions.length }} live
        </span>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <input
          v-model="query"
          type="text"
          placeholder="Filter by name, path, or branch…"
          class="w-56 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm placeholder:text-slate-500 focus:border-slate-500 focus:outline-hidden"
        />
        <button
          type="button"
          class="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:border-slate-500"
          @click="cycleSortMode"
        >
          Sort: {{ sortLabel }}
        </button>
      </div>
    </header>

    <main class="px-6 py-6">
      <p v-if="error" class="mb-4 rounded-lg border border-red-800 bg-red-950/50 px-4 py-2 text-sm text-red-300">
        {{ error }}
      </p>

      <p v-if="loaded && visibleSessions.length === 0" class="py-16 text-center text-sm text-slate-500">
        <span v-if="sessions.length === 0">No Claude Code sessions are running right now.</span>
        <span v-else>No sessions match "{{ query }}".</span>
      </p>

      <div
        v-else
        class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
      >
        <SessionCard
          v-for="session in visibleSessions"
          :key="session.sessionId"
          :session="session"
          :home="home"
          :now="now"
          @select="selectedSessionId = $event"
        />
      </div>
    </main>

    <SessionDetailDrawer
      :session-id="selectedSessionId"
      :home="home"
      @close="selectedSessionId = null"
    />
  </div>
</template>
