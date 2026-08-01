import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os, { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "./config.js";
import { createSummaryCache, getOrSummarizeTurn, type SummaryCache } from "./summary-cache.js";
import type { TurnSummary } from "./summarizer.js";

describe("summary cache defaults", () => {
  it("never resolves the default cache dir under ~/.claude", () => {
    const config = loadConfig({});
    const claudeDir = path.join(os.homedir(), ".claude");
    expect(config.summarizer.cacheDir.startsWith(claudeDir)).toBe(false);
  });
});

describe("createSummaryCache", () => {
  let cacheDir: string;
  let cache: SummaryCache;
  const sessionId = "fixture-session-a";

  beforeEach(async () => {
    cacheDir = await mkdtemp(path.join(tmpdir(), "sessman-summary-cache-"));
    cache = createSummaryCache(cacheDir);
  });

  afterEach(async () => {
    await rm(cacheDir, { recursive: true, force: true });
  });

  it("misses on an empty cache, then hits after a set", async () => {
    const miss = await cache.getTurn(sessionId, 3);
    expect(miss).toBeNull();

    const summary: TurnSummary = { prompt: "fix the test", response: "fixed it" };
    await cache.setTurn(sessionId, 3, summary);

    const hit = await cache.getTurn(sessionId, 3);
    expect(hit).toEqual(summary);
  });

  it("mkdir -p's its own summaries directory", async () => {
    await cache.setTurn(sessionId, 1, { prompt: "a", response: "b" });
    const raw = await readFile(path.join(cacheDir, "summaries", `${sessionId}.json`), "utf8");
    expect(JSON.parse(raw)).toEqual({ "1": { prompt: "a", response: "b" } });
  });

  it("treats a corrupt cache file as a miss, never a crash", async () => {
    const summariesDir = path.join(cacheDir, "summaries");
    await mkdir(summariesDir, { recursive: true });
    await writeFile(path.join(summariesDir, `${sessionId}.json`), "{ not valid json", "utf8");

    await expect(cache.getTurn(sessionId, 1)).resolves.toBeNull();
  });

  it("does not lose entries when two turns of the same session are set concurrently", async () => {
    await Promise.all([
      cache.setTurn(sessionId, 1, { prompt: "first ask", response: "first did" }),
      cache.setTurn(sessionId, 2, { prompt: "second ask", response: "second did" }),
    ]);

    const first = await cache.getTurn(sessionId, 1);
    const second = await cache.getTurn(sessionId, 2);
    expect(first).toEqual({ prompt: "first ask", response: "first did" });
    expect(second).toEqual({ prompt: "second ask", response: "second did" });
  });
});

describe("getOrSummarizeTurn", () => {
  let cacheDir: string;
  let cache: SummaryCache;
  const sessionId = "fixture-session-b";

  beforeEach(async () => {
    cacheDir = await mkdtemp(path.join(tmpdir(), "sessman-summary-cache-"));
    cache = createSummaryCache(cacheDir);
  });

  afterEach(async () => {
    await rm(cacheDir, { recursive: true, force: true });
  });

  it("calls the summarizer on a miss, then never again once cached", async () => {
    const summary: TurnSummary = { prompt: "add retry", response: "added retry with backoff" };
    const summarizeTurn = vi.fn().mockResolvedValue(summary);

    const first = await getOrSummarizeTurn(cache, { summarizeTurn }, sessionId, 5, {
      prompt: "please add a retry",
      response: "done",
    });
    expect(first).toEqual(summary);
    expect(summarizeTurn).toHaveBeenCalledTimes(1);

    const second = await getOrSummarizeTurn(cache, { summarizeTurn }, sessionId, 5, {
      prompt: "please add a retry",
      response: "done",
    });
    expect(second).toEqual(summary);
    expect(summarizeTurn).toHaveBeenCalledTimes(1);
  });

  it("does not persist a null summarizer result, so a later call can retry", async () => {
    const summarizeTurn = vi.fn().mockResolvedValue(null);

    const result = await getOrSummarizeTurn(cache, { summarizeTurn }, sessionId, 9, {
      prompt: "x",
      response: "y",
    });
    expect(result).toBeNull();

    const cached = await cache.getTurn(sessionId, 9);
    expect(cached).toBeNull();
  });
});
