import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";

const DEFAULT_TTL_MS = 1000;
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

/**
 * Folds one assistant message's model+usage into the running totals —
 * totalUsage, subagentUsage (sidechain-only) and modelBreakdown. Runs for
 * BOTH main-chain and sidechain assistant messages: these are the only
 * fields sidechain lines are allowed to affect (see applyEntry). Never
 * throws; a message missing usage or model contributes to whichever of the
 * two it does have.
 */
function applyAggregateAssistantEntry(state: IndexState, message: Record<string, unknown>, isSidechain: boolean): void {
  const usage = readUsage(message.usage);
  const model = typeof message.model === "string" ? message.model : null;

  if (usage) {
    if (!state.totalUsage) state.totalUsage = emptySummedUsage();
    addUsage(state.totalUsage, usage);
    if (isSidechain) {
      if (!state.subagentUsage) state.subagentUsage = emptySummedUsage();
      addUsage(state.subagentUsage, usage);
    }
  }

  if (model) {
    let entry = state.modelUsage.get(model);
    if (!entry) {
      entry = { model, calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
      state.modelUsage.set(model, entry);
    }
    entry.calls += 1;
    if (usage) {
      entry.inputTokens += usage.inputTokens;
      entry.outputTokens += usage.outputTokens;
      entry.cacheReadTokens += usage.cacheReadTokens;
      entry.cacheCreationTokens += usage.cacheCreationTokens;
    }
  }
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
 * Streams the bytes of `filePath` starting at `startOffset`, calling `onLine`
 * for every complete (newline-terminated) line found. Returns the byte offset
 * immediately after the last complete line — a trailing partial line (no
 * newline yet) is left unconsumed so it's re-read whole next time. Never
 * buffers more than the current chunk plus one pending partial line.
 */
function streamAppend(
  filePath: string,
  startOffset: number,
  onLine: (line: string) => void,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const stream = createReadStream(filePath, { start: startOffset });
    let leftover: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let offset = startOffset;

    stream.on("data", (chunk) => {
      const data = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      const buf = leftover.length ? Buffer.concat([leftover, data]) : data;
      let lineStart = 0;
      for (;;) {
        const newlineIndex = buf.indexOf(0x0a, lineStart);
        if (newlineIndex === -1) break;
        const lineBuf = buf.subarray(lineStart, newlineIndex);
        onLine(lineBuf.toString("utf8"));
        offset += newlineIndex - lineStart + 1;
        lineStart = newlineIndex + 1;
      }
      leftover = buf.subarray(lineStart);
    });
    stream.on("end", () => resolve(offset));
    stream.on("error", reject);
  });
}

async function refreshOne(prior: IndexState | null, transcriptPath: string): Promise<IndexState | null> {
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
  return state;
}

function turnToSummary(turn: MutableTurn, limit: number): TranscriptTurn {
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
  };
}

function toSubagentSummary(state: IndexState): SubagentSummary {
  return {
    sidechainLineCount: state.sidechainLineCount,
    lastSidechainAt: state.lastSidechainAt,
    // Newest-launched first: pendingSubagents is insertion-ordered oldest-first.
    running: [...state.pendingSubagents.values()].reverse(),
  };
}

function toSummary(state: IndexState, textLimit: number): TranscriptSummary {
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
    recentTurns: state.recentTurns.slice(-MAX_RECENT_TURNS).map((turn) => turnToSummary(turn, SUMMARY_TEXT_LIMIT)),
    totalUsage: state.totalUsage ? { ...state.totalUsage } : null,
    subagentUsage: state.subagentUsage ? { ...state.subagentUsage } : null,
    modelBreakdown: buildModelBreakdown(state.modelUsage),
    subagents: toSubagentSummary(state),
  };
}

/** Flow-view payload: every retained turn (up to MAX_FLOW_TURNS), oldest first. */
function toFlowSummary(state: IndexState): FlowSummary {
  return {
    turnCount: state.turnCount,
    retainedTurnCount: state.recentTurns.length,
    turnsDropped: state.turnCount > state.recentTurns.length,
    turns: state.recentTurns.map((turn) => turnToSummary(turn, SUMMARY_TEXT_LIMIT)),
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

  constructor(private readonly ttlMs: number = DEFAULT_TTL_MS) {}

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

    if (!entry.pending && now - entry.fetchedAt >= this.ttlMs) {
      this.startRefresh(sessionId, transcriptPath);
    }

    const current = this.cache.get(sessionId);
    return current?.state ?? null;
  }

  private startRefresh(sessionId: string, transcriptPath: string): Promise<void> {
    const prior = this.cache.get(sessionId) ?? null;

    const pending = refreshOne(prior?.state ?? null, transcriptPath)
      .then((nextState) => {
        this.cache.set(sessionId, { state: nextState, fetchedAt: Date.now(), pending: null });
      })
      .catch(() => {
        this.cache.set(sessionId, {
          state: prior?.state ?? null,
          fetchedAt: Date.now(),
          pending: null,
        });
      });

    this.cache.set(sessionId, {
      state: prior?.state ?? null,
      fetchedAt: prior?.fetchedAt ?? 0,
      pending,
    });

    return pending;
  }
}
