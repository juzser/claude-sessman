import { stat } from "node:fs/promises";
import { streamAppend } from "./jsonl-stream.js";
import {
  emptySubagentIndexState,
  refreshSubagentIndex,
  sumSubagentUsage,
  toSubagentRecords,
  type SubagentIndexState,
  type SubagentRecord,
  type SubagentUsage,
} from "./subagent-index.js";
import { getOrSummarizeTurn, type SummaryCache } from "./summary-cache.js";
import { NullSummarizer, type SessionSummary, type Summarizer, type TurnSummary } from "./summarizer.js";

const DEFAULT_TTL_MS = 1000;
/** How many of the most-recently-seen turns ever carry an attached summary — never backfilled onto older turns. */
const RECENT_SUMMARY_COUNT = 3;

/** In-memory no-op cache used when a TranscriptIndexCache is built without an explicit summary cache (e.g. every existing test call site, and any `SESSMAN_SUMMARIZER=null` deployment) — never touches disk. */
const NOOP_SUMMARY_CACHE: SummaryCache = {
  async getTurn() {
    return null;
  },
  async setTurn() {
    // Nothing to persist; NullSummarizer never produces a non-null result to cache anyway.
  },
};
const SUMMARY_TEXT_LIMIT = 400;
const DETAIL_TEXT_LIMIT = 2000;
/** Upper bound on how much of any single captured prompt/gist we ever retain in memory. */
const MAX_CAPTURE_LENGTH = DETAIL_TEXT_LIMIT;
/** How many turns `GET /api/sessions/:id/detail` exposes via `recentTurns` — unchanged by the flow view. */
const MAX_RECENT_TURNS = 20;
/**
 * How many turns the flow view (`GET /api/sessions/:id/flow`) can see, i.e. the
 * actual ring-buffer size turns are held in before `MAX_RECENT_TURNS` slices
 * the tail off for /detail. 100 turns is enough to render a useful flow graph
 * without holding an unbounded amount of a transcript that can reach tens of
 * MB in memory.
 *
 * Per-session worst case with this cap: 100 turns * (2000-char prompt + 2000-char
 * gist + 40 tool calls * (~50-char name + 120-char target) + 40 * 120-char
 * files-touched entries) ≈ 100 * (4_000 + 40*170 + 4_800) chars ≈ 1.56M chars,
 * i.e. roughly 1.5-3 MB of JS string data per indexed session (UTF-16), bounded
 * and independent of the transcript file's own size.
 */
const MAX_FLOW_TURNS = 100;
/** Caps recorded tool calls per turn so one pathological turn (hundreds of tool_use blocks) can't balloon state. */
const MAX_TOOL_CALLS_PER_TURN = 40;
/** Tool-call target strings (file paths, patterns, commands) are truncated to this length. */
const MAX_TOOL_TARGET_LENGTH = 120;
/** Caps how many unresolved Agent/Task dispatches are retained as "currently running" so a stuck/never-returning dispatch can't balloon state. */
const MAX_RUNNING_SUBAGENTS = 20;
/**
 * Caps how many sessions' IndexState TranscriptIndexCache retains at once,
 * evicting the least-recently-accessed entry past this limit (see
 * TranscriptIndexCache.evictOverCap). Without this, a long-lived server
 * retains one entry per sessionId it has ever been asked about, forever.
 * At the ~1.5-3 MB per-session worst case documented above (MAX_FLOW_TURNS),
 * plus a further 5-10% for assistantMessageDedup/subagentIndex (see
 * docs/DATA-CONTRACT.md's "Bounding it, honestly" section for that figure's
 * own derivation), 50 sessions caps this cache at roughly 80-165 MB —
 * generous for a single-operator dashboard's realistic working set of
 * recently-viewed sessions, while still bounding the total.
 */
const MAX_CACHED_SESSIONS = 50;
/** Tool names that dispatch a subagent — matched against tool_use.name for the "currently running" heuristic. */
const SUBAGENT_DISPATCH_TOOL_NAMES = new Set(["Task", "Agent"]);
/** Anchored, case-insensitive prefix match for the auto-generated post-compaction preamble — not a loose substring match. */
const CONTINUATION_PREFIX = /^this session is being continued from a previous conversation that ran out of context/i;

export interface TruncatedText {
  text: string;
  truncated: boolean;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  /** input + cacheRead + cacheCreation of the same message — what actually occupies the context window. */
  contextTokens: number;
}

export interface ToolCall {
  name: string;
  /**
   * file_path/notebook_path for file tools, pattern for search tools, the
   * command string for shell tools, else null (truncated to
   * MAX_TOOL_TARGET_LENGTH chars).
   */
  target: string | null;
}

/**
 * A real sum of token usage across one or more assistant messages. Deliberately
 * has no `contextTokens` field — unlike TokenUsage's per-message contextTokens
 * (a context-window size), a sum of context-window sizes across messages isn't
 * a meaningful number, so it's omitted rather than mis-summed.
 */
export interface SummedUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

