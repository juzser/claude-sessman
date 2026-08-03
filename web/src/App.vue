<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Lozenge } from "@/components/ui/lozenge";
import { Skeleton } from "@/components/ui/skeleton";
import AggregatePanel from "./components/AggregatePanel.vue";
import ConnectionLozenge from "./components/ConnectionLozenge.vue";
import SessionCard from "./components/SessionCard.vue";
import SessionFlowSheet from "./components/SessionFlowSheet.vue";
import ThemeToggle from "./components/ThemeToggle.vue";
import { useSessions } from "./composables/useSessions";
import { filterSessions, sortSessions, type SortMode } from "./lib/sort-filter";

const { sessions, connectionState, loaded, error, retry } = useSessions();

/** Placeholder cards shown while the first list is in flight. */
const SKELETON_COUNT = 3;

const query = ref("");
const sortMode = ref<SortMode>("recent");
const home = ref("");
const now = ref(Date.now());
const expandedSessionId = ref<string | null>(null);
const focusTurnIndex = ref<number | null>(null);

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

const sessionCountLabel = computed(() =>
  visibleSessions.value.length === 1 ? "1 session" : `${visibleSessions.value.length} sessions`,
);

/**
 * Resolved against the live list rather than captured on click, so the open
 * sheet keeps up with socket frames — and closes itself when its session ends.
 */
const expandedSession = computed(
  () => sessions.value.find((session) => session.sessionId === expandedSessionId.value) ?? null,
);

// Quoting the query back is the whole point of this state: it tells the
// operator the list is empty because of what they typed, not because the
// sessions went away.
const noMatchTitle = computed(() => `No sessions match "${query.value}".`);

const SORT_LABELS: Record<SortMode, string> = {
  recent: "Recent",
  name: "Name",
  project: "Project",
};

const sortLabel = computed(() => SORT_LABELS[sortMode.value]);

function cycleSortMode(): void {
  const order: SortMode[] = ["recent", "name", "project"];
  const idx = order.indexOf(sortMode.value);
  sortMode.value = order[(idx + 1) % order.length];
}

function openFlow(sessionId: string, turnIndex: number): void {
  expandedSessionId.value = sessionId;
  focusTurnIndex.value = turnIndex;
}

function closeFlow(): void {
  expandedSessionId.value = null;
  focusTurnIndex.value = null;
}
</script>

<template>
  <div class="min-h-screen">
    <!-- A dropped socket reconnects on its own, so it is reported in the
         topbar rather than by a Banner, whose Retry the operator can't use. -->
    <header class="sticky top-0 z-20 border-b border-line bg-surface">
      <div
        class="mx-auto flex max-w-content flex-col gap-3 px-6 py-3 sm:min-h-topbar sm:flex-row sm:items-center sm:justify-between"
      >
        <div class="flex items-center gap-3">
          <h1 class="text-base font-semibold text-fg">claude-sessman</h1>
          <Lozenge tone="neutral" variant="subtle">{{ sessionCountLabel }}</Lozenge>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <Input
            v-model="query"
            type="search"
            placeholder="Search sessions…"
            aria-label="Search sessions"
            class="w-56"
          />
          <Button type="button" variant="outline" @click="cycleSortMode">Sort: {{ sortLabel }}</Button>
          <ThemeToggle />
          <ConnectionLozenge :state="connectionState" />
        </div>
      </div>
    </header>

    <main class="mx-auto max-w-content px-6 py-6">
      <!-- One message for the whole body: the rail is fed by the same failed
           request, so a second copy of it next to this one says nothing new. -->
      <Banner v-if="error" tone="danger" message="We couldn't load your sessions." :on-retry="retry" />

      <div v-else class="flex flex-col gap-6 lg:flex-row lg:items-start">
        <div data-slot="session-list" class="flex min-w-0 flex-1 flex-col gap-6">
          <template v-if="!loaded">
            <div
              v-for="n in SKELETON_COUNT"
              :key="n"
              data-slot="session-skeleton"
              class="flex flex-col gap-3 rounded-card bg-surface-raised p-4 shadow-raised ring-1 ring-line"
              aria-hidden="true"
            >
              <div class="flex items-center gap-3">
                <Skeleton class="h-10 w-10 shrink-0 rounded-full" />
                <div class="flex min-w-0 flex-1 flex-col gap-1.5">
                  <Skeleton class="h-3.5 w-40" />
                  <Skeleton class="h-3 w-56" />
                </div>
              </div>
              <Skeleton class="h-4 w-full" />
              <div class="flex gap-2">
                <Skeleton class="h-14 flex-1" />
                <Skeleton class="h-14 flex-1" />
                <Skeleton class="h-14 flex-1" />
              </div>
            </div>
          </template>

          <EmptyState
            v-else-if="sessions.length === 0"
            title="No active sessions"
            description="Start a Claude Code session in your terminal and it'll show up here."
          />

          <EmptyState v-else-if="visibleSessions.length === 0" inline :title="noMatchTitle">
            <template #action>
              <Button type="button" variant="ghost" @click="query = ''">Clear search</Button>
            </template>
          </EmptyState>

          <SessionCard
            v-for="session in visibleSessions"
            :key="session.sessionId"
            :session="session"
            :home="home"
            :now="now"
            @expand="openFlow"
          />
        </div>

        <!-- Sticky offset = topbar height + the page's own top padding, so the
             rail parks under the header instead of sliding beneath it. -->
        <div
          data-slot="rail"
          class="lg:top-[calc(var(--spacing-topbar)+var(--spacing)*6)] lg:h-[calc(100vh-var(--spacing-topbar)-var(--spacing)*12)] w-full lg:sticky lg:w-rail lg:shrink-0 lg:self-start lg:overflow-y-auto"
        >
          <AggregatePanel :sessions="sessions" />
        </div>
      </div>
    </main>

    <SessionFlowSheet :session="expandedSession" :focus-turn-index="focusTurnIndex" :home="home" @close="closeFlow" />
  </div>
</template>
