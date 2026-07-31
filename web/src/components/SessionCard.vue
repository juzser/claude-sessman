<script setup lang="ts">
import { computed } from "vue";
import { avatarGradientFor, avatarStyleFor } from "../lib/identicon";
import { shortenPath } from "../lib/path";
import { displayNameFor } from "../lib/sort-filter";
import { statusVisualFor } from "../lib/status";
import { formatAgo, formatDurationShort } from "../lib/time-ago";
import type { EnrichedSession } from "../lib/types";

const props = defineProps<{
  session: EnrichedSession;
  home: string;
  /** ms-resolution clock tick, bumped by the parent so "updated Ns ago" ticks live. */
  now: number;
}>();

const avatarStyle = computed(() => avatarStyleFor(props.session.sessionId));
const avatarGradient = computed(() => avatarGradientFor(props.session.sessionId));
const name = computed(() => displayNameFor(props.session));
const path = computed(() => shortenPath(props.session.cwd, props.home));
const statusVisual = computed(() => statusVisualFor(props.session.status, props.session.alive));

const lastActivityAgoSec = computed(() => {
  // now is refreshed every second by the parent; recompute the "ago" text
  // from the session's own updatedAt/startedAt anchor so it ticks live
  // instead of freezing at the value the API returned.
  const anchorMs = props.session.updatedAt ?? props.session.startedAt;
  return Math.max(0, Math.round((props.now - anchorMs) / 1000));
});

const uptimeSec = computed(() => {
  return Math.max(0, Math.round((props.now - props.session.startedAt) / 1000));
});

const statusLabel = computed(() => {
  switch (statusVisual.value) {
    case "busy":
      return "busy";
    case "idle":
      return "idle";
    case "dead":
      return "dead";
    default:
      return props.session.status;
  }
});

const dotClass = computed(() => {
  switch (statusVisual.value) {
    case "busy":
      return "bg-amber-400 animate-pulse";
    case "idle":
      return "bg-emerald-400";
    default:
      return "bg-slate-500";
  }
});
</script>

<template>
  <article
    class="flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-4 shadow-sm transition hover:border-slate-700"
    :data-session-id="session.sessionId"
  >
    <header class="flex items-center gap-3">
      <div
        class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-base text-white/90"
        :style="{ backgroundImage: avatarGradient }"
        aria-hidden="true"
      >
        {{ avatarStyle.glyph }}
      </div>
      <div class="min-w-0 flex-1">
        <p class="truncate text-sm font-medium text-slate-100" :title="name">{{ name }}</p>
        <p class="truncate text-xs text-slate-400" :title="session.cwd">{{ path }}</p>
      </div>
      <span
        class="h-2.5 w-2.5 shrink-0 rounded-full"
        :class="dotClass"
        :title="`status: ${statusLabel}`"
        role="status"
        :aria-label="`status: ${statusLabel}`"
      />
    </header>

    <div class="flex flex-wrap items-center gap-2 text-xs text-slate-400">
      <span
        v-if="session.git"
        class="rounded-full border border-slate-700 px-2 py-0.5"
        :class="session.git.dirty ? 'text-amber-300' : 'text-slate-300'"
      >
        {{ session.git.branch }}<span v-if="session.git.dirty">*</span>
      </span>
      <span>uptime {{ formatDurationShort(uptimeSec) }}</span>
    </div>

    <footer class="text-xs text-slate-500">
      updated {{ formatAgo(lastActivityAgoSec) }}
    </footer>
  </article>
</template>