/** Per-model token totals and call count. Sum of all entries equals `totalUsage`. */
export interface ModelUsage {
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

/** An Agent/Task dispatch seen as a tool_use block in the main chain, not yet matched to a tool_result. */
export interface RunningSubagent {
  toolUseId: string;
  /** input.description of the dispatching tool_use block, if present as a string. */
  description: string | null;
  /** input.subagent_type of the dispatching tool_use block, if present as a string. */
  subagentType: string | null;
  /** Timestamp of the dispatching tool_use line. */
  startedAt: string | null;
}

/** One subagent discovered under `<transcriptDir>/<sessionId>/subagents/`, joined to the main-chain dispatch (if any) that spawned it. */
export interface SubagentAgentSummary {
  agentId: string;
  agentType: string | null;
  description: string | null;
  spawnDepth: number | null;
  /** The main-chain tool_use id that dispatched this subagent, from its .meta.json — null if the sidecar file has no (or malformed) meta. */
  toolUseId: string | null;
  /** Summed usage across this subagent's own .jsonl, folded once per message.id. Null until at least one usage snapshot is seen. */
  usage: SummedUsage | null;
  /** True while `toolUseId` still matches an unresolved entry in `running` — i.e. no tool_result has arrived for the dispatch yet. */
  running: boolean;
}

export interface SubagentSummary {
  /**
   * Count of `isSidechain: true` lines seen anywhere in the transcript (any
   * entry type). On this CLI version, subagent conversation content is
   * usually stored in separate `subagents/agent-<id>.jsonl` files rather than
   * inline sidechain lines, so this is frequently 0 even while subagents ran —
   * see docs/DATA-CONTRACT.md for the caveat.
   */
  sidechainLineCount: number;
  /** Timestamp of the most recent isSidechain:true line seen, if any. */
  lastSidechainAt: string | null;
  /**
   * Agent/Task tool_use dispatches from the main chain with no matching
   * tool_result yet, most recent first (capped at MAX_RUNNING_SUBAGENTS) —
   * the "currently running" heuristic. See docs/DATA-CONTRACT.md for its
   * failure mode.
   */
  running: RunningSubagent[];
  /**
   * Every subagent discovered under `<transcriptDir>/<sessionId>/subagents/`,
   * finished or still running, sorted by agentId. Joined to `running` above
   * by `toolUseId` where its .meta.json names one. Empty when the CLI version
   * never wrote the directory (or no subagent has run yet) — see
   * docs/DATA-CONTRACT.md.
   */
  agents: SubagentAgentSummary[];
}

export interface TranscriptTurn {
  /** Position of this turn across the whole transcript (not reset by the ring buffer). */
  index: number;
  /** Timestamp of the user prompt line that opened this turn, if known. */
  at: string | null;
  prompt: TruncatedText;
  gist: TruncatedText;
  /** Names only, in call order — derived from toolCalls; kept for existing consumers. */
  toolNames: string[];
  /** Up to MAX_TOOL_CALLS_PER_TURN entries; see toolCallsOmitted for the overflow count. */
  toolCalls: ToolCall[];
  /** How many tool calls beyond MAX_TOOL_CALLS_PER_TURN happened in this turn but weren't recorded individually. */
  toolCallsOmitted: number;
  /** Deduped, insertion-ordered list of file-tool targets touched in this turn. */
  filesTouched: string[];
  /** True when this turn's prompt is the post-compaction continuation preamble. */
  continuation: boolean;
  /**
   * LLM-condensed response summary, present only for the
   * RECENT_SUMMARY_COUNT most-recently-seen turns — never backfilled onto
   * older turns even if they were summarized in the past (see
   * `isWithinSummaryWindow` below). Null while unsummarized (no assistant
   * reply yet, summarizer disabled, or a transient summarizer failure).
   */
  summary: TurnSummary | null;
}

export interface TranscriptSummary {
  turnCount: number;
  lastUserPrompt: TruncatedText | null;
  lastAssistantGist: TruncatedText | null;
  model: string | null;
  usage: TokenUsage | null;
  toolCounts: Record<string, number>;
  toolCallsTotal: number;
  /** Timestamp (ISO string) of the last entry parsed, of any recognised type. */
  lastEntryAt: string | null;
  scannedBytes: number;
  /** Whether the index has scanned this transcript from byte 0 at least once. */
  complete: boolean;
  recentTurns: TranscriptTurn[];
  /** Sum of every assistant message's usage, main chain + sidechain. Null until at least one assistant usage is seen. */
  totalUsage: SummedUsage | null;
  /** Sum of sidechain-only assistant messages' usage. Null until at least one sidechain assistant usage is seen. */
  subagentUsage: SummedUsage | null;
  /** Per-model call counts and token totals, main chain + sidechain, sorted by calls desc then model name asc. */
  modelBreakdown: ModelUsage[];
  subagents: SubagentSummary;
  /** Short LLM-generated description of what the session is currently about, built from its most recent prompts. Null by default (SESSMAN_SUMMARIZER=null) or on any summarizer failure; see refreshSessionSummary. */
  sessionSummary: SessionSummary | null;
}

/** Payload for the flow view: every retained turn (up to MAX_FLOW_TURNS), oldest first. */
export interface FlowSummary {
  /** Total turns seen across the whole transcript, including any evicted from the retained window. */
  turnCount: number;
  /** How many turns are actually present in `turns` (<= MAX_FLOW_TURNS). */
  retainedTurnCount: number;
  /** True when turnCount > retainedTurnCount, i.e. the oldest turns were evicted from the flow window. */
  turnsDropped: boolean;
  turns: TranscriptTurn[];
}

/** Internal, unbounded-length capture; truncated to a display limit only at read time. */
interface Capture {
  raw: string;
  /** True if the original text was longer than MAX_CAPTURE_LENGTH. */
  truncatedAtCapture: boolean;
}

interface MutableTurn {
  index: number;
  at: string | null;
  prompt: Capture;
  gist: Capture | null;
  toolCalls: ToolCall[];
  toolCallsOmitted: number;
  /** Insertion-ordered set of file-tool targets seen so far in this turn (Set preserves insertion order). */
  fileTargets: Set<string>;
  continuation: boolean;
  /** Populated by a background refresh once this turn falls within the most-recent-summary window; see refreshRecentTurnSummaries. */
  summary: TurnSummary | null;
}

/**
 * Per-`message.id` dedup state for {@link applyAggregateAssistantEntry}. Real
 * transcripts write one logical assistant message as multiple JSONL lines
 * (one per content block: thinking/text/tool_use), each carrying an
 * identical copy of `message.usage` — without this, summing per-line
 * inflates totals ~2x. See docs/DATA-CONTRACT.md.
 */
interface AssistantMessageDedup {
  /** Whether modelBreakdown[].calls has already counted this message.id (counts messages, not lines). */
  callCounted: boolean;
  /** Whether a non-zero usage has already been folded for this message.id — a later all-zero line then contributes nothing further. */
  usageFinalized: boolean;
}

interface IndexState {
  size: number;
  mtimeMs: number;
  ino: number;
  /** Byte offset of the last complete (newline-terminated) line parsed so far. */
  offset: number;
  turnCount: number;
  lastUserPrompt: Capture | null;
  lastAssistantGist: Capture | null;
  model: string | null;
  usage: TokenUsage | null;
  toolCounts: Record<string, number>;
  toolCallsTotal: number;
  lastEntryAt: string | null;
  recentTurns: MutableTurn[];
  /** Sum of every assistant message's usage, main chain + sidechain. */
  totalUsage: SummedUsage | null;
  /** Sum of sidechain-only assistant messages' usage. */
  subagentUsage: SummedUsage | null;
  /** Per-model totals, keyed by model name, insertion order not significant (re-sorted at read time). */
  modelUsage: Map<string, ModelUsage>;
  sidechainLineCount: number;
  lastSidechainAt: string | null;
  /** Unresolved Agent/Task dispatches, keyed by their tool_use id, insertion-ordered (Map preserves it). */
  pendingSubagents: Map<string, RunningSubagent>;
  /** Dedup state keyed by assistant `message.id`, so a multi-line message is folded into the aggregates once, not once per line. Grows unboundedly for the life of the process (no eviction) — acceptable, see docs/DATA-CONTRACT.md. */
  assistantMessageDedup: Map<string, AssistantMessageDedup>;
  /** Incremental scan state for `<transcriptDir>/<sessionId>/subagents/*.jsonl` — the real per-subagent transcripts, separate from the inline isSidechain path above. */
  subagentIndex: SubagentIndexState;
  /** Last successfully computed session description, or null before the first success (or when never opted in). See refreshSessionSummary. */
  sessionSummary: SessionSummary | null;
  /** Fingerprint of the recentPrompts that produced sessionSummary, so an unchanged window skips re-calling the summarizer. Null until the first successful computation. */
  sessionSummaryFingerprint: string | null;
}

interface CacheEntry {
  state: IndexState | null;
  fetchedAt: number;
  pending: Promise<void> | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function emptyState(): IndexState {
  return {
    size: 0,
    mtimeMs: 0,
    ino: 0,
    offset: 0,
    turnCount: 0,
    lastUserPrompt: null,
    lastAssistantGist: null,
    model: null,
    usage: null,
    toolCounts: {},
    toolCallsTotal: 0,
    lastEntryAt: null,
    recentTurns: [],
    totalUsage: null,
    subagentUsage: null,
    modelUsage: new Map(),
    sidechainLineCount: 0,
    lastSidechainAt: null,
    pendingSubagents: new Map(),
    assistantMessageDedup: new Map(),
    subagentIndex: emptySubagentIndexState(),
    sessionSummary: null,
    sessionSummaryFingerprint: null,
  };
}

function capture(text: string): Capture {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= MAX_CAPTURE_LENGTH) {
    return { raw: collapsed, truncatedAtCapture: false };
  }
  return { raw: collapsed.slice(0, MAX_CAPTURE_LENGTH), truncatedAtCapture: true };
}

function truncateTo(value: Capture, limit: number): TruncatedText {
  return {
    text: value.raw.slice(0, limit),
    truncated: value.truncatedAtCapture || value.raw.length > limit,
  };
}

/** A real user prompt turn has string content, or an array with at least one text block. */
function extractUserPromptText(content: unknown): string | null {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    const textBlocks = content.filter(
      (block): block is { type: string; text: string } =>
        isRecord(block) && block.type === "text" && typeof block.text === "string",
    );
    if (textBlocks.length === 0) return null;
    return textBlocks.map((block) => block.text).join("\n");
  }
  return null;
}

