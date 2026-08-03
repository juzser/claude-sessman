import { computed, toValue, type ComputedRef, type MaybeRefOrGetter } from "vue";
import { displayNameFor } from "../lib/sort-filter";
import type { EnrichedSession, ModelUsage, SummedUsage } from "../lib/types";

/** One running subagent, flattened out of its session so the rail can list them together. */
export interface RunningSubagentRow {
  /** Stable v-for key: session plus the dispatch (or agent file) it came from. */
  key: string;
  sessionId: string;
  sessionName: string;
  agentType: string | null;
  description: string | null;
  startedAt: string | null;
}

export interface AggregateUsage {
  /** Field-wise sum of every indexed session's totalUsage; null while none is indexed. */
  total: SummedUsage | null;
  /** The subagent-only slice of `total`, on the same null convention. */
  subagentTotal: SummedUsage | null;
  /** Per-model rows merged across sessions, sorted calls desc then model asc. */
  byModel: ModelUsage[];
  /** Newest dispatch first; unknown start times last. */
  running: RunningSubagentRow[];
}

function addUsage(into: SummedUsage, from: SummedUsage): void {
  into.inputTokens += from.inputTokens;
  into.outputTokens += from.outputTokens;
  into.cacheReadTokens += from.cacheReadTokens;
  into.cacheCreationTokens += from.cacheCreationTokens;
}

function emptyUsage(): SummedUsage {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
}

/**
 * Reduces the session list the app already holds into the rail's three views.
 * Pure and total: no fetch, no endpoint, no clock — the caller decides which
 * sessions are in scope, this only folds whatever it is handed.
 *
 * `total`/`subagentTotal` stay null rather than zero while nothing is indexed,
 * mirroring the server's own convention so the rail can tell "no usage yet"
 * apart from "genuinely zero".
 */
export function aggregateUsage(sessions: EnrichedSession[]): AggregateUsage {
  let total: SummedUsage | null = null;
  let subagentTotal: SummedUsage | null = null;
  const byModel = new Map<string, ModelUsage>();
  const running: RunningSubagentRow[] = [];

  for (const session of sessions) {
    const summary = session.transcriptSummary;
    if (!summary) continue;

    if (summary.totalUsage) {
      total ??= emptyUsage();
      addUsage(total, summary.totalUsage);
    }
    if (summary.subagentUsage) {
      subagentTotal ??= emptyUsage();
      addUsage(subagentTotal, summary.subagentUsage);
    }

    for (const entry of summary.modelBreakdown) {
      const merged = byModel.get(entry.model);
      if (merged) {
        merged.calls += entry.calls;
        addUsage(merged, entry);
      } else {
        byModel.set(entry.model, { ...entry });
      }
    }

    const sessionName = displayNameFor(session);
    const dispatches = new Map(summary.subagents.running.map((entry) => [entry.toolUseId, entry]));

    // A sidecar agent is `running` exactly while its toolUseId is still pending
    // in the main chain, so the two sources describe the same run and are
    // joined on that id — the agent side wins because its .meta.json carries
    // the type/description, and the dispatch side supplies the start time the
    // sidecar record has no field for.
    for (const agent of summary.subagents.agents) {
      if (!agent.running) continue;
      const dispatch = agent.toolUseId === null ? undefined : dispatches.get(agent.toolUseId);
      if (agent.toolUseId !== null) dispatches.delete(agent.toolUseId);
      running.push({
        key: `${session.sessionId}:${agent.toolUseId ?? agent.agentId}`,
        sessionId: session.sessionId,
        sessionName,
        agentType: agent.agentType ?? dispatch?.subagentType ?? null,
        description: agent.description ?? dispatch?.description ?? null,
        startedAt: dispatch?.startedAt ?? null,
      });
    }

    // Whatever is left dispatched but has no sidecar file yet — the agent's own
    // transcript may not have been written, and on older CLI builds never is.
    for (const dispatch of dispatches.values()) {
      running.push({
        key: `${session.sessionId}:${dispatch.toolUseId}`,
        sessionId: session.sessionId,
        sessionName,
        agentType: dispatch.subagentType,
        description: dispatch.description,
        startedAt: dispatch.startedAt,
      });
    }
  }

  const models = [...byModel.values()].sort((a, b) => b.calls - a.calls || a.model.localeCompare(b.model));
  running.sort((a, b) => {
    if (a.startedAt === b.startedAt) return a.key.localeCompare(b.key);
    if (a.startedAt === null) return 1;
    if (b.startedAt === null) return -1;
    return b.startedAt.localeCompare(a.startedAt);
  });

  return { total, subagentTotal, byModel: models, running };
}

/** Reactive wrapper over {@link aggregateUsage} for the rail's components. */
export function useAggregateUsage(
  sessions: MaybeRefOrGetter<EnrichedSession[]>,
): ComputedRef<AggregateUsage> {
  return computed(() => aggregateUsage(toValue(sessions)));
}
