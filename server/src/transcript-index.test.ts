import { appendFile, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TranscriptIndexCache } from "./transcript-index.js";

/** Builds one synthetic JSONL line, never real transcript content. */
function userPromptLine(text: string, timestamp: string, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "user",
    timestamp,
    isSidechain: false,
    message: { role: "user", content: text },
    ...overrides,
  });
}

function toolResultLine(timestamp: string): string {
  return JSON.stringify({
    type: "user",
    timestamp,
    isSidechain: false,
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "toolu_synthetic_1", content: "synthetic tool output" }],
    },
    toolUseResult: { synthetic: true },
  });
}

function metaLine(timestamp: string): string {
  return JSON.stringify({
    type: "user",
    timestamp,
    isSidechain: false,
    isMeta: true,
    message: { role: "user", content: "synthetic meta reminder" },
  });
}

function assistantLine(
  text: string,
  timestamp: string,
  overrides: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    type: "assistant",
    timestamp,
    isSidechain: false,
    message: {
      role: "assistant",
      model: "synthetic-model-1",
      content: [{ type: "text", text }],
      usage: {
        input_tokens: 10,
        output_tokens: 20,
        cache_read_input_tokens: 30,
        cache_creation_input_tokens: 40,
      },
    },
    ...overrides,
  });
}

function assistantToolUseLine(
  toolName: string,
  timestamp: string,
  overrides: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    type: "assistant",
    timestamp,
    isSidechain: false,
    message: {
      role: "assistant",
      model: "synthetic-model-1",
      content: [{ type: "tool_use", name: toolName, input: { synthetic: true } }],
    },
    ...overrides,
  });
}