function numberOr0(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readUsage(usage: unknown): TokenUsage | null {
  if (!isRecord(usage)) return null;
  const inputTokens = numberOr0(usage.input_tokens);
  const outputTokens = numberOr0(usage.output_tokens);
  const cacheReadTokens = numberOr0(usage.cache_read_input_tokens);
  const cacheCreationTokens = numberOr0(usage.cache_creation_input_tokens);
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    contextTokens: inputTokens + cacheReadTokens + cacheCreationTokens,
  };
}

function pushTurn(state: IndexState, turn: MutableTurn): void {
  state.recentTurns.push(turn);
  if (state.recentTurns.length > MAX_FLOW_TURNS) {
    state.recentTurns.shift();
  }
}

function emptySummedUsage(): SummedUsage {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
}

function addUsage(target: SummedUsage, usage: TokenUsage): void {
  target.inputTokens += usage.inputTokens;
  target.outputTokens += usage.outputTokens;
  target.cacheReadTokens += usage.cacheReadTokens;
  target.cacheCreationTokens += usage.cacheCreationTokens;
}

/** True when every one of a TokenUsage's four fields is 0 (as opposed to a real, non-zero snapshot). */
function isZeroUsage(usage: TokenUsage): boolean {
  return (
    usage.inputTokens === 0 &&
    usage.outputTokens === 0 &&
    usage.cacheReadTokens === 0 &&
    usage.cacheCreationTokens === 0
  );
}

