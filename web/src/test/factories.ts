import type { EnrichedSession, TranscriptSummary, TranscriptTurn } from "../lib/types";

/**
 * Synthetic builders for the payload shapes the UI renders.
 *
 * Everything here is invented: no real transcript path, session id, or captured
 * text ever appears in this repo's tests. Each builder fills every required
 * field so a test only states the part it is actually asserting on.
 */

export function makeTurn(index: number, overrides: Partial<TranscriptTurn> = {}): TranscriptTurn {
  return {
    index,
    at: `2026-01-01T00:00:${String(index).padStart(2, "0")}.000Z`,
    prompt: { text: `synthetic prompt ${index}`, truncated: false },
    gist: { text: `synthetic gist ${index}`, truncated: false },
    toolNames: [],
    toolCalls: [],
    toolCallsOmitted: 0,
    filesTouched: [],
    continuation: false,
    summary: null,
    ...overrides,
  };
}

export function makeSummary(overrides: Partial<TranscriptSummary> = {}): TranscriptSummary {
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

export function makeSession(sessionId: string, overrides: Partial<EnrichedSession> = {}): EnrichedSession {
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