describe("TranscriptIndexCache", () => {
  let dir: string;
  let transcriptPath: string;
  const sessionId = "synthetic-session-1";

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "sessman-transcript-"));
    transcriptPath = path.join(dir, `${sessionId}.jsonl`);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns null before the first scan completes, without blocking the caller", () => {
    const cache = new TranscriptIndexCache();
    const before = Date.now();
    const result = cache.getSummary(sessionId, transcriptPath);
    const elapsed = Date.now() - before;
    expect(result).toBeNull();
    expect(elapsed).toBeLessThan(20);
  });

  it("cold-scans a transcript and derives turn count, gist, model and usage", async () => {
    const lines = [
      userPromptLine("first synthetic prompt", "2026-01-01T00:00:00.000Z"),
      assistantLine("first synthetic reply", "2026-01-01T00:00:01.000Z"),
      userPromptLine("second synthetic prompt", "2026-01-01T00:00:02.000Z"),
      assistantToolUseLine("Bash", "2026-01-01T00:00:03.000Z"),
      assistantLine("second synthetic reply", "2026-01-01T00:00:04.000Z"),
    ];
    await writeFile(transcriptPath, lines.map((l) => `${l}\n`).join(""));

    const cache = new TranscriptIndexCache();
    await cache.refreshAndWait(sessionId, transcriptPath);
    const summary = cache.getSummary(sessionId, transcriptPath);

    expect(summary).not.toBeNull();
    expect(summary?.turnCount).toBe(2);
    expect(summary?.lastUserPrompt).toEqual({ text: "second synthetic prompt", truncated: false });
    expect(summary?.lastAssistantGist).toEqual({ text: "second synthetic reply", truncated: false });
    expect(summary?.model).toBe("synthetic-model-1");
    expect(summary?.usage).toEqual({
      inputTokens: 10,
      outputTokens: 20,
      cacheReadTokens: 30,
      cacheCreationTokens: 40,
      contextTokens: 80,
    });
    expect(summary?.toolCounts).toEqual({ Bash: 1 });
    expect(summary?.toolCallsTotal).toBe(1);
    expect(summary?.lastEntryAt).toBe("2026-01-01T00:00:04.000Z");
    expect(summary?.complete).toBe(true);
    expect(summary?.scannedBytes).toBeGreaterThan(0);
    expect(summary?.recentTurns).toHaveLength(2);
    expect(summary?.recentTurns[0]).toMatchObject({
      index: 0,
      prompt: { text: "first synthetic prompt", truncated: false },
      gist: { text: "first synthetic reply", truncated: false },
      toolNames: [],
    });
    expect(summary?.recentTurns[1]).toMatchObject({
      index: 1,
      prompt: { text: "second synthetic prompt", truncated: false },
      gist: { text: "second synthetic reply", truncated: false },
      toolNames: ["Bash"],
    });
  });

  it("excludes tool-result-only and meta user lines from turnCount/prompt", async () => {
    const lines = [
      userPromptLine("real synthetic prompt", "2026-01-01T00:00:00.000Z"),
      assistantToolUseLine("Read", "2026-01-01T00:00:01.000Z"),
      toolResultLine("2026-01-01T00:00:02.000Z"),
      metaLine("2026-01-01T00:00:03.000Z"),
      assistantLine("synthetic gist", "2026-01-01T00:00:04.000Z"),
    ];
    await writeFile(transcriptPath, lines.map((l) => `${l}\n`).join(""));

    const cache = new TranscriptIndexCache();
    await cache.refreshAndWait(sessionId, transcriptPath);
    const summary = cache.getSummary(sessionId, transcriptPath);

    expect(summary?.turnCount).toBe(1);
    expect(summary?.lastUserPrompt).toEqual({ text: "real synthetic prompt", truncated: false });
  });

  it("excludes sidechain (subagent) lines from turnCount, toolCounts and gist", async () => {
    const lines = [
      userPromptLine("main chain prompt", "2026-01-01T00:00:00.000Z"),
      assistantLine("main chain gist", "2026-01-01T00:00:01.000Z"),
      userPromptLine("sidechain prompt", "2026-01-01T00:00:02.000Z", { isSidechain: true }),
      assistantToolUseLine("Grep", "2026-01-01T00:00:03.000Z", { isSidechain: true }),
      assistantLine("sidechain gist", "2026-01-01T00:00:04.000Z", { isSidechain: true }),
    ];
    await writeFile(transcriptPath, lines.map((l) => `${l}\n`).join(""));

    const cache = new TranscriptIndexCache();
    await cache.refreshAndWait(sessionId, transcriptPath);
    const summary = cache.getSummary(sessionId, transcriptPath);

    expect(summary?.turnCount).toBe(1);
    expect(summary?.lastUserPrompt).toEqual({ text: "main chain prompt", truncated: false });
    expect(summary?.lastAssistantGist).toEqual({ text: "main chain gist", truncated: false });
    expect(summary?.toolCounts).toEqual({});
    expect(summary?.toolCallsTotal).toBe(0);
  });

  it("skips malformed and unknown-shaped lines without throwing", async () => {
    const lines = [
      userPromptLine("prompt before garbage", "2026-01-01T00:00:00.000Z"),
      "not valid json {{{",
      JSON.stringify({ type: "custom-title", value: "synthetic title" }),
      JSON.stringify(["array", "instead", "of", "object"]),
      assistantLine("gist after garbage", "2026-01-01T00:00:01.000Z"),
    ];
    await writeFile(transcriptPath, lines.map((l) => `${l}\n`).join(""));

    const cache = new TranscriptIndexCache();
    await expect(cache.refreshAndWait(sessionId, transcriptPath)).resolves.toBeUndefined();
    const summary = cache.getSummary(sessionId, transcriptPath);

    expect(summary?.turnCount).toBe(1);
    expect(summary?.lastAssistantGist).toEqual({ text: "gist after garbage", truncated: false });
  });

  it("only parses the appended bytes on an incremental refresh", async () => {
    const first = userPromptLine("first synthetic prompt", "2026-01-01T00:00:00.000Z");
    await writeFile(transcriptPath, `${first}\n`);

    const cache = new TranscriptIndexCache();
    await cache.refreshAndWait(sessionId, transcriptPath);
    const firstSummary = cache.getSummary(sessionId, transcriptPath);
    expect(firstSummary?.turnCount).toBe(1);
    const offsetAfterFirst = firstSummary?.scannedBytes ?? 0;
    expect(offsetAfterFirst).toBe(Buffer.byteLength(`${first}\n`));

    // Overwrite the already-scanned first line in place with a same-length
    // sentinel. Byte length is unchanged, so size/offset math is undisturbed and
    // the refresh below is still treated as a plain append. A scan that quietly
    // restarted from byte 0 would pick the sentinel up; a truly incremental one
    // cannot, because it never re-reads those bytes.
    const sentinel = "REWRITTEN-IF-RESCANNED";
    const original = "first synthetic prompt";
    expect(Buffer.byteLength(sentinel)).toBe(Buffer.byteLength(original));
    const patched = (await readFile(transcriptPath, "utf8")).replace(original, sentinel);
    expect(patched).toContain(sentinel);
    await writeFile(transcriptPath, patched);

    const second = userPromptLine("second synthetic prompt", "2026-01-01T00:00:01.000Z");
    await appendFile(transcriptPath, `${second}\n`);

    await cache.refreshAndWait(sessionId, transcriptPath);
    const secondSummary = cache.getSummary(sessionId, transcriptPath);
    expect(secondSummary?.turnCount).toBe(2);
    expect(secondSummary?.lastUserPrompt).toEqual({ text: "second synthetic prompt", truncated: false });
    expect(secondSummary?.scannedBytes).toBe(offsetAfterFirst + Buffer.byteLength(`${second}\n`));
    // The first turn still carries the text captured by the first scan.
    expect(secondSummary?.recentTurns[0]?.prompt).toEqual({ text: original, truncated: false });
  });

  it("re-reads a half-written trailing line instead of parsing it as garbage", async () => {
    const complete = userPromptLine("complete synthetic prompt", "2026-01-01T00:00:00.000Z");
    await writeFile(transcriptPath, `${complete}\n`);
    // Simulate a writer mid-flush: no trailing newline yet.
    await appendFile(transcriptPath, '{"type":"user","timestamp":"2026-01-01T00:00:01.000Z"');

    const cache = new TranscriptIndexCache();
    await cache.refreshAndWait(sessionId, transcriptPath);
    const partialSummary = cache.getSummary(sessionId, transcriptPath);
    expect(partialSummary?.turnCount).toBe(1);
    expect(partialSummary?.scannedBytes).toBe(Buffer.byteLength(`${complete}\n`));

    const second = userPromptLine("now-complete synthetic prompt", "2026-01-01T00:00:02.000Z");
    // Overwrite the half-written tail with the fully-formed line.
    await writeFile(transcriptPath, `${complete}\n${second}\n`);

    await cache.refreshAndWait(sessionId, transcriptPath);
    const finalSummary = cache.getSummary(sessionId, transcriptPath);
    expect(finalSummary?.turnCount).toBe(2);
    expect(finalSummary?.lastUserPrompt).toEqual({ text: "now-complete synthetic prompt", truncated: false });
  });

  it("discards state and rescans from 0 when the file is truncated/rotated", async () => {
    const original = [
      userPromptLine("original prompt one", "2026-01-01T00:00:00.000Z"),
      userPromptLine("original prompt two", "2026-01-01T00:00:01.000Z"),
    ];
    await writeFile(transcriptPath, original.map((l) => `${l}\n`).join(""));

    const cache = new TranscriptIndexCache();
    await cache.refreshAndWait(sessionId, transcriptPath);
    expect(cache.getSummary(sessionId, transcriptPath)?.turnCount).toBe(2);

    // Simulate rotation: delete and recreate (new inode) with fresh, shorter content.
    await unlink(transcriptPath);
    const rotated = userPromptLine("rotated prompt", "2026-01-02T00:00:00.000Z");
    await writeFile(transcriptPath, `${rotated}\n`);

    await cache.refreshAndWait(sessionId, transcriptPath);
    const summary = cache.getSummary(sessionId, transcriptPath);
    expect(summary?.turnCount).toBe(1);
    expect(summary?.lastUserPrompt).toEqual({ text: "rotated prompt", truncated: false });
  });

  it("caps the recent-turns ring buffer at the last 20 turns", async () => {
    const lines: string[] = [];
    for (let i = 0; i < 25; i++) {
      lines.push(userPromptLine(`synthetic prompt ${i}`, `2026-01-01T00:00:${String(i).padStart(2, "0")}.000Z`));
    }
    await writeFile(transcriptPath, lines.map((l) => `${l}\n`).join(""));

    const cache = new TranscriptIndexCache();
    await cache.refreshAndWait(sessionId, transcriptPath);
    const summary = cache.getSummary(sessionId, transcriptPath);

    expect(summary?.turnCount).toBe(25);
    expect(summary?.recentTurns).toHaveLength(20);
    expect(summary?.recentTurns[0].index).toBe(5);
    expect(summary?.recentTurns[19].index).toBe(24);
    expect(summary?.recentTurns[0].prompt.text).toBe("synthetic prompt 5");
    expect(summary?.recentTurns[19].prompt.text).toBe("synthetic prompt 24");
  });

  it("truncates a very long prompt to 400 chars in the default summary, and 2000 in the detail summary", async () => {
    const longText = "x".repeat(3000);
    await writeFile(transcriptPath, `${userPromptLine(longText, "2026-01-01T00:00:00.000Z")}\n`);

    const cache = new TranscriptIndexCache();
    await cache.refreshAndWait(sessionId, transcriptPath);

    const summary = cache.getSummary(sessionId, transcriptPath);
    expect(summary?.lastUserPrompt?.text.length).toBe(400);
    expect(summary?.lastUserPrompt?.truncated).toBe(true);

    const detail = cache.getDetailSummary(sessionId, transcriptPath);
    expect(detail?.lastUserPrompt?.text.length).toBe(2000);
    expect(detail?.lastUserPrompt?.truncated).toBe(true);
  });

  it("returns null and never throws when the transcript file doesn't exist yet", async () => {
    const cache = new TranscriptIndexCache();
    await expect(cache.refreshAndWait(sessionId, path.join(dir, "missing.jsonl"))).resolves.toBeUndefined();
    expect(cache.getSummary(sessionId, path.join(dir, "missing.jsonl"))).toBeNull();
  });

  it("does not start a second scan while one is already in flight", async () => {
    const lines = [userPromptLine("prompt one", "2026-01-01T00:00:00.000Z")];
    await writeFile(transcriptPath, lines.map((l) => `${l}\n`).join(""));

    const cache = new TranscriptIndexCache();
    const first = cache.refreshAndWait(sessionId, transcriptPath);
    const second = cache.refreshAndWait(sessionId, transcriptPath);
    await Promise.all([first, second]);

    const summary = cache.getSummary(sessionId, transcriptPath);
    expect(summary?.turnCount).toBe(1);
  });
});