/** Adds `usage` into totalUsage (and subagentUsage, if sidechain) — the shared tail of folding one message's usage exactly once. */
function foldUsageTotals(state: IndexState, usage: TokenUsage, isSidechain: boolean): void {
  if (!state.totalUsage) state.totalUsage = emptySummedUsage();
  addUsage(state.totalUsage, usage);
  if (isSidechain) {
    if (!state.subagentUsage) state.subagentUsage = emptySummedUsage();
    addUsage(state.subagentUsage, usage);
  }
}

/** Adds one message's usage (if any) into `model`'s modelBreakdown entry, optionally counting it as a call. */
function foldModelUsage(state: IndexState, model: string, usage: TokenUsage | null, countCall: boolean): void {
  let entry = state.modelUsage.get(model);
  if (!entry) {
    entry = { model, calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
    state.modelUsage.set(model, entry);
  }
  if (countCall) entry.calls += 1;
  if (usage) {
    entry.inputTokens += usage.inputTokens;
    entry.outputTokens += usage.outputTokens;
    entry.cacheReadTokens += usage.cacheReadTokens;
    entry.cacheCreationTokens += usage.cacheCreationTokens;
  }
}

/**
 * Folds one assistant message's model+usage into the running totals —
 * totalUsage, subagentUsage (sidechain-only) and modelBreakdown. Runs for
 * BOTH main-chain and sidechain assistant messages: these are the only
 * fields sidechain lines are allowed to affect (see applyEntry). Never
 * throws; a message missing usage or model contributes to whichever of the
 * two it does have.
 *
 * A real transcript writes one logical assistant message as multiple JSONL
 * lines (one per content block — thinking/text/tool_use), each line carrying
 * an IDENTICAL copy of `message.usage` (a running total, not a delta). Naively
 * folding every line inflates totalUsage/subagentUsage/modelBreakdown by
 * however many lines the message was split across (~2x observed on real
 * transcripts). So this dedups by `message.id`, folding each distinct id's
 * usage+call at most once:
 *  - First line seen for an id: count the call (if it names a model) and fold
 *    whatever usage it carries, even if zero/absent.
 *  - A later line for the SAME id is skipped once a non-zero usage has been
 *    folded for it — including after an intervening tool_result line;
 *    contiguity is irrelevant, only the id matters.
 *  - Exception: if the first line(s) for an id carried only an all-zero (or
 *    missing) usage, a later line with a real, non-zero usage for that same
 *    id still gets folded (the call was already counted, so it doesn't
 *    double-count `calls` — only the usage totals pick up the real value).
 *  - `message.id` missing or non-string: falls back to the pre-dedup,
 *    per-line behaviour (rare).
 */
function applyAggregateAssistantEntry(state: IndexState, message: Record<string, unknown>, isSidechain: boolean): void {
  const usage = readUsage(message.usage);
  const model = typeof message.model === "string" ? message.model : null;
  const messageId = typeof message.id === "string" ? message.id : null;

  if (messageId === null) {
    if (usage) foldUsageTotals(state, usage, isSidechain);
    if (model) foldModelUsage(state, model, usage, true);
    return;
  }

  let dedup = state.assistantMessageDedup.get(messageId);
  if (!dedup) {
    dedup = { callCounted: false, usageFinalized: false };
    state.assistantMessageDedup.set(messageId, dedup);
  }

  // Count the call at most once per message id — whichever content-block
  // line for this id is the first to name a model — no matter how many lines
  // (thinking/text/tool_use) the logical message was split across.
  const isFirstCallForId = model !== null && !dedup.callCounted;
  if (isFirstCallForId) dedup.callCounted = true;

  // Every line for the same logical message repeats an identical usage
  // snapshot (never a delta), so fold it at most once per id — except a
  // later non-zero usage still wins over an earlier all-zero/missing one
  // seen for the same id (rare, but seen in the wild).
  const shouldFoldUsage = usage !== null && !dedup.usageFinalized;
  if (shouldFoldUsage) {
    foldUsageTotals(state, usage, isSidechain);
    if (!isZeroUsage(usage)) dedup.usageFinalized = true;
  }

  if (model && (shouldFoldUsage || isFirstCallForId)) {
    foldModelUsage(state, model, shouldFoldUsage ? usage : null, isFirstCallForId);
  }
}

/**
 * Pure combine of two possibly-null usage snapshots — used to fold the
 * sibling-file-derived subagent usage (recomputed fresh from
 * `state.subagentIndex` on every read) together with the inline-scan-derived
 * accumulator (`state.totalUsage`/`state.subagentUsage`) WITHOUT writing the
 * result back into either source. Read-time-only: `toSummary` can be called
 * any number of times (e.g. by two back-to-back `getSummary` calls with no
 * intervening scan) and always recomputes the same total from the same two
 * never-mutated-together sources, rather than accumulating a fresh file sum
 * onto an already-combined total each time (which would inflate it further on
 * every read).
 */
function combineUsage(a: SummedUsage | null, b: SubagentUsage | null): SummedUsage | null {
  if (!a && !b) return null;
  return {
    inputTokens: (a?.inputTokens ?? 0) + (b?.inputTokens ?? 0),
    outputTokens: (a?.outputTokens ?? 0) + (b?.outputTokens ?? 0),
    cacheReadTokens: (a?.cacheReadTokens ?? 0) + (b?.cacheReadTokens ?? 0),
    cacheCreationTokens: (a?.cacheCreationTokens ?? 0) + (b?.cacheCreationTokens ?? 0),
  };
}

/** Sorted by calls desc, then model name asc — a stable, deterministic ordering for display. */
function buildModelBreakdown(modelUsage: Map<string, ModelUsage>): ModelUsage[] {
  return [...modelUsage.values()]
    .map((entry) => ({ ...entry }))
    .sort((a, b) => b.calls - a.calls || a.model.localeCompare(b.model));
}

/** Anchored, case-insensitive prefix match — a turn merely quoting the phrase mid-prompt does not match. */
function isContinuationPrompt(promptText: string): boolean {
  return CONTINUATION_PREFIX.test(promptText);
}

/**
 * Registers an Agent/Task tool_use block as a "currently running" subagent
 * dispatch until a matching tool_result appears. Ignores tool_use blocks
 * without a string `id` (can't be matched later) and caps the pending set at
 * MAX_RUNNING_SUBAGENTS, evicting the oldest unresolved dispatch first, so a
 * transcript full of never-resolved dispatches can't grow state unbounded.
 */
function registerSubagentLaunch(state: IndexState, block: Record<string, unknown>, timestamp: string | null): void {
  if (typeof block.name !== "string" || !SUBAGENT_DISPATCH_TOOL_NAMES.has(block.name)) return;
  if (typeof block.id !== "string") return;

  const input = isRecord(block.input) ? block.input : {};
  state.pendingSubagents.set(block.id, {
    toolUseId: block.id,
    description: typeof input.description === "string" ? input.description : null,
    subagentType: typeof input.subagent_type === "string" ? input.subagent_type : null,
    startedAt: timestamp,
  });

  while (state.pendingSubagents.size > MAX_RUNNING_SUBAGENTS) {
    const oldestKey = state.pendingSubagents.keys().next().value;
    if (oldestKey === undefined) break;
    state.pendingSubagents.delete(oldestKey);
  }
}

/** Resolves any pending subagent launches whose tool_use id is matched by a tool_result block in this (main-chain) user message. */
function resolvePendingSubagentLaunches(state: IndexState, content: unknown): void {
  if (state.pendingSubagents.size === 0 || !Array.isArray(content)) return;
  for (const block of content) {
    if (!isRecord(block)) continue;
    if (block.type === "tool_result" && typeof block.tool_use_id === "string") {
      state.pendingSubagents.delete(block.tool_use_id);
    }
  }
}

interface ExtractedTarget {
  target: string | null;
  /** True when the target came from a file-identifying field (file_path/notebook_path). */
  isFileTarget: boolean;
}

/** Reads a human-meaningful target out of a tool_use block's `input`. Never throws. */
function extractToolTarget(input: unknown): ExtractedTarget {
  if (!isRecord(input)) return { target: null, isFileTarget: false };
  if (typeof input.file_path === "string") return { target: input.file_path, isFileTarget: true };
  if (typeof input.notebook_path === "string") return { target: input.notebook_path, isFileTarget: true };
  if (typeof input.pattern === "string") return { target: input.pattern, isFileTarget: false };
  if (typeof input.command === "string") return { target: input.command, isFileTarget: false };
  return { target: null, isFileTarget: false };
}

function truncateTarget(target: string): string {
  return target.length > MAX_TOOL_TARGET_LENGTH ? target.slice(0, MAX_TOOL_TARGET_LENGTH) : target;
}

/** Folds one already-JSON.parsed transcript line into the running index state. Never throws. */
function applyEntry(state: IndexState, entry: Record<string, unknown>): void {
  const timestamp = typeof entry.timestamp === "string" ? entry.timestamp : null;
  if (timestamp) state.lastEntryAt = timestamp;

  const isSidechain = entry.isSidechain === true;

  // Aggregate usage/model totals observe BOTH main-chain and sidechain assistant
  // messages — the one place sidechain content is allowed to affect the summary.
  if (entry.type === "assistant") {
    const message = entry.message;
    if (isRecord(message)) applyAggregateAssistantEntry(state, message, isSidechain);
  }

  if (isSidechain) {
    // Anonymous fallback signal (see SubagentSummary): everything else below this
    // point is main-chain-only, exactly as before M4.
    state.sidechainLineCount += 1;
    if (timestamp) state.lastSidechainAt = timestamp;
    return;
  }

  if (entry.type === "user") {
    if (entry.isMeta === true) return;
    const message = entry.message;
    if (!isRecord(message)) return;

    resolvePendingSubagentLaunches(state, message.content);

    const promptText = extractUserPromptText(message.content);
    if (promptText === null) return; // tool-result-only, image-only, or unrecognised shape

    state.turnCount += 1;
    const promptCapture = capture(promptText);
    state.lastUserPrompt = promptCapture;
    pushTurn(state, {
      index: state.turnCount - 1,
      at: timestamp,
      prompt: promptCapture,
      gist: null,
      toolCalls: [],
      toolCallsOmitted: 0,
      fileTargets: new Set(),
      continuation: isContinuationPrompt(promptText),
      summary: null,
    });
    return;
  }

  if (entry.type === "assistant") {
    const message = entry.message;
    if (!isRecord(message)) return;

    if (typeof message.model === "string") state.model = message.model;

    const usage = readUsage(message.usage);
    if (usage) state.usage = usage;

    const content = message.content;
    if (!Array.isArray(content)) return;

    const currentTurn = state.recentTurns[state.recentTurns.length - 1];

    for (const block of content) {
      if (!isRecord(block)) continue;
      if (block.type === "text" && typeof block.text === "string") {
        const gistCapture = capture(block.text);
        state.lastAssistantGist = gistCapture;
        if (currentTurn) currentTurn.gist = gistCapture;
      } else if (block.type === "tool_use" && typeof block.name === "string") {
        state.toolCounts[block.name] = (state.toolCounts[block.name] ?? 0) + 1;
        state.toolCallsTotal += 1;
        registerSubagentLaunch(state, block, timestamp);
        if (currentTurn) {
          if (currentTurn.toolCalls.length < MAX_TOOL_CALLS_PER_TURN) {
            const extracted = extractToolTarget(block.input);
            const target = extracted.target === null ? null : truncateTarget(extracted.target);
            currentTurn.toolCalls.push({ name: block.name, target });
            if (extracted.isFileTarget && target !== null) {
              currentTurn.fileTargets.add(target);
            }
          } else {
            currentTurn.toolCallsOmitted += 1;
          }
        }
      }
    }
  }

  // Any other type (system, attachment, agent-name, custom-title, ...) is not a
  // conversation entry we summarise; skip silently.
}

function applyLine(state: IndexState, rawLine: string): void {
  const trimmed = rawLine.trim();
  if (!trimmed) return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return; // malformed line (including a half-written trailing fragment) — skip silently
  }

  if (!isRecord(parsed)) return; // unknown-shaped line (e.g. a bare array)
  applyEntry(state, parsed);
}

