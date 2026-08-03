import { describe, expect, it } from "vitest";
import { ref } from "vue";
import { aggregateUsage, useAggregateUsage } from "./useAggregateUsage";
import type {
  EnrichedSession,
  ModelUsage,
  RunningSubagent,
  SubagentAgentSummary,
  SummedUsage,
  TranscriptSummary,
} from "../lib/types";

function makeUsage(overrides: Partial<SummedUsage> = {}): SummedUsage {
  return {
    inputTokens: 100,
    outputTokens: 10,
    cacheReadTokens: 1000,
    cacheCreationTokens: 5,
    ...overrides,
  };
}

function makeModelUsage(model: string, overrides: Partial<ModelUsage> = {}): ModelUsage {
  return {
    model,
    calls: 1,
    inputTokens: 100,
    outputTokens: 10,
    cacheReadTokens: 1000,
    cacheCreationTokens: 5,
    ...overrides,
  };
}

function makeSummary(overrides: Partial<TranscriptSummary> = {}): TranscriptSummary {
  return {
    turnCount: 1,
    lastUserPrompt: null,
    lastAssistantGist: null,
    model: null,
    usage: null,
    toolCounts: {},
    toolCallsTotal: 0,
    lastEntryAt: null,
    scannedBytes: 0,
    complete: true,
    recentTurns: [],
    totalUsage: null,
    subagentUsage: null,
    modelBreakdown: [],
    subagents: { sidechainLineCount: 0, lastSidechainAt: null, running: [], agents: [] },
    sessionSummary: null,
    ...overrides,
  };
}

/** Builds one synthetic session; never real transcript paths or session ids. */
function makeSession(sessionId: string, overrides: Partial<EnrichedSession> = {}): EnrichedSession {
  return {
    pid: 1000,
    sessionId,
    cwd: "/tmp/synthetic",
    startedAt: 0,
    procStart: null,
    version: null,
    peerProtocol: null,
    kind: null,
    entrypoint: null,
    name: sessionId,
    status: "running",
    updatedAt: null,
    statusUpdatedAt: null,
    sourceFile: "/tmp/synthetic/session.json",
    alive: true,
    pidReuse: "match",
    tty: null,
    uptimeSec: 0,
    lastActivityAgoSec: 0,
    projectSlug: "synthetic",
    transcriptPath: "/tmp/synthetic/transcript.jsonl",
    transcriptSize: null,
    transcriptMtime: null,
    transcriptSummary: null,
    git: null,
    ...overrides,
  };
}

