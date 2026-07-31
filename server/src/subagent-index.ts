import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { streamAppend } from "./jsonl-stream.js";

/**
 * A real sum of token usage across one or more assistant messages inside a
 * single subagent's `agent-<id>.jsonl`. Structurally identical to
 * transcript-index.ts's `SummedUsage` (deliberately duplicated rather than
 * imported — see the module doc below).
 */
export interface SubagentUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

/** The four keys documented for `agent-<id>.meta.json`. Any other shape/missing file degrades to all-null fields. */
export interface SubagentMeta {
  agentType: string | null;
  description: string | null;
  spawnDepth: number | null;
  /** Matches the main-chain tool_use block id that dispatched this subagent — the join key back to `RunningSubagent`. */
  toolUseId: string | null;
}

/** One subagent discovered under `<transcriptDir>/<sessionId>/subagents/`, whether still running or already finished. */
export interface SubagentRecord {
  agentId: string;
  agentType: string | null;
  description: string | null;
  spawnDepth: number | null;
  toolUseId: string | null;
  /** Summed usage across every assistant message in this agent's .jsonl, folded once per message.id. Null until at least one usage snapshot is seen. */
  usage: SubagentUsage | null;
}

/** Per-`message.id` dedup, mirroring transcript-index.ts's AssistantMessageDedup but usage-only (no per-model call bookkeeping needed here). */
interface MessageDedup {
  usageFinalized: boolean;
}

interface AgentFileState {
  /** Byte offset of the last complete line parsed so far in this agent's .jsonl. */
  offset: number;
  usage: SubagentUsage | null;
  messageDedup: Map<string, MessageDedup>;
  meta: SubagentMeta | null;
  /** True once a `.meta.json` has been successfully read+parsed at least once — retried on later polls while false, since it can be written slightly after the .jsonl starts filling. */
  metaLoaded: boolean;
}

/** Incremental scan state for every subagent discovered so far in one session's `subagents/` directory. */
export interface SubagentIndexState {
  agents: Map<string, AgentFileState>;
}

