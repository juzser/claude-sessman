<script setup lang="ts">
import { computed } from "vue";
import { Lozenge, type LozengeVariants } from "@/components/ui/lozenge";
import { avatarGradientFor, avatarStyleFor } from "../lib/identicon";
import { shortenPath } from "../lib/path";
import { displayNameFor } from "../lib/sort-filter";
import { statusVisualFor, type StatusVisual } from "../lib/status";
import { formatAgo } from "../lib/time-ago";
import { truncateLine } from "../lib/transcript-format";
import type { EnrichedSession } from "../lib/types";
import FocusButton from "./FocusButton.vue";
import TurnStrip from "./TurnStrip.vue";

const DESCRIPTION_MAX_LENGTH = 90;
const STRIP_TURN_COUNT = 3;

const props = defineProps<{
  session: EnrichedSession;
  home: string;
  /** ms-resolution clock tick, bumped by the parent so "updated Ns ago" ticks live. */
  now: number;
}>();

// The session id travels with the turn index because the parent opens one
// shared flow Sheet for whichever card was expanded.
const emit = defineEmits<{ expand: [sessionId: string, turnIndex: number] }>();

const avatarStyle = computed(() => avatarStyleFor(props.session.sessionId));
const avatarGradient = computed(() => avatarGradientFor(props.session.sessionId));
const name = computed(() => displayNameFor(props.session));
const path = computed(() => shortenPath(props.session.cwd, props.home));

/**
 * Tone deliberately keeps today's colours (busy=amber, idle=emerald) rather
 * than the six-family remap: this is what the operator reads at a glance every
 * day, and only the wording changed. The tone lives on this Lozenge alone —
 * the card surface below is identical for every status.
 */
const STATUSES: Record<StatusVisual, { tone: LozengeVariants["tone"]; label: string }> = {
  busy: { tone: "warning", label: "Working" },
  idle: { tone: "success", label: "Waiting on you" },
  stale: { tone: "neutral", label: "Stale" },
  dead: { tone: "neutral", label: "Ended" },
};

const status = computed(() => STATUSES[statusVisualFor(props.session.status, props.session.alive)]);

const lastActivityAgoSec = computed(() => {
  // now is refreshed every second by the parent; recompute the "ago" text
  // from the session's own updatedAt/startedAt anchor so it ticks live
  // instead of freezing at the value the API returned.
  const anchorMs = props.session.updatedAt ?? props.session.startedAt;
  return Math.max(0, Math.round((props.now - anchorMs) / 1000));
});

/**
 * One line saying what this session is doing. The summarized description and
 * the raw prompt share this slot and its styling on purpose: a summarized card
 * must not be visually distinguishable from an unsummarized one, so there is
 * nothing here marking which of the two the operator is reading.
 */
const description = computed(() => {
  const summary = props.session.transcriptSummary;
  const text = summary?.sessionSummary?.description ?? summary?.lastUserPrompt?.text;
  if (!text) return "No transcript indexed yet";
  return truncateLine(text, DESCRIPTION_MAX_LENGTH);
});

// The list payload already carries recentTurns, so the strip costs no extra
// fetch. Oldest-first within the slice, matching TurnStrip's left-to-right read.
const recentTurns = computed(() => {
  return (props.session.transcriptSummary?.recentTurns ?? []).slice(-STRIP_TURN_COUNT);
});
</script>

<template>
  <article
    class="flex flex-col gap-3 rounded-card bg-surface-raised p-4 shadow-raised ring-1 ring-line"
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
        <p class="truncate text-sm font-medium text-fg" :title="name">{{ name }}</p>
        <p class="truncate text-xs text-fg-subtle" :title="session.cwd">{{ path }}</p>
      </div>
      <Lozenge :tone="status.tone" variant="subtle">{{ status.label }}</Lozenge>
    </header>

    <p data-slot="description" class="line-clamp-1 min-h-4 text-xs text-fg-subtle" :title="description">
      {{ description }}
    </p>

    <TurnStrip
      v-if="recentTurns.length > 0"
      :turns="recentTurns"
      @expand="(turnIndex) => emit('expand', session.sessionId, turnIndex)"
    />

    <footer class="flex items-center justify-between gap-2 text-xs text-fg-subtlest">
      <span>updated {{ formatAgo(lastActivityAgoSec) }}</span>
      <FocusButton :session-id="session.sessionId" size="sm" />
    </footer>
  </article>
</template>