/**
 * Fills in `summary` for whichever of the RECENT_SUMMARY_COUNT most-recent
 * turns don't have one cached yet. Runs as part of the background refresh
 * (see TranscriptIndexCache's non-blocking read/refresh contract above) so it
 * never delays a caller reading the last-known state; a summarizer failure
 * (down, unreachable, unparseable reply) leaves `summary` null rather than
 * throwing, so the next tick just retries. A turn whose assistant hasn't
 * replied yet (`gist === null`) is skipped entirely — never summarized with
 * an empty response. All candidates run concurrently so one slow/unreachable
 * call doesn't serialize behind the others.
 */
async function refreshRecentTurnSummaries(
  state: IndexState,
  sessionId: string,
  summarizer: Pick<Summarizer, "summarizeTurn">,
  summaryCache: SummaryCache,
): Promise<void> {
  const candidates = state.recentTurns
    .slice(-RECENT_SUMMARY_COUNT)
    .filter((turn) => turn.summary === null && turn.gist !== null);

  await Promise.all(
    candidates.map(async (turn) => {
      // gist is narrowed non-null by the filter above, but TS can't see that across the closure.
      const gist = turn.gist;
      if (!gist) return;
      turn.summary = await getOrSummarizeTurn(summaryCache, summarizer, sessionId, turn.index, {
        prompt: turn.prompt.raw,
        response: gist.raw,
      });
    }),
  );
}

