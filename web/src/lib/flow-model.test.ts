import { describe, expect, it } from "vitest";
import { buildFlowGraph, NODE_Y_SPACING } from "./flow-model";
import type { FlowSummary, TranscriptTurn } from "./types";

/** Builds one synthetic turn with sane defaults, never real transcript content. */
function makeTurn(index: number, overrides: Partial<TranscriptTurn> = {}): TranscriptTurn {
  return {
    index,
    at: `2026-01-01T00:00:${String(index).padStart(2, "0")}.000Z`,
    prompt: { text: `synthetic prompt ${index}`, truncated: false },
    gist: { text: `synthetic gist ${index}`, truncated: false },
    toolNames: [],
    toolCalls: [],
    toolCallsOmitted: 0,
    filesTouched: [],
    ...overrides,
  };
}

function makeFlow(turns: TranscriptTurn[], overrides: Partial<FlowSummary> = {}): FlowSummary {
  return {
    turnCount: turns.length,
    retainedTurnCount: turns.length,
    turnsDropped: false,
    turns,
    ...overrides,
  };
}

describe("buildFlowGraph", () => {
  it("returns an empty graph for a flow summary with no turns", () => {
    expect(buildFlowGraph(makeFlow([]))).toEqual({ nodes: [], edges: [] });
  });

  it("creates one node per turn, keyed by the turn's transcript index (not its array position)", () => {
    // Simulates eviction: the retained window starts at index 20, not 0.
    const flow = makeFlow([makeTurn(20), makeTurn(21), makeTurn(22)]);
    const graph = buildFlowGraph(flow);

    expect(graph.nodes.map((n) => n.id)).toEqual(["20", "21", "22"]);
    expect(graph.nodes[0].data.turn).toEqual(flow.turns[0]);
  });

  it("positions nodes at a fixed x and y proportional to the turn's index", () => {
    const flow = makeFlow([makeTurn(3), makeTurn(4)]);
    const graph = buildFlowGraph(flow);

    expect(graph.nodes[0].position).toEqual({ x: graph.nodes[1].position.x, y: 3 * NODE_Y_SPACING });
    expect(graph.nodes[1].position).toEqual({ x: graph.nodes[0].position.x, y: 4 * NODE_Y_SPACING });
  });

  it("creates an edge from each turn to the next turn, in array order", () => {
    const flow = makeFlow([makeTurn(0), makeTurn(1), makeTurn(2)]);
    const graph = buildFlowGraph(flow);

    expect(graph.edges).toHaveLength(2);
    expect(graph.edges[0]).toMatchObject({ source: "0", target: "1" });
    expect(graph.edges[1]).toMatchObject({ source: "1", target: "2" });
  });

  it("returns a single node and no edges for a single-turn flow", () => {
    const graph = buildFlowGraph(makeFlow([makeTurn(0)]));
    expect(graph.nodes).toHaveLength(1);
    expect(graph.edges).toEqual([]);
  });

  it("is deterministic: the same input always produces an identical graph", () => {
    const flow = makeFlow([makeTurn(0), makeTurn(1)]);
    expect(buildFlowGraph(flow)).toEqual(buildFlowGraph(flow));
  });
});
