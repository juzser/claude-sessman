import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Summarizer, TurnSummary } from "./summarizer.js";

type TurnSummaryMap = Record<string, TurnSummary>;

export interface SummaryCache {
  getTurn(sessionId: string, turnIndex: number): Promise<TurnSummary | null>;
  setTurn(sessionId: string, turnIndex: number, summary: TurnSummary): Promise<void>;
}

/**
 * On-disk cache of per-turn summaries, one JSON file per session under
 * `<cacheDir>/summaries/<sessionId>.json`, keyed by turnIndex. Deliberately
 * lives outside ~/.claude (see config.ts's SESSMAN_CACHE_DIR default) —
 * sessman must never write into the operator's Claude directory. A
 * corrupt/unreadable file is treated as a miss, never a crash. Writes to the
 * same session are serialized so two concurrent summarizeTurn calls never
 * clobber each other's entries with a stale read-modify-write.
 */
export function createSummaryCache(cacheDir: string): SummaryCache {
  const summariesDir = path.join(cacheDir, "summaries");
  const writeQueues = new Map<string, Promise<void>>();

  function filePathFor(sessionId: string): string {
    return path.join(summariesDir, `${sessionId}.json`);
  }

  async function readMap(sessionId: string): Promise<TurnSummaryMap> {
    try {
      const raw = await readFile(filePathFor(sessionId), "utf8");
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
      return parsed as TurnSummaryMap;
    } catch {
      // Missing file, unreadable, or corrupt JSON all count as an empty cache.
      return {};
    }
  }

  function withWriteLock(sessionId: string, fn: () => Promise<void>): Promise<void> {
    const previous = writeQueues.get(sessionId) ?? Promise.resolve();
    const next = previous.then(fn, fn);
    // Store a swallowed derivative so a failed write doesn't wedge the queue
    // for later callers, while `next` (returned below) still surfaces the
    // error to whoever made this particular call.
    writeQueues.set(sessionId, next.catch(() => {}));
    return next;
  }

  return {
    async getTurn(sessionId, turnIndex) {
      const map = await readMap(sessionId);
      return map[String(turnIndex)] ?? null;
    },

    setTurn(sessionId, turnIndex, summary) {
      return withWriteLock(sessionId, async () => {
        await mkdir(summariesDir, { recursive: true });
        const map = await readMap(sessionId);
        map[String(turnIndex)] = summary;
        await writeFile(filePathFor(sessionId), JSON.stringify(map), "utf8");
      });
    },
  };
}

/**
 * Wraps a summarizer's summarizeTurn with the cache: a hit returns
 * immediately with no LLM call; a miss calls through and persists a
 * successful result. A `null` result (Ollama down/unparseable) is never
 * cached, so a later call can retry once the backend recovers.
 */
export async function getOrSummarizeTurn(
  cache: SummaryCache,
  summarizer: Pick<Summarizer, "summarizeTurn">,
  sessionId: string,
  turnIndex: number,
  input: { prompt: string; response: string },
): Promise<TurnSummary | null> {
  const cached = await cache.getTurn(sessionId, turnIndex);
  if (cached) return cached;

  const result = await summarizer.summarizeTurn(input);
  if (result) {
    await cache.setTurn(sessionId, turnIndex, result);
  }
  return result;
}