/**
 * Recomputes `state.sessionSummary` from the RECENT_SUMMARY_COUNT most recent
 * turns' prompts (the same "recent window" refreshRecentTurnSummaries uses
 * for per-turn summaries), gated by a fingerprint of that same prompt window
 * so an unchanged session skips the LLM call rather than re-summarizing on
 * every background-refresh tick (ttlMs is 1s; a session can sit between
 * turns far longer than that). A failed/null result leaves both
 * sessionSummary and sessionSummaryFingerprint untouched and never throws.
 * Because the fingerprint is stored only on success, the retry that follows
 * a failure is not gated by it: every later tick calls again, on a stable
 * window as much as a moving one, until one call succeeds. That is the
 * point. A summarizer that was unreachable should surface a description as
 * soon as it recovers, not sit null until the operator happens to send
 * another prompt. It mirrors the "never cache a miss" rule that
 * getOrSummarizeTurn already applies to per-turn summaries.
 *
 * Deliberately NOT backed by summary-cache.ts's on-disk, turnIndex-keyed
 * cache: that cache's key models an immutable, once-written turn, whereas
 * the session description is recomputed from an ever-shifting window of the
 * same few turns as the conversation continues. Keying entries by turnIndex
 * (or by every observed prompt-window fingerprint) would only ever grow the
 * file since a session's window keeps changing right up until it ends, with
 * no natural point to prune old entries the way per-turn pruning does. An
 * in-memory fingerprint on IndexState already gives the cheap-cadence
 * dedup this needs without persisting anything across restarts, which the
 * session description doesn't need to survive anyway.
 */
async function refreshSessionSummary(
  state: IndexState,
  summarizer: Pick<Summarizer, "summarizeSession">,
): Promise<void> {
  const recentPrompts = state.recentTurns.slice(-RECENT_SUMMARY_COUNT).map((turn) => turn.prompt.raw);
  if (recentPrompts.length === 0) return;

  const fingerprint = JSON.stringify(recentPrompts);
  if (fingerprint === state.sessionSummaryFingerprint) return;

  const result = await summarizer.summarizeSession({ recentPrompts });
  if (result) {
    state.sessionSummary = result;
    state.sessionSummaryFingerprint = fingerprint;
  }
}

async function refreshOne(
  prior: IndexState | null,
  transcriptPath: string,
  sessionId: string,
  summarizer: Pick<Summarizer, "summarizeTurn" | "summarizeSession">,
  summaryCache: SummaryCache,
): Promise<IndexState | null> {
  let stats;
  try {
    stats = await stat(transcriptPath);
  } catch {
    // Not there (yet, or anymore) — keep whatever we had; nothing new to report.
    return prior;
  }

  const rotated = prior !== null && (stats.ino !== prior.ino || stats.size < prior.offset);
  const state = !prior || rotated ? emptyState() : prior;

  if (stats.size > state.offset) {
    try {
      state.offset = await streamAppend(transcriptPath, state.offset, (line) => applyLine(state, line));
    } catch {
      // A read error mid-scan shouldn't lose previously-derived state; stat
      // fields below still get refreshed so the next tick can retry cleanly.
    }
  }

  state.size = stats.size;
  state.mtimeMs = stats.mtimeMs;
  state.ino = stats.ino;

  // Sibling per-subagent sidecar files live in a directory named after the
  // session id, next to the main transcript. Scanning them never throws (see
  // subagent-index.ts) — an absent directory (older CLI versions, or no
  // subagent has run yet) just leaves state.subagentIndex empty.
  await refreshSubagentIndex(state.subagentIndex, transcriptPath, sessionId);

  // Never blocks the caller of getSummary/getDetailSummary/getFlowSummary:
  // this whole function only ever runs inside a background refresh (see
  // TranscriptIndexCache.startRefresh), which those reads never await.
  await refreshRecentTurnSummaries(state, sessionId, summarizer, summaryCache);
  await refreshSessionSummary(state, summarizer);

  return state;
}