function makeRunning(toolUseId: string, overrides: Partial<RunningSubagent> = {}): RunningSubagent {
  return {
    toolUseId,
    description: `dispatch ${toolUseId}`,
    subagentType: "worker",
    startedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeAgent(agentId: string, overrides: Partial<SubagentAgentSummary> = {}): SubagentAgentSummary {
  return {
    agentId,
    agentType: "reviewer",
    description: `review ${agentId}`,
    spawnDepth: 1,
    toolUseId: null,
    usage: null,
    running: true,
    ...overrides,
  };
}

describe("aggregateUsage", () => {
  it("reports nulls and empty lists when there are no sessions", () => {
    expect(aggregateUsage([])).toEqual({ total: null, subagentTotal: null, byModel: [], running: [] });
  });

  it("keeps total null while no session has been indexed yet", () => {
    const result = aggregateUsage([makeSession("a"), makeSession("b")]);
    expect(result.total).toBeNull();
    expect(result.subagentTotal).toBeNull();
  });

  it("sums usage field by field across sessions", () => {
    const result = aggregateUsage([
      makeSession("a", { transcriptSummary: makeSummary({ totalUsage: makeUsage() }) }),
      makeSession("b", {
        transcriptSummary: makeSummary({
          totalUsage: makeUsage({ inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheCreationTokens: 4 }),
        }),
      }),
    ]);

    expect(result.total).toEqual({
      inputTokens: 101,
      outputTokens: 12,
      cacheReadTokens: 1003,
      cacheCreationTokens: 9,
    });
  });

  it("sums the subagent-only slice separately from the total", () => {
    const result = aggregateUsage([
      makeSession("a", {
        transcriptSummary: makeSummary({
          totalUsage: makeUsage(),
          subagentUsage: makeUsage({ inputTokens: 7, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0 }),
        }),
      }),
      makeSession("b", { transcriptSummary: makeSummary({ totalUsage: makeUsage() }) }),
    ]);

    expect(result.total?.inputTokens).toBe(200);
    expect(result.subagentTotal).toEqual({
      inputTokens: 7,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    });
  });

  it("merges the same model across sessions into one row", () => {
    const result = aggregateUsage([
      makeSession("a", { transcriptSummary: makeSummary({ modelBreakdown: [makeModelUsage("model-x", { calls: 2 })] }) }),
      makeSession("b", { transcriptSummary: makeSummary({ modelBreakdown: [makeModelUsage("model-x", { calls: 3 })] }) }),
    ]);

    expect(result.byModel).toHaveLength(1);
    expect(result.byModel[0]).toMatchObject({ model: "model-x", calls: 5, inputTokens: 200 });
  });

  it("sorts models by call count, then by name, so equal-traffic rows never jitter", () => {
    const result = aggregateUsage([
      makeSession("a", {
        transcriptSummary: makeSummary({
          modelBreakdown: [
            makeModelUsage("model-b", { calls: 1 }),
            makeModelUsage("model-a", { calls: 1 }),
            makeModelUsage("model-c", { calls: 9 }),
          ],
        }),
      }),
    ]);

    expect(result.byModel.map((entry) => entry.model)).toEqual(["model-c", "model-a", "model-b"]);
  });

  it("lists running subagents from the sidecar records, tagged with their session", () => {
    const result = aggregateUsage([
      makeSession("a", {
        name: "alpha",
        transcriptSummary: makeSummary({
          subagents: {
            sidechainLineCount: 0,
            lastSidechainAt: null,
            running: [makeRunning("tool-1")],
            agents: [makeAgent("agent-1", { toolUseId: "tool-1", agentType: "dev", description: "add tests" })],
          },
        }),
      }),
    ]);

    expect(result.running).toEqual([
      {
        key: "a:tool-1",
        sessionId: "a",
        sessionName: "alpha",
        agentType: "dev",
        description: "add tests",
        startedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
  });

  it("counts a subagent once when the sidecar record and the dispatch describe the same run", () => {
    // agents[].running is true exactly while its toolUseId is still pending in
    // the main-chain heuristic, so both sources always describe the same run.
    const result = aggregateUsage([
      makeSession("a", {
        transcriptSummary: makeSummary({
          subagents: {
            sidechainLineCount: 0,
            lastSidechainAt: null,
            running: [makeRunning("tool-1"), makeRunning("tool-2")],
            agents: [makeAgent("agent-1", { toolUseId: "tool-1" })],
          },
        }),
      }),
    ]);

    expect(result.running).toHaveLength(2);
    expect(result.running.map((row) => row.key)).toEqual(["a:tool-1", "a:tool-2"]);
  });

  it("still lists a dispatch whose sidecar file has not been written yet", () => {
    const result = aggregateUsage([
      makeSession("a", {
        transcriptSummary: makeSummary({
          subagents: {
            sidechainLineCount: 0,
            lastSidechainAt: null,
            running: [makeRunning("tool-1", { subagentType: "retriever", description: "fetch docs" })],
            agents: [],
          },
        }),
      }),
    ]);

    expect(result.running).toMatchObject([{ agentType: "retriever", description: "fetch docs" }]);
  });

  it("ignores sidecar agents that have already finished", () => {
    const result = aggregateUsage([
      makeSession("a", {
        transcriptSummary: makeSummary({
          subagents: {
            sidechainLineCount: 0,
            lastSidechainAt: null,
            running: [],
            agents: [makeAgent("agent-1", { toolUseId: "tool-1", running: false })],
          },
        }),
      }),
    ]);

    expect(result.running).toEqual([]);
  });

  it("orders running subagents newest first, with unknown start times last", () => {
    const result = aggregateUsage([
      makeSession("a", {
        transcriptSummary: makeSummary({
          subagents: {
            sidechainLineCount: 0,
            lastSidechainAt: null,
            running: [
              makeRunning("tool-old", { startedAt: "2026-01-01T00:00:00.000Z" }),
              makeRunning("tool-unknown", { startedAt: null }),
              makeRunning("tool-new", { startedAt: "2026-01-01T09:00:00.000Z" }),
            ],
            agents: [],
          },
        }),
      }),
    ]);

    expect(result.running.map((row) => row.key)).toEqual(["a:tool-new", "a:tool-old", "a:tool-unknown"]);
  });
});

describe("useAggregateUsage", () => {
  it("recomputes when the session list changes", () => {
    const sessions = ref<EnrichedSession[]>([]);
    const aggregate = useAggregateUsage(sessions);

    expect(aggregate.value.total).toBeNull();

    sessions.value = [makeSession("a", { transcriptSummary: makeSummary({ totalUsage: makeUsage() }) })];
    expect(aggregate.value.total).toEqual(makeUsage());
  });
});
