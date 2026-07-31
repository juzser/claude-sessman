import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";

const DEFAULT_TTL_MS = 1000;
const SUMMARY_TEXT_LIMIT = 400;
const DETAIL_TEXT_LIMIT = 2000;
/** Upper bound on how much of any single captured prompt/gist we ever retain in memory. */
const MAX_CAPTURE_LENGTH = DETAIL_TEXT_LIMIT;
const MAX_RECENT_TURNS = 20;

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

export interface TranscriptTurn {
  /** Position of this turn across the whole transcript (not reset by the ring buffer). */
  index: number;
  /** Timestamp of the user prompt line that opened this turn, if known. */
  at: string | null;
  prompt: TruncatedText;
  gist: TruncatedText;
  toolNames: string[];
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
  toolNames: string[];
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
  if (state.recentTurns.length > MAX_RECENT_TURNS) {
    state.recentTurns.shift();
  }
}

/** Folds one already-JSON.parsed transcript line into the running index state. Never throws. */
function applyEntry(state: IndexState, entry: Record<string, unknown>): void {
  const timestamp = typeof entry.timestamp === "string" ? entry.timestamp : null;
  if (timestamp) state.lastEntryAt = timestamp;

  const isSidechain = entry.isSidechain === true;
  if (isSidechain) return;

  if (entry.type === "user") {
    if (entry.isMeta === true) return;
    const message = entry.message;
    if (!isRecord(message)) return;
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
      toolNames: [],
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
        if (currentTurn) currentTurn.toolNames.push(block.name);
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
    toolNames: [...turn.toolNames],
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
    recentTurns: state.recentTurns.map((turn) => turnToSummary(turn, SUMMARY_TEXT_LIMIT)),
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

  /** Test hook: waits for the in-flight scan (or starts and waits for one) so assertions are deterministic. */
  refreshAndWait(sessionId: string, transcriptPath: string): Promise<void> {
    const entry = this.cache.get(sessionId);
    if (entry?.pending) return entry.pending;
    return this.startRefresh(sessionId, transcriptPath);
  }

  private read(sessionId: string, transcriptPath: string, textLimit: number): TranscriptSummary | null {
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
    return current?.state ? toSummary(current.state, textLimit) : null;
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
