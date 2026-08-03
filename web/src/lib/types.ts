/**
 * Mirrors server/src/types.ts EnrichedSession. Kept as a separate copy
 * (rather than importing across the workspace boundary) so the web
 * workspace has no build-time dependency on the server package.
 */
export type PidReuseResult = "match" | "mismatch" | "unknown";

export interface GitInfo {
  branch: string;
  dirty: boolean;
}

/** Mirrors server/src/transcript-index.ts TruncatedText. */
export interface TruncatedText {
  text: string;
  truncated: boolean;
}

/** Mirrors server/src/transcript-index.ts TokenUsage. */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  /** input + cacheRead + cacheCreation of the same message — what actually occupies the context window. */
  contextTokens: number;
}

/** Mirrors server/src/transcript-index.ts ToolCall. */
export interface ToolCall {
  name: string;
  /** file_path/notebook_path for file tools, pattern for search tools, the command string for shell tools, else null. */
  target: string | null;
}

/**
 * Mirrors server/src/summarizer.ts TurnSummary. The user's prompt is always
 * rendered as real captured text and is never LLM-summarized, so this
 * carries no prompt field.
 */
export interface TurnSummary {
  response: string;
}

/** Mirrors server/src/transcript-index.ts TranscriptTurn. */
export interface TranscriptTurn {
  /** Position of this turn across the whole transcript (not reset by the ring buffer). */
  index: number;
  at: string | null;
  prompt: TruncatedText;
  gist: TruncatedText;
  toolNames: string[];
  /** Up to MAX_TOOL_CALLS_PER_TURN entries; see toolCallsOmitted for the overflow count. */
  toolCalls: ToolCall[];
  toolCallsOmitted: number;
  /** Deduped, insertion-ordered list of file-tool targets touched in this turn. */
  filesTouched: string[];
  /** Populated only for the RECENT_SUMMARY_COUNT most-recently-seen turns; see server's summarizer docs. */
  summary: TurnSummary | null;
}

/** Mirrors server/src/transcript-index.ts TranscriptSummary. */
export interface TranscriptSummary {
  turnCount: number;
  lastUserPrompt: TruncatedText | null;
  lastAssistantGist: TruncatedText | null;
  model: string | null;
  usage: TokenUsage | null;
  toolCounts: Record<string, number>;
  toolCallsTotal: number;
  lastEntryAt: string | null;
  scannedBytes: number;
  complete: boolean;
  recentTurns: TranscriptTurn[];
}

/** Mirrors server/src/transcript-index.ts FlowSummary — the /flow endpoint's payload. */
export interface FlowSummary {
  /** Total turns seen across the whole transcript, including any evicted from the retained window. */
  turnCount: number;
  /** How many turns are actually present in `turns` (<= the server's flow retention cap). */
  retainedTurnCount: number;
  /** True when turnCount > retainedTurnCount, i.e. the oldest turns were evicted from the flow window. */
  turnsDropped: boolean;
  turns: TranscriptTurn[];
}

export interface EnrichedSession {
  pid: number;
  sessionId: string;
  cwd: string;
  startedAt: number;
  procStart: string | null;
  version: string | null;
  peerProtocol: number | null;
  kind: string | null;
  entrypoint: string | null;
  name: string | null;
  status: string;
  updatedAt: number | null;
  statusUpdatedAt: number | null;
  sourceFile: string;
  alive: boolean;
  pidReuse: PidReuseResult;
  tty: string | null;
  uptimeSec: number;
  lastActivityAgoSec: number;
  projectSlug: string;
  transcriptPath: string;
  transcriptSize: number | null;
  transcriptMtime: number | null;
  /** Null until the transcript index has completed its first scan of this session. */
  transcriptSummary: TranscriptSummary | null;
  git: GitInfo | null;
}