/** The last RECENT_SUMMARY_COUNT turn indices in `recentTurns` (oldest-to-newest ring buffer) — the only turns ever allowed to expose a summary, computed fresh on every read so a turn that ages out of the window stops exposing whatever summary it picked up while it was recent. */
function summaryWindowIndices(recentTurns: MutableTurn[]): Set<number> {
  return new Set(recentTurns.slice(-RECENT_SUMMARY_COUNT).map((turn) => turn.index));
}

function turnToSummary(turn: MutableTurn, limit: number, summaryWindow: Set<number>): TranscriptTurn {
  return {
    index: turn.index,
    at: turn.at,
    prompt: truncateTo(turn.prompt, limit),
    gist: turn.gist ? truncateTo(turn.gist, limit) : { text: "", truncated: false },
    toolNames: turn.toolCalls.map((call) => call.name),
    toolCalls: turn.toolCalls.map((call) => ({ ...call })),
    toolCallsOmitted: turn.toolCallsOmitted,
    filesTouched: [...turn.fileTargets],
    continuation: turn.continuation,
    summary: summaryWindow.has(turn.index) ? turn.summary : null,
  };
}

/**
 * Builds the `agents` list, joining each sibling-file-derived record to the
 * main-chain "running" heuristic by `toolUseId`. A record's `running` flag is
 * true exactly while its `toolUseId` still has an unresolved entry in
 * `state.pendingSubagents` — the same heuristic `SubagentSummary.running`
 * already uses, so a dispatch that never gets a matching sidecar file (older
 * CLI versions) is unaffected, and a sidecar file whose `toolUseId` never
 * appeared as a pending dispatch (or already resolved) is still reported,
 * just with `running: false`.
 */
function toSubagentSummary(state: IndexState, records: SubagentRecord[]): SubagentSummary {
  return {
    sidechainLineCount: state.sidechainLineCount,
    lastSidechainAt: state.lastSidechainAt,
    // Newest-launched first: pendingSubagents is insertion-ordered oldest-first.
    running: [...state.pendingSubagents.values()].reverse(),
    agents: records.map((record) => ({
      agentId: record.agentId,
      agentType: record.agentType,
      description: record.description,
      spawnDepth: record.spawnDepth,
      toolUseId: record.toolUseId,
      usage: record.usage ? { ...record.usage } : null,
      running: record.toolUseId !== null && state.pendingSubagents.has(record.toolUseId),
    })),
  };
}

function toSummary(state: IndexState, textLimit: number): TranscriptSummary {
  // Computed once per read and shared between `agents` and the combined
  // totals below — a pure re-derivation from state.subagentIndex every call,
  // never written back into `state`, so repeated reads (or reads with no
  // intervening scan) always recompute the same numbers instead of stacking
  // a fresh file-derived sum onto an already-combined running total.
  const subagentRecords = toSubagentRecords(state.subagentIndex);
  const fileUsage = sumSubagentUsage(subagentRecords);
  const summaryWindow = summaryWindowIndices(state.recentTurns);

  return {
    turnCount: state.turnCount,
    lastUserPrompt: state.lastUserPrompt ? truncateTo(state.lastUserPrompt, textLimit) : null,
    lastAssistantGist: state.lastAssistantGist ? truncateTo(state.lastAssistantGist, textLimit) : null,
    model: state.model,
    usage: state.usage,
    toolCounts: { ...state.toolCounts },
    toolCallsTotal: state.toolCallsTotal,
    lastEntryAt: state.lastEntryAt,
    scannedBytes: state.offset,
    complete: true,
    // /detail and the default summary only ever expose the last MAX_RECENT_TURNS,
    // even though the underlying ring buffer (state.recentTurns) now holds up to
    // MAX_FLOW_TURNS for the flow view — see toFlowSummary below.
    recentTurns: state.recentTurns
      .slice(-MAX_RECENT_TURNS)
      .map((turn) => turnToSummary(turn, textLimit, summaryWindow)),
    // Sibling-file usage (real subagent transcripts) and the inline-sidechain
    // accumulator are sourced from disjoint bytes on disk — the main
    // transcript file for the latter, `subagents/*.jsonl` for the former —
    // so combining them by addition can't double-count the same event. The
    // "no double counting" regression test in transcript-index.test.ts pins
    // this for the one case that could plausibly conflate them: a subagent
    // whose toolUseId is also tracked by the main-chain running heuristic
    // still contributes its usage exactly once (RunningSubagent carries no
    // usage field of its own to add).
    totalUsage: combineUsage(state.totalUsage, fileUsage),
    subagentUsage: combineUsage(state.subagentUsage, fileUsage),
    modelBreakdown: buildModelBreakdown(state.modelUsage),
    subagents: toSubagentSummary(state, subagentRecords),
    sessionSummary: state.sessionSummary,
  };
}

