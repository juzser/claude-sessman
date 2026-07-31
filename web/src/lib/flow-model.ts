import type { FlowSummary, TranscriptTurn } from "./types";

/** Vertical distance between consecutive turn nodes, in canvas px. */
export const NODE_Y_SPACING = 160;
/** Fixed horizontal position for every node — the graph is a single vertical lane. */
export const NODE_X = 0;

export interface FlowNodeData {
  turn: TranscriptTurn;
}

export interface FlowNode {
  /** The turn's transcript-wide index (stable even once older turns are evicted), not its array position. */
  id: string;
  position: { x: number; y: number };
  data: FlowNodeData;
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
}

export interface FlowGraph {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

/**
 * Deterministically maps a /flow payload into Vue Flow nodes/edges: one node
 * per retained turn, positioned solely by the turn's own index (fixed x, y =
 * index * NODE_Y_SPACING) so layout never shifts as older turns are evicted
 * from the retention window. One edge links each turn to the next in the
 * (already oldest-first) array. Pure — no randomness, no Date.now(), no I/O.
 */
export function buildFlowGraph(flow: FlowSummary): FlowGraph {
  const nodes: FlowNode[] = flow.turns.map((turn) => ({
    id: String(turn.index),
    position: { x: NODE_X, y: turn.index * NODE_Y_SPACING },
    data: { turn },
  }));

  const edges: FlowEdge[] = [];
  for (let i = 0; i < flow.turns.length - 1; i++) {
    const from = flow.turns[i];
    const to = flow.turns[i + 1];
    edges.push({ id: `${from.index}-${to.index}`, source: String(from.index), target: String(to.index) });
  }

  return { nodes, edges };
}