export function emptySubagentIndexState(): SubagentIndexState {
  return { agents: new Map() };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberOr0(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function emptySubagentUsage(): SubagentUsage {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
}

function readSubagentUsage(usage: unknown): SubagentUsage | null {
  if (!isRecord(usage)) return null;
  return {
    inputTokens: numberOr0(usage.input_tokens),
    outputTokens: numberOr0(usage.output_tokens),
    cacheReadTokens: numberOr0(usage.cache_read_input_tokens),
    cacheCreationTokens: numberOr0(usage.cache_creation_input_tokens),
  };
}

function addSubagentUsage(target: SubagentUsage, usage: SubagentUsage): void {
  target.inputTokens += usage.inputTokens;
  target.outputTokens += usage.outputTokens;
  target.cacheReadTokens += usage.cacheReadTokens;
  target.cacheCreationTokens += usage.cacheCreationTokens;
}

function isZeroSubagentUsage(usage: SubagentUsage): boolean {
  return (
    usage.inputTokens === 0 &&
    usage.outputTokens === 0 &&
    usage.cacheReadTokens === 0 &&
    usage.cacheCreationTokens === 0
  );
}

/**
 * Folds one assistant message's usage into `fileState.usage`, deduped by
 * `message.id` exactly like transcript-index.ts's applyAggregateAssistantEntry:
 * a real transcript writes one logical assistant message as multiple JSONL
 * lines (one per content block), each repeating an IDENTICAL usage snapshot
 * (a running total, never a delta). Naively summing every line inflates
 * totals by however many lines the message was split across (~2x observed).
 * So this folds each distinct message.id's usage at most once — a later line
 * for the same id is skipped once a non-zero usage has been folded for it,
 * with no requirement that the lines be contiguous (an intervening poll, or
 * an intervening line for a different id, doesn't matter).
 */
function applyAgentAssistantMessage(fileState: AgentFileState, message: Record<string, unknown>): void {
  const usage = readSubagentUsage(message.usage);
  const messageId = typeof message.id === "string" ? message.id : null;

  if (messageId === null) {
    // No id to dedup by (rare) — fall back to per-line folding.
    if (usage) {
      if (!fileState.usage) fileState.usage = emptySubagentUsage();
      addSubagentUsage(fileState.usage, usage);
    }
    return;
  }

  let dedup = fileState.messageDedup.get(messageId);
  if (!dedup) {
    dedup = { usageFinalized: false };
    fileState.messageDedup.set(messageId, dedup);
  }

  if (usage !== null && !dedup.usageFinalized) {
    if (!fileState.usage) fileState.usage = emptySubagentUsage();
    addSubagentUsage(fileState.usage, usage);
    if (!isZeroSubagentUsage(usage)) dedup.usageFinalized = true;
  }
}

/** Folds one already-JSON.parsed agent-*.jsonl line into `fileState`. Never throws. */
function applyAgentEntry(fileState: AgentFileState, entry: Record<string, unknown>): void {
  if (entry.type !== "assistant") return; // user/attachment lines carry no usage to fold
  const message = entry.message;
  if (isRecord(message)) applyAgentAssistantMessage(fileState, message);
}

/** Parses one raw line from an agent-*.jsonl file. Malformed JSON (including a half-written trailing fragment) is skipped silently. */
function applyAgentLine(fileState: AgentFileState, rawLine: string): void {
  const trimmed = rawLine.trim();
  if (!trimmed) return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return;
  }

  if (!isRecord(parsed)) return;
  applyAgentEntry(fileState, parsed);
}

/**
 * Reads and validates `agent-<agentId>.meta.json`. Never throws. A missing
 * file, an unreadable file, JSON that fails to parse, or valid JSON that
 * isn't an object all return `null` (so `refreshOneAgent` leaves `metaLoaded`
 * false and retries on a later poll). Valid JSON that IS an object but has
 * wrong-typed or missing fields returns a non-null meta with just those
 * fields set to `null` — that counts as loaded and is not retried again.
 */
async function readAgentMeta(subagentsDir: string, agentId: string): Promise<SubagentMeta | null> {
  const metaPath = path.join(subagentsDir, `agent-${agentId}.meta.json`);
  let raw: string;
  try {
    raw = await readFile(metaPath, "utf8");
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;

  return {
    agentType: typeof parsed.agentType === "string" ? parsed.agentType : null,
    description: typeof parsed.description === "string" ? parsed.description : null,
    spawnDepth: typeof parsed.spawnDepth === "number" && Number.isFinite(parsed.spawnDepth) ? parsed.spawnDepth : null,
    toolUseId: typeof parsed.toolUseId === "string" ? parsed.toolUseId : null,
  };
}

/** Filename pattern for a subagent's transcript file, e.g. "agent-<agentId>.jsonl" (not ".meta.json"). */
const AGENT_JSONL_NAME = /^agent-(.+)\.jsonl$/;

async function refreshOneAgent(state: SubagentIndexState, subagentsDir: string, agentId: string): Promise<void> {
  let fileState = state.agents.get(agentId);
  if (!fileState) {
    fileState = { offset: 0, usage: null, messageDedup: new Map(), meta: null, metaLoaded: false };
    state.agents.set(agentId, fileState);
  }

  if (!fileState.metaLoaded) {
    const meta = await readAgentMeta(subagentsDir, agentId);
    if (meta) {
      fileState.meta = meta;
      fileState.metaLoaded = true;
    }
    // Missing/malformed meta: leave metaLoaded false so a later poll (once the
    // sidecar file lands) can pick it up — the record still reports usage in
    // the meantime with null meta fields.
  }

  const filePath = path.join(subagentsDir, `agent-${agentId}.jsonl`);
  let stats;
  try {
    stats = await stat(filePath);
  } catch {
    return; // file vanished since the directory listing — keep whatever we already derived
  }

  // A subagent's own transcript is never the "live, currently-being-written-to
  // by another process" main session file, so unlike transcript-index.ts's
  // refreshOne this doesn't track inode/rotation — just guard against an
  // impossible size regression by resetting.
  if (stats.size < fileState.offset) {
    fileState.offset = 0;
    fileState.usage = null;
    fileState.messageDedup = new Map();
  }

  if (stats.size > fileState.offset) {
    try {
      fileState.offset = await streamAppend(filePath, fileState.offset, (line) => applyAgentLine(fileState, line));
    } catch {
      // A read error mid-scan shouldn't lose previously-derived state.
    }
  }
}

/**
 * Scans `<transcriptDir>/<sessionId>/subagents/` for `agent-*.jsonl` files
 * (each paired with an `agent-*.meta.json`), incrementally folding each one's
 * usage. A missing directory (no subagents ever dispatched, or a Claude Code
 * build/version that doesn't write them) degrades to the unchanged input
 * state — never throws, never loses already-derived state.
 *
 * The directory listing itself is re-read every call (cheap — a session's
 * subagent count is small, dozens at most) so newly-dispatched subagents are
 * picked up; only each individual .jsonl's *bytes* are read incrementally via
 * the same offset-tracking `streamAppend` the main transcript scanner uses.
 */
export async function refreshSubagentIndex(
  state: SubagentIndexState,
  transcriptPath: string,
  sessionId: string,
): Promise<SubagentIndexState> {
  const subagentsDir = path.join(path.dirname(transcriptPath), sessionId, "subagents");

  let entries: string[];
  try {
    entries = await readdir(subagentsDir);
  } catch {
    return state; // no subagents/ directory (yet, or ever) — nothing to add
  }

  for (const name of entries) {
    const match = AGENT_JSONL_NAME.exec(name);
    if (!match) continue;
    await refreshOneAgent(state, subagentsDir, match[1]);
  }

  return state;
}

/** Deterministic (agentId-sorted) snapshot of every subagent discovered so far, finished or still running. */
export function toSubagentRecords(state: SubagentIndexState): SubagentRecord[] {
  return [...state.agents.entries()]
    .map(([agentId, fileState]) => ({
      agentId,
      agentType: fileState.meta?.agentType ?? null,
      description: fileState.meta?.description ?? null,
      spawnDepth: fileState.meta?.spawnDepth ?? null,
      toolUseId: fileState.meta?.toolUseId ?? null,
      usage: fileState.usage ? { ...fileState.usage } : null,
    }))
    .sort((a, b) => a.agentId.localeCompare(b.agentId));
}

/** Sums `usage` across every record that has one (records with no usage yet are skipped, not treated as zero). Null if none has usage yet. */
export function sumSubagentUsage(records: SubagentRecord[]): SubagentUsage | null {
  let total: SubagentUsage | null = null;
  for (const record of records) {
    if (!record.usage) continue;
    if (!total) total = emptySubagentUsage();
    addSubagentUsage(total, record.usage);
  }
  return total;
}