/** Flow-view payload: every retained turn (up to MAX_FLOW_TURNS), oldest first. */
function toFlowSummary(state: IndexState): FlowSummary {
  const summaryWindow = summaryWindowIndices(state.recentTurns);
  return {
    turnCount: state.turnCount,
    retainedTurnCount: state.recentTurns.length,
    turnsDropped: state.turnCount > state.recentTurns.length,
    turns: state.recentTurns.map((turn) => turnToSummary(turn, SUMMARY_TEXT_LIMIT, summaryWindow)),
  };
}

/**
 * Per-session, incremental, streaming index over a Claude Code transcript
 * (.jsonl). Mirrors GitInfoCache's non-blocking contract: `getSummary` never
 * awaits I/O — it returns the last-known summary (or null before the first
 * scan lands) and kicks off a background refresh, with at most one scan in
 * flight per session at a time. A transcript is never read into memory in
 * full; only the bytes appended since the last scan are streamed, and the
 * derived summary itself is bounded (last-20-turn ring buffer, 2000-char
 * text captures).
 */
export class TranscriptIndexCache {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly ttlMs: number = DEFAULT_TTL_MS,
    private readonly summarizer: Pick<Summarizer, "summarizeTurn" | "summarizeSession"> = new NullSummarizer(),
    private readonly summaryCache: SummaryCache = NOOP_SUMMARY_CACHE,
  ) {}

  getSummary(sessionId: string, transcriptPath: string): TranscriptSummary | null {
    return this.read(sessionId, transcriptPath, SUMMARY_TEXT_LIMIT);
  }

  /** Same cached scan state as getSummary, with prompt/gist truncated at 2000 chars instead of 400. */
  getDetailSummary(sessionId: string, transcriptPath: string): TranscriptSummary | null {
    return this.read(sessionId, transcriptPath, DETAIL_TEXT_LIMIT);
  }

  /** Flow-view payload: up to MAX_FLOW_TURNS retained turns, oldest first. Same non-blocking contract as getSummary. */
  getFlowSummary(sessionId: string, transcriptPath: string): FlowSummary | null {
    const state = this.resolveState(sessionId, transcriptPath);
    return state ? toFlowSummary(state) : null;
  }

  /** Test hook: waits for the in-flight scan (or starts and waits for one) so assertions are deterministic. */
  refreshAndWait(sessionId: string, transcriptPath: string): Promise<void> {
    const entry = this.cache.get(sessionId);
    if (entry?.pending) return entry.pending;
    return this.startRefresh(sessionId, transcriptPath);
  }

  /** Diagnostic: number of sessions currently retained. Not used by production code paths. */
  get size(): number {
    return this.cache.size;
  }

  /** Test-only: exposes cache membership without the side effects reading via getSummary/getFlowSummary would have (a miss kicks off a new background refresh). */
  hasCached(sessionId: string): boolean {
    return this.cache.has(sessionId);
  }

  private read(sessionId: string, transcriptPath: string, textLimit: number): TranscriptSummary | null {
    const state = this.resolveState(sessionId, transcriptPath);
    return state ? toSummary(state, textLimit) : null;
  }

  /** Shared non-blocking read path: returns the last-known state (or null pre-scan) and kicks off a refresh as needed. */
  private resolveState(sessionId: string, transcriptPath: string): IndexState | null {
    const entry = this.cache.get(sessionId);
    const now = Date.now();

    if (!entry) {
      this.startRefresh(sessionId, transcriptPath);
      return null;
    }

    this.touch(sessionId, entry);

    if (!entry.pending && now - entry.fetchedAt >= this.ttlMs) {
      this.startRefresh(sessionId, transcriptPath);
    }

    const current = this.cache.get(sessionId);
    return current?.state ?? null;
  }

  /**
   * Marks sessionId as most-recently-ACCESSED (not just most-recently-written)
   * for evictOverCap's purposes, by re-inserting it at the end of the Map's
   * iteration order — the same delete-then-set idiom this file already uses
   * for pendingSubagents ordering, rather than adding a parallel lastAccessAt
   * timestamp field to CacheEntry.
   */
  private touch(sessionId: string, entry: CacheEntry): void {
    this.cache.delete(sessionId);
    this.cache.set(sessionId, entry);
  }

  /** Single write path for all cache mutations: writes the entry, then enforces the cap, so no call site can bypass eviction. */
  private store(sessionId: string, entry: CacheEntry): void {
    this.cache.set(sessionId, entry);
    this.evictOverCap();
  }

  /**
   * Evicts least-recently-accessed entries (oldest-first Map iteration order)
   * until at or under MAX_CACHED_SESSIONS. Never evicts an entry with a
   * non-null `pending` — dropping an awaited in-flight refresh would let a
   * later resurrection of that entry (from the refresh's own .then/.catch)
   * silently bypass the cap, and would discard work already in flight for no
   * reason. If every over-cap entry is pending, the cache is left over cap;
   * that transient overshoot is preferable to either of those outcomes.
   */
  private evictOverCap(): void {
    for (const [sessionId, entry] of this.cache) {
      if (this.cache.size <= MAX_CACHED_SESSIONS) break;
      if (entry.pending) continue;
      this.cache.delete(sessionId);
    }
  }

  private startRefresh(sessionId: string, transcriptPath: string): Promise<void> {
    const prior = this.cache.get(sessionId) ?? null;

    const pending = refreshOne(prior?.state ?? null, transcriptPath, sessionId, this.summarizer, this.summaryCache)
      .then((nextState) => {
        this.store(sessionId, { state: nextState, fetchedAt: Date.now(), pending: null });
      })
      .catch(() => {
        this.store(sessionId, {
          state: prior?.state ?? null,
          fetchedAt: Date.now(),
          pending: null,
        });
      });

    this.store(sessionId, {
      state: prior?.state ?? null,
      fetchedAt: prior?.fetchedAt ?? 0,
      pending,
    });

    return pending;
  }
}
