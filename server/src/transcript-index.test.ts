import { appendFile, mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSummaryCache } from "./summary-cache.js";
import type { Summarizer } from "./summarizer.js";
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

function toolResultLine(timestamp: string, toolUseId = "toolu_synthetic_1"): string {
  return JSON.stringify({
    type: "user",
    timestamp,
    isSidechain: false,
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: toolUseId, content: "synthetic tool output" }],
    },
    toolUseResult: { synthetic: true },
  });
}

/** Builds an assistant line with a single Agent/Task tool_use dispatch block, carrying an `id` for later tool_result matching. */
function assistantAgentDispatchLine(
  toolUseId: string,
  timestamp: string,
  input: Record<string, unknown> = {},
  toolName = "Task",
): string {
  return JSON.stringify({
    type: "assistant",
    timestamp,
    isSidechain: false,
    message: {
      role: "assistant",
      model: "synthetic-model-1",
      content: [{ type: "tool_use", id: toolUseId, name: toolName, input }],
    },
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
  input: unknown = { synthetic: true },
  overrides: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    type: "assistant",
    timestamp,
    isSidechain: false,
    message: {
      role: "assistant",
      model: "synthetic-model-1",
      content: [{ type: "tool_use", name: toolName, input }],
    },
    ...overrides,
  });
}

/** Builds one assistant line containing several tool_use blocks, to exercise the per-turn cap. */
function assistantMultiToolUseLine(
  toolUses: Array<{ name: string; input?: unknown }>,
  timestamp: string,
): string {
  return JSON.stringify({
    type: "assistant",
    timestamp,
    isSidechain: false,
    message: {
      role: "assistant",
      model: "synthetic-model-1",
      content: toolUses.map((t) => ({ type: "tool_use", name: t.name, input: t.input ?? { synthetic: true } })),
    },
  });
}

/**
 * Builds ONE JSONL line for a single content block of a multi-line assistant
 * message — the shape a real transcript actually uses: one logical message
 * split across several lines (thinking, then text, then tool_use), with
 * EVERY line repeating the same `message.id` and an identical `message.usage`
 * snapshot (a running total for the whole message, never a per-line delta).
 * None of the helpers above ever repeat a `message.id`, which is exactly why
 * the per-line-sum bug went undetected. Pass `messageId: null` to omit the
 * id field entirely (exercising the pre-dedup fallback path).
 */
function assistantMessageBlockLine(
  messageId: string | null,
  block: Record<string, unknown>,
  timestamp: string,
  usage: Record<string, number> | null,
  isSidechain = false,
): string {
  return JSON.stringify({
    type: "assistant",
    timestamp,
    isSidechain,
    message: {
      ...(messageId !== null ? { id: messageId } : {}),
      role: "assistant",
      model: "synthetic-model-1",
      content: [block],
      ...(usage ? { usage } : {}),
    },
  });
}

/** Builds one assistant-message JSONL line as written inside a real `subagents/agent-<id>.jsonl` sidecar file. */
function subagentUsageLine(messageId: string, usage: Record<string, number>, text: string): string {
  return JSON.stringify({
    type: "assistant",
    isSidechain: true,
    message: {
      id: messageId,
      role: "assistant",
      model: "synthetic-model-1",
      content: [{ type: "text", text }],
      usage,
    },
  });
}

/** Builds the content of one `agent-<id>.meta.json` sidecar file — exactly the 4 documented keys. */
function subagentMetaJson(
  overrides: Partial<{ agentType: string; description: string; spawnDepth: number; toolUseId: string }> = {},
): string {
  return JSON.stringify({
    agentType: overrides.agentType ?? "general-purpose",
    description: overrides.description ?? "synthetic subagent task",
    spawnDepth: overrides.spawnDepth ?? 0,
    toolUseId: overrides.toolUseId ?? "toolu_dispatch_1",
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
      assistantToolUseLine("Grep", "2026-01-01T00:00:03.000Z", { synthetic: true }, { isSidechain: true }),
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

  it("gives /detail's recentTurns a longer per-turn prompt/gist than the plain list, at the same 2000-char cap as the top-level fields", async () => {
    const longPrompt = "p".repeat(3000);
    const longGist = "g".repeat(3000);
    await writeFile(
      transcriptPath,
      `${userPromptLine(longPrompt, "2026-01-01T00:00:00.000Z")}\n${assistantLine(longGist, "2026-01-01T00:00:01.000Z")}\n`,
    );

    const cache = new TranscriptIndexCache();
    await cache.refreshAndWait(sessionId, transcriptPath);

    const summary = cache.getSummary(sessionId, transcriptPath);
    expect(summary?.recentTurns[0].prompt.text.length).toBe(400);
    expect(summary?.recentTurns[0].gist.text.length).toBe(400);

    const detail = cache.getDetailSummary(sessionId, transcriptPath);
    expect(detail?.recentTurns[0].prompt.text.length).toBe(2000);
    expect(detail?.recentTurns[0].gist.text.length).toBe(2000);
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

  describe("tool-call targets and files touched (M3 flow view)", () => {
    it("derives a human-meaningful target from tool_use input, per tool kind", async () => {
      const lines = [
        userPromptLine("prompt for tool targets", "2026-01-01T00:00:00.000Z"),
        assistantToolUseLine("Read", "2026-01-01T00:00:01.000Z", { file_path: "/synthetic/path/one.ts" }),
        assistantToolUseLine("NotebookEdit", "2026-01-01T00:00:02.000Z", { notebook_path: "/synthetic/note.ipynb" }),
        assistantToolUseLine("Grep", "2026-01-01T00:00:03.000Z", { pattern: "synthetic-pattern" }),
        assistantToolUseLine("Bash", "2026-01-01T00:00:04.000Z", { command: "echo synthetic" }),
        assistantToolUseLine("TodoWrite", "2026-01-01T00:00:05.000Z", { todos: [] }),
      ];
      await writeFile(transcriptPath, lines.map((l) => `${l}\n`).join(""));

      const cache = new TranscriptIndexCache();
      await cache.refreshAndWait(sessionId, transcriptPath);
      const summary = cache.getSummary(sessionId, transcriptPath);

      expect(summary?.recentTurns[0]?.toolCalls).toEqual([
        { name: "Read", target: "/synthetic/path/one.ts" },
        { name: "NotebookEdit", target: "/synthetic/note.ipynb" },
        { name: "Grep", target: "synthetic-pattern" },
        { name: "Bash", target: "echo synthetic" },
        { name: "TodoWrite", target: null },
      ]);
    });

    it("falls back to a null target without throwing for malformed tool_use input", async () => {
      const lines = [
        userPromptLine("prompt for malformed input", "2026-01-01T00:00:00.000Z"),
        // input missing entirely
        JSON.stringify({
          type: "assistant",
          timestamp: "2026-01-01T00:00:01.000Z",
          isSidechain: false,
          message: { role: "assistant", model: "synthetic-model-1", content: [{ type: "tool_use", name: "Read" }] },
        }),
        // input is not an object
        assistantToolUseLine("Read", "2026-01-01T00:00:02.000Z", "not-an-object"),
        // file_path is not a string
        assistantToolUseLine("Read", "2026-01-01T00:00:03.000Z", { file_path: 12345 }),
      ];
      await writeFile(transcriptPath, lines.map((l) => `${l}\n`).join(""));

      const cache = new TranscriptIndexCache();
      await expect(cache.refreshAndWait(sessionId, transcriptPath)).resolves.toBeUndefined();
      const summary = cache.getSummary(sessionId, transcriptPath);

      expect(summary?.recentTurns[0]?.toolCalls).toEqual([
        { name: "Read", target: null },
        { name: "Read", target: null },
        { name: "Read", target: null },
      ]);
      expect(summary?.recentTurns[0]?.filesTouched).toEqual([]);
    });

    it("truncates a tool target to 120 chars", async () => {
      const longCommand = "x".repeat(300);
      const lines = [
        userPromptLine("prompt for long target", "2026-01-01T00:00:00.000Z"),
        assistantToolUseLine("Bash", "2026-01-01T00:00:01.000Z", { command: longCommand }),
      ];
      await writeFile(transcriptPath, lines.map((l) => `${l}\n`).join(""));

      const cache = new TranscriptIndexCache();
      await cache.refreshAndWait(sessionId, transcriptPath);
      const summary = cache.getSummary(sessionId, transcriptPath);

      expect(summary?.recentTurns[0]?.toolCalls[0]?.target).toHaveLength(120);
    });

    it("caps recorded tool calls per turn at 40 and reports the overflow count", async () => {
      const toolUses = Array.from({ length: 45 }, (_, i) => ({
        name: "Bash",
        input: { command: `synthetic-cmd-${i}` },
      }));
      const lines = [
        userPromptLine("prompt with many tool calls", "2026-01-01T00:00:00.000Z"),
        assistantMultiToolUseLine(toolUses, "2026-01-01T00:00:01.000Z"),
      ];
      await writeFile(transcriptPath, lines.map((l) => `${l}\n`).join(""));

      const cache = new TranscriptIndexCache();
      await cache.refreshAndWait(sessionId, transcriptPath);
      const summary = cache.getSummary(sessionId, transcriptPath);

      expect(summary?.recentTurns[0]?.toolCalls).toHaveLength(40);
      expect(summary?.recentTurns[0]?.toolCalls[0]?.target).toBe("synthetic-cmd-0");
      expect(summary?.recentTurns[0]?.toolCallsOmitted).toBe(5);
    });

    it("reports zero omitted tool calls when the per-turn cap isn't hit", async () => {
      const lines = [
        userPromptLine("prompt with few tool calls", "2026-01-01T00:00:00.000Z"),
        assistantToolUseLine("Bash", "2026-01-01T00:00:01.000Z", { command: "echo one" }),
        assistantToolUseLine("Bash", "2026-01-01T00:00:02.000Z", { command: "echo two" }),
      ];
      await writeFile(transcriptPath, lines.map((l) => `${l}\n`).join(""));

      const cache = new TranscriptIndexCache();
      await cache.refreshAndWait(sessionId, transcriptPath);
      const summary = cache.getSummary(sessionId, transcriptPath);

      expect(summary?.recentTurns[0]?.toolCalls).toHaveLength(2);
      expect(summary?.recentTurns[0]?.toolCallsOmitted).toBe(0);
    });

    it("derives a deduped files-touched list from file-tool targets in a turn", async () => {
      const lines = [
        userPromptLine("prompt for files touched", "2026-01-01T00:00:00.000Z"),
        assistantToolUseLine("Read", "2026-01-01T00:00:01.000Z", { file_path: "/synthetic/a.ts" }),
        assistantToolUseLine("Edit", "2026-01-01T00:00:02.000Z", { file_path: "/synthetic/a.ts" }),
        assistantToolUseLine("Edit", "2026-01-01T00:00:03.000Z", { file_path: "/synthetic/b.ts" }),
        assistantToolUseLine("Grep", "2026-01-01T00:00:04.000Z", { pattern: "synthetic-pattern" }),
      ];
      await writeFile(transcriptPath, lines.map((l) => `${l}\n`).join(""));

      const cache = new TranscriptIndexCache();
      await cache.refreshAndWait(sessionId, transcriptPath);
      const summary = cache.getSummary(sessionId, transcriptPath);

      expect(summary?.recentTurns[0]?.filesTouched).toEqual(["/synthetic/a.ts", "/synthetic/b.ts"]);
    });
  });

  describe("flow retention (M3)", () => {
    it("returns null from getFlowSummary before the first scan completes", () => {
      const cache = new TranscriptIndexCache();
      expect(cache.getFlowSummary(sessionId, transcriptPath)).toBeNull();
    });

    it("retains up to 100 turns for the flow view while summaries still return the last 20, oldest evicted first", async () => {
      const base = new Date("2026-01-01T00:00:00.000Z").getTime();
      const lines: string[] = [];
      for (let i = 0; i < 120; i++) {
        lines.push(userPromptLine(`synthetic prompt ${i}`, new Date(base + i * 1000).toISOString()));
      }
      await writeFile(transcriptPath, lines.map((l) => `${l}\n`).join(""));

      const cache = new TranscriptIndexCache();
      await cache.refreshAndWait(sessionId, transcriptPath);

      const summary = cache.getSummary(sessionId, transcriptPath);
      expect(summary?.turnCount).toBe(120);
      expect(summary?.recentTurns).toHaveLength(20);
      expect(summary?.recentTurns[0]?.index).toBe(100);
      expect(summary?.recentTurns[19]?.index).toBe(119);

      const detail = cache.getDetailSummary(sessionId, transcriptPath);
      expect(detail?.recentTurns).toHaveLength(20);

      const flow = cache.getFlowSummary(sessionId, transcriptPath);
      expect(flow?.turnCount).toBe(120);
      expect(flow?.retainedTurnCount).toBe(100);
      expect(flow?.turnsDropped).toBe(true);
      expect(flow?.turns).toHaveLength(100);
      expect(flow?.turns[0]?.index).toBe(20);
      expect(flow?.turns[99]?.index).toBe(119);
    });

    it("reports turnsDropped false when the transcript has fewer turns than the flow retention cap", async () => {
      const lines = [
        userPromptLine("only prompt", "2026-01-01T00:00:00.000Z"),
        assistantLine("only gist", "2026-01-01T00:00:01.000Z"),
      ];
      await writeFile(transcriptPath, lines.map((l) => `${l}\n`).join(""));

      const cache = new TranscriptIndexCache();
      await cache.refreshAndWait(sessionId, transcriptPath);
      const flow = cache.getFlowSummary(sessionId, transcriptPath);

      expect(flow?.turnCount).toBe(1);
      expect(flow?.retainedTurnCount).toBe(1);
      expect(flow?.turnsDropped).toBe(false);
      expect(flow?.turns).toHaveLength(1);
    });
  });

  describe("aggregate usage and model breakdown (M4)", () => {
    it("sums totalUsage across main-chain and sidechain assistant messages, and isolates subagentUsage to sidechain-only", async () => {
      const lines = [
        assistantLine("main chain reply", "2026-01-01T00:00:00.000Z"),
        assistantLine("sidechain reply", "2026-01-01T00:00:01.000Z", {
          isSidechain: true,
          message: {
            role: "assistant",
            model: "synthetic-model-1",
            content: [{ type: "text", text: "sidechain reply" }],
            usage: {
              input_tokens: 1,
              output_tokens: 2,
              cache_read_input_tokens: 3,
              cache_creation_input_tokens: 4,
            },
          },
        }),
      ];
      await writeFile(transcriptPath, lines.map((l) => `${l}\n`).join(""));

      const cache = new TranscriptIndexCache();
      await cache.refreshAndWait(sessionId, transcriptPath);
      const summary = cache.getSummary(sessionId, transcriptPath);

      // Note: no contextTokens field here — it's a per-message context-window size, not additive.
      expect(summary?.totalUsage).toEqual({
        inputTokens: 11,
        outputTokens: 22,
        cacheReadTokens: 33,
        cacheCreationTokens: 44,
      });
      expect(summary?.subagentUsage).toEqual({
        inputTokens: 1,
        outputTokens: 2,
        cacheReadTokens: 3,
        cacheCreationTokens: 4,
      });
    });

    it("builds modelBreakdown sorted by calls desc then model name asc, summing to totalUsage", async () => {
      const lines = [
        assistantLine("reply from model b, call 1", "2026-01-01T00:00:00.000Z", {
          message: {
            role: "assistant",
            model: "synthetic-model-b",
            content: [{ type: "text", text: "reply from model b, call 1" }],
            usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
          },
        }),
        assistantLine("reply from model a, call 1", "2026-01-01T00:00:01.000Z", {
          message: {
            role: "assistant",
            model: "synthetic-model-a",
            content: [{ type: "text", text: "reply from model a, call 1" }],
            usage: { input_tokens: 2, output_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
          },
        }),
        assistantLine("reply from model a, call 2", "2026-01-01T00:00:02.000Z", {
          message: {
            role: "assistant",
            model: "synthetic-model-a",
            content: [{ type: "text", text: "reply from model a, call 2" }],
            usage: { input_tokens: 3, output_tokens: 3, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
          },
        }),
      ];
      await writeFile(transcriptPath, lines.map((l) => `${l}\n`).join(""));

      const cache = new TranscriptIndexCache();
      await cache.refreshAndWait(sessionId, transcriptPath);
      const summary = cache.getSummary(sessionId, transcriptPath);

      // model-a has 2 calls (more than model-b's 1), so it sorts first despite "a" < "b" being moot here;
      // a tie on calls would fall back to name asc — exercised implicitly since there's no tie in this fixture.
      expect(summary?.modelBreakdown).toEqual([
        { model: "synthetic-model-a", calls: 2, inputTokens: 5, outputTokens: 5, cacheReadTokens: 0, cacheCreationTokens: 0 },
        { model: "synthetic-model-b", calls: 1, inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0 },
      ]);

      const summed = summary!.modelBreakdown.reduce(
        (acc, m) => ({
          inputTokens: acc.inputTokens + m.inputTokens,
          outputTokens: acc.outputTokens + m.outputTokens,
          cacheReadTokens: acc.cacheReadTokens + m.cacheReadTokens,
          cacheCreationTokens: acc.cacheCreationTokens + m.cacheCreationTokens,
        }),
        { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
      );
      expect(summed).toEqual(summary?.totalUsage);
    });

    it("breaks a calls tie by model name ascending", async () => {
      const lines = [
        assistantLine("reply", "2026-01-01T00:00:00.000Z", {
          message: {
            role: "assistant",
            model: "synthetic-model-z",
            content: [{ type: "text", text: "reply" }],
            usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
          },
        }),
        assistantLine("reply", "2026-01-01T00:00:01.000Z", {
          message: {
            role: "assistant",
            model: "synthetic-model-a",
            content: [{ type: "text", text: "reply" }],
            usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
          },
        }),
      ];
      await writeFile(transcriptPath, lines.map((l) => `${l}\n`).join(""));

      const cache = new TranscriptIndexCache();
      await cache.refreshAndWait(sessionId, transcriptPath);
      const summary = cache.getSummary(sessionId, transcriptPath);

      expect(summary?.modelBreakdown.map((m) => m.model)).toEqual(["synthetic-model-a", "synthetic-model-z"]);
    });

    it("counts a usage-but-no-model line into totalUsage only, and a model-but-no-usage line into modelBreakdown with zero tokens", async () => {
      const lines = [
        // usage present, model absent (not a string)
        assistantLine("no model here", "2026-01-01T00:00:00.000Z", {
          message: {
            role: "assistant",
            content: [{ type: "text", text: "no model here" }],
            usage: { input_tokens: 7, output_tokens: 8, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
          },
        }),
        // model present, usage absent
        assistantLine("no usage here", "2026-01-01T00:00:01.000Z", {
          message: {
            role: "assistant",
            model: "synthetic-model-c",
            content: [{ type: "text", text: "no usage here" }],
          },
        }),
      ];
      await writeFile(transcriptPath, lines.map((l) => `${l}\n`).join(""));

      const cache = new TranscriptIndexCache();
      await cache.refreshAndWait(sessionId, transcriptPath);
      const summary = cache.getSummary(sessionId, transcriptPath);

      expect(summary?.totalUsage).toEqual({ inputTokens: 7, outputTokens: 8, cacheReadTokens: 0, cacheCreationTokens: 0 });
      expect(summary?.modelBreakdown).toEqual([
        { model: "synthetic-model-c", calls: 1, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
      ]);
    });

    it("folds a multi-line assistant message (thinking, text, tool_use — same message.id) into totalUsage and modelBreakdown.calls exactly once", async () => {
      const usage = { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 30, cache_creation_input_tokens: 40 };
      const lines = [
        assistantMessageBlockLine("msg_synthetic_a", { type: "thinking", thinking: "synthetic reasoning" }, "2026-01-01T00:00:00.000Z", usage),
        assistantMessageBlockLine("msg_synthetic_a", { type: "text", text: "synthetic reply" }, "2026-01-01T00:00:01.000Z", usage),
        assistantMessageBlockLine("msg_synthetic_a", { type: "tool_use", name: "synthetic-tool", input: { synthetic: true } }, "2026-01-01T00:00:02.000Z", usage),
      ];
      await writeFile(transcriptPath, lines.map((l) => `${l}\n`).join(""));

      const cache = new TranscriptIndexCache();
      await cache.refreshAndWait(sessionId, transcriptPath);
      const summary = cache.getSummary(sessionId, transcriptPath);

      expect(summary?.totalUsage).toEqual({ inputTokens: 10, outputTokens: 20, cacheReadTokens: 30, cacheCreationTokens: 40 });
      expect(summary?.modelBreakdown).toEqual([
        { model: "synthetic-model-1", calls: 1, inputTokens: 10, outputTokens: 20, cacheReadTokens: 30, cacheCreationTokens: 40 },
      ]);
    });

    it("folds a message.id once even when its lines arrive across two separate polls", async () => {
      // The common case in production, not an edge case: the poll interval is
      // ~2s and a writer emits one line per content block as it goes, so a
      // multi-line message routinely straddles a poll boundary. Deduping only
      // works here because `assistantMessageDedup` lives on IndexState and is
      // carried over by the incremental path; a Map local to one parse run
      // would pass every other test in this file and double-count in real use.
      const usage = { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 30, cache_creation_input_tokens: 40 };
      const expectedUsage = { inputTokens: 10, outputTokens: 20, cacheReadTokens: 30, cacheCreationTokens: 40 };
      const expectedBreakdown = [{ model: "synthetic-model-1", calls: 1, ...expectedUsage }];

      const firstHalf = [
        assistantMessageBlockLine("msg_synthetic_split", { type: "thinking", thinking: "synthetic reasoning" }, "2026-01-01T00:00:00.000Z", usage),
        assistantMessageBlockLine("msg_synthetic_split", { type: "text", text: "synthetic reply" }, "2026-01-01T00:00:01.000Z", usage),
      ];
      await writeFile(transcriptPath, firstHalf.map((l) => `${l}\n`).join(""));

      const cache = new TranscriptIndexCache();
      await cache.refreshAndWait(sessionId, transcriptPath);
      // Already folded once by the end of poll 1.
      expect(cache.getSummary(sessionId, transcriptPath)?.totalUsage).toEqual(expectedUsage);
      expect(cache.getSummary(sessionId, transcriptPath)?.modelBreakdown).toEqual(expectedBreakdown);

      const rest = assistantMessageBlockLine(
        "msg_synthetic_split",
        { type: "tool_use", name: "synthetic-tool", input: { synthetic: true } },
        "2026-01-01T00:00:02.000Z",
        usage,
      );
      await appendFile(transcriptPath, `${rest}\n`);
      await cache.refreshAndWait(sessionId, transcriptPath);

      // Poll 2 sees the same id again and must contribute nothing.
      const summary = cache.getSummary(sessionId, transcriptPath);
      expect(summary?.totalUsage).toEqual(expectedUsage);
      expect(summary?.modelBreakdown).toEqual(expectedBreakdown);
    });

    it("still folds a message.id once even when a tool_result line interrupts its content blocks (no contiguous-run shortcut)", async () => {
      const usage = { input_tokens: 5, output_tokens: 6, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
      const lines = [
        assistantMessageBlockLine(
          "msg_synthetic_b",
          { type: "tool_use", id: "toolu_synthetic_b", name: "synthetic-tool", input: {} },
          "2026-01-01T00:00:00.000Z",
          usage,
        ),
        toolResultLine("2026-01-01T00:00:01.000Z", "toolu_synthetic_b"),
        assistantMessageBlockLine("msg_synthetic_b", { type: "text", text: "synthetic follow-up" }, "2026-01-01T00:00:02.000Z", usage),
      ];
      await writeFile(transcriptPath, lines.map((l) => `${l}\n`).join(""));

      const cache = new TranscriptIndexCache();
      await cache.refreshAndWait(sessionId, transcriptPath);
      const summary = cache.getSummary(sessionId, transcriptPath);

      expect(summary?.totalUsage).toEqual({ inputTokens: 5, outputTokens: 6, cacheReadTokens: 0, cacheCreationTokens: 0 });
      expect(summary?.modelBreakdown).toEqual([
        { model: "synthetic-model-1", calls: 1, inputTokens: 5, outputTokens: 6, cacheReadTokens: 0, cacheCreationTokens: 0 },
      ]);
    });

    it("lets a later real usage win over an earlier all-zero usage for the same message.id, without double-counting calls", async () => {
      const zeroUsage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
      const realUsage = { input_tokens: 15, output_tokens: 25, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
      const lines = [
        assistantMessageBlockLine("msg_synthetic_c", { type: "thinking", thinking: "synthetic reasoning" }, "2026-01-01T00:00:00.000Z", zeroUsage),
        assistantMessageBlockLine("msg_synthetic_c", { type: "text", text: "synthetic reply" }, "2026-01-01T00:00:01.000Z", realUsage),
      ];
      await writeFile(transcriptPath, lines.map((l) => `${l}\n`).join(""));

      const cache = new TranscriptIndexCache();
      await cache.refreshAndWait(sessionId, transcriptPath);
      const summary = cache.getSummary(sessionId, transcriptPath);

      expect(summary?.totalUsage).toEqual({ inputTokens: 15, outputTokens: 25, cacheReadTokens: 0, cacheCreationTokens: 0 });
      expect(summary?.modelBreakdown).toEqual([
        { model: "synthetic-model-1", calls: 1, inputTokens: 15, outputTokens: 25, cacheReadTokens: 0, cacheCreationTokens: 0 },
      ]);
    });

    it("folds a multi-line sidechain message once into both totalUsage and subagentUsage", async () => {
      const usage = { input_tokens: 7, output_tokens: 8, cache_read_input_tokens: 9, cache_creation_input_tokens: 10 };
      const lines = [
        assistantMessageBlockLine("msg_synthetic_d", { type: "thinking", thinking: "synthetic sidechain reasoning" }, "2026-01-01T00:00:00.000Z", usage, true),
        assistantMessageBlockLine("msg_synthetic_d", { type: "text", text: "synthetic sidechain reply" }, "2026-01-01T00:00:01.000Z", usage, true),
      ];
      await writeFile(transcriptPath, lines.map((l) => `${l}\n`).join(""));

      const cache = new TranscriptIndexCache();
      await cache.refreshAndWait(sessionId, transcriptPath);
      const summary = cache.getSummary(sessionId, transcriptPath);

      expect(summary?.totalUsage).toEqual({ inputTokens: 7, outputTokens: 8, cacheReadTokens: 9, cacheCreationTokens: 10 });
      expect(summary?.subagentUsage).toEqual({ inputTokens: 7, outputTokens: 8, cacheReadTokens: 9, cacheCreationTokens: 10 });
    });

    it("falls back to per-line folding when message.id is missing, pinning the pre-dedup behaviour rather than silently dropping it", async () => {
      const usage = { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 30, cache_creation_input_tokens: 40 };
      const lines = [
        assistantMessageBlockLine(null, { type: "text", text: "synthetic reply 1" }, "2026-01-01T00:00:00.000Z", usage),
        assistantMessageBlockLine(null, { type: "text", text: "synthetic reply 2" }, "2026-01-01T00:00:01.000Z", usage),
      ];
      await writeFile(transcriptPath, lines.map((l) => `${l}\n`).join(""));

      const cache = new TranscriptIndexCache();
      await cache.refreshAndWait(sessionId, transcriptPath);
      const summary = cache.getSummary(sessionId, transcriptPath);

      // No message.id to dedup by, so each line folds independently — the pre-fix, per-line behaviour.
      expect(summary?.totalUsage).toEqual({ inputTokens: 20, outputTokens: 40, cacheReadTokens: 60, cacheCreationTokens: 80 });
      expect(summary?.modelBreakdown).toEqual([
        { model: "synthetic-model-1", calls: 2, inputTokens: 20, outputTokens: 40, cacheReadTokens: 60, cacheCreationTokens: 80 },
      ]);
    });
  });

  describe("subagent visibility (M4)", () => {
    it("surfaces an Agent/Task dispatch as running until its tool_result arrives", async () => {
      const lines = [
        userPromptLine("please dispatch a helper", "2026-01-01T00:00:00.000Z"),
        assistantAgentDispatchLine(
          "toolu_dispatch_1",
          "2026-01-01T00:00:01.000Z",
          { description: "synthetic helper task", subagent_type: "synthetic-helper" },
        ),
      ];
      await writeFile(transcriptPath, lines.map((l) => `${l}\n`).join(""));

      const cache = new TranscriptIndexCache();
      await cache.refreshAndWait(sessionId, transcriptPath);
      let summary = cache.getSummary(sessionId, transcriptPath);

      expect(summary?.subagents.running).toEqual([
        {
          toolUseId: "toolu_dispatch_1",
          description: "synthetic helper task",
          subagentType: "synthetic-helper",
          startedAt: "2026-01-01T00:00:01.000Z",
        },
      ]);

      await appendFile(transcriptPath, `${toolResultLine("2026-01-01T00:00:02.000Z", "toolu_dispatch_1")}\n`);
      await cache.refreshAndWait(sessionId, transcriptPath);
      summary = cache.getSummary(sessionId, transcriptPath);

      expect(summary?.subagents.running).toEqual([]);
    });

    it("ignores a dispatch tool_use block without a string id, since it can never be matched to a result", async () => {
      const lines = [
        userPromptLine("please dispatch a helper", "2026-01-01T00:00:00.000Z"),
        JSON.stringify({
          type: "assistant",
          timestamp: "2026-01-01T00:00:01.000Z",
          isSidechain: false,
          message: {
            role: "assistant",
            model: "synthetic-model-1",
            content: [{ type: "tool_use", name: "Task", input: { description: "no id here" } }],
          },
        }),
      ];
      await writeFile(transcriptPath, lines.map((l) => `${l}\n`).join(""));

      const cache = new TranscriptIndexCache();
      await cache.refreshAndWait(sessionId, transcriptPath);
      const summary = cache.getSummary(sessionId, transcriptPath);

      expect(summary?.subagents.running).toEqual([]);
    });

    it("counts sidechain lines and tracks the most recent timestamp as an anonymous fallback signal", async () => {
      const lines = [
        userPromptLine("main chain prompt", "2026-01-01T00:00:00.000Z"),
        userPromptLine("sidechain prompt", "2026-01-01T00:00:01.000Z", { isSidechain: true }),
        assistantLine("sidechain gist", "2026-01-01T00:00:02.000Z", { isSidechain: true }),
      ];
      await writeFile(transcriptPath, lines.map((l) => `${l}\n`).join(""));

      const cache = new TranscriptIndexCache();
      await cache.refreshAndWait(sessionId, transcriptPath);
      const summary = cache.getSummary(sessionId, transcriptPath);

      expect(summary?.subagents.sidechainLineCount).toBe(2);
      expect(summary?.subagents.lastSidechainAt).toBe("2026-01-01T00:00:02.000Z");
    });
  });

  describe("real subagent visibility via subagents/ directory (M4 follow-up)", () => {
    it("joins a real subagent (by its .meta.json toolUseId) to the matching running dispatch, then flips to finished once the tool_result arrives", async () => {
      const lines = [
        userPromptLine("please dispatch a helper", "2026-01-01T00:00:00.000Z"),
        assistantAgentDispatchLine(
          "toolu_dispatch_1",
          "2026-01-01T00:00:01.000Z",
          { description: "synthetic helper task", subagent_type: "synthetic-helper" },
        ),
      ];
      await writeFile(transcriptPath, lines.map((l) => `${l}\n`).join(""));

      const subagentsDir = path.join(dir, sessionId, "subagents");
      await mkdir(subagentsDir, { recursive: true });
      await writeFile(
        path.join(subagentsDir, "agent-synthetic-agent-1.jsonl"),
        `${subagentUsageLine(
          "msg_sub_a",
          { input_tokens: 50, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
          "subagent reply",
        )}\n`,
      );
      await writeFile(
        path.join(subagentsDir, "agent-synthetic-agent-1.meta.json"),
        subagentMetaJson({ toolUseId: "toolu_dispatch_1" }),
      );

      const cache = new TranscriptIndexCache();
      await cache.refreshAndWait(sessionId, transcriptPath);
      let summary = cache.getSummary(sessionId, transcriptPath);

      expect(summary?.subagents.agents).toEqual([
        {
          agentId: "synthetic-agent-1",
          agentType: "general-purpose",
          description: "synthetic subagent task",
          spawnDepth: 0,
          toolUseId: "toolu_dispatch_1",
          usage: { inputTokens: 50, outputTokens: 5, cacheReadTokens: 0, cacheCreationTokens: 0 },
          running: true,
        },
      ]);

      // This subagent's toolUseId is tracked by BOTH the main-chain running
      // heuristic (subagents.running, via state.pendingSubagents) and the
      // sibling-file usage sum (subagents.agents[].usage) — the one case
      // where a subagent genuinely "appears in both paths". Its 50/5/0/0
      // must be counted exactly once, not doubled to 100/10/0/0: the running
      // heuristic only ever tracks toolUseId/description/subagentType/startedAt,
      // never a usage figure of its own to add.
      expect(summary?.totalUsage).toEqual({
        inputTokens: 50,
        outputTokens: 5,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      });
      expect(summary?.subagentUsage).toEqual({
        inputTokens: 50,
        outputTokens: 5,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      });

      await appendFile(transcriptPath, `${toolResultLine("2026-01-01T00:00:02.000Z", "toolu_dispatch_1")}\n`);
      await cache.refreshAndWait(sessionId, transcriptPath);
      summary = cache.getSummary(sessionId, transcriptPath);

      expect(summary?.subagents.agents).toEqual([
        {
          agentId: "synthetic-agent-1",
          agentType: "general-purpose",
          description: "synthetic subagent task",
          spawnDepth: 0,
          toolUseId: "toolu_dispatch_1",
          usage: { inputTokens: 50, outputTokens: 5, cacheReadTokens: 0, cacheCreationTokens: 0 },
          running: false,
        },
      ]);
      expect(summary?.totalUsage).toEqual({
        inputTokens: 50,
        outputTokens: 5,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      });
      expect(summary?.subagentUsage).toEqual({
        inputTokens: 50,
        outputTokens: 5,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      });
    });

    it("still reports a finished subagent whose toolUseId was never seen as a pending dispatch in the main chain", async () => {
      await writeFile(
        transcriptPath,
        `${userPromptLine("no dispatch info in the main chain", "2026-01-01T00:00:00.000Z")}\n`,
      );

      const subagentsDir = path.join(dir, sessionId, "subagents");
      await mkdir(subagentsDir, { recursive: true });
      await writeFile(
        path.join(subagentsDir, "agent-synthetic-agent-2.jsonl"),
        `${subagentUsageLine(
          "msg_sub_b",
          { input_tokens: 12, output_tokens: 3, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
          "already finished",
        )}\n`,
      );
      await writeFile(
        path.join(subagentsDir, "agent-synthetic-agent-2.meta.json"),
        subagentMetaJson({ toolUseId: "toolu_never_seen" }),
      );

      const cache = new TranscriptIndexCache();
      await cache.refreshAndWait(sessionId, transcriptPath);
      const summary = cache.getSummary(sessionId, transcriptPath);

      expect(summary?.subagents.agents).toEqual([
        {
          agentId: "synthetic-agent-2",
          agentType: "general-purpose",
          description: "synthetic subagent task",
          spawnDepth: 0,
          toolUseId: "toolu_never_seen",
          usage: { inputTokens: 12, outputTokens: 3, cacheReadTokens: 0, cacheCreationTokens: 0 },
          running: false,
        },
      ]);
      expect(summary?.subagents.running).toEqual([]);
    });

    it("folds sibling-file usage into totalUsage/subagentUsage on top of (not double-counted against) the still-supported inline sidechain path, and repeated reads never re-add it", async () => {
      const inlineSidechainUsage = {
        input_tokens: 5,
        output_tokens: 6,
        cache_read_input_tokens: 7,
        cache_creation_input_tokens: 8,
      };
      const lines = [
        userPromptLine("main chain prompt", "2026-01-01T00:00:00.000Z"),
        assistantLine("main chain reply", "2026-01-01T00:00:01.000Z"), // default usage 10/20/30/40, main-chain only
        assistantMessageBlockLine(
          "msg_inline_sidechain",
          { type: "text", text: "legacy inline sidechain content" },
          "2026-01-01T00:00:02.000Z",
          inlineSidechainUsage,
          true,
        ),
      ];
      await writeFile(transcriptPath, lines.map((l) => `${l}\n`).join(""));

      const subagentsDir = path.join(dir, sessionId, "subagents");
      await mkdir(subagentsDir, { recursive: true });
      await writeFile(
        path.join(subagentsDir, "agent-synthetic-agent-3.jsonl"),
        `${subagentUsageLine(
          "msg_sub_c",
          { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
          "real subagent reply",
        )}\n`,
      );

      const cache = new TranscriptIndexCache();
      await cache.refreshAndWait(sessionId, transcriptPath);
      let summary = cache.getSummary(sessionId, transcriptPath);

      // main-chain (10/20/30/40) + inline sidechain (5/6/7/8) + sibling file (100/20/0/0)
      const expectedTotal = { inputTokens: 115, outputTokens: 46, cacheReadTokens: 37, cacheCreationTokens: 48 };
      // inline sidechain (5/6/7/8) + sibling file (100/20/0/0) — each source counted exactly once
      const expectedSubagent = { inputTokens: 105, outputTokens: 26, cacheReadTokens: 7, cacheCreationTokens: 8 };

      expect(summary?.totalUsage).toEqual(expectedTotal);
      expect(summary?.subagentUsage).toEqual(expectedSubagent);

      // Reading again with no new bytes anywhere must not re-add either source.
      summary = cache.getSummary(sessionId, transcriptPath);
      expect(summary?.totalUsage).toEqual(expectedTotal);
      expect(summary?.subagentUsage).toEqual(expectedSubagent);

      // Nor must an explicit re-scan with nothing new to read.
      await cache.refreshAndWait(sessionId, transcriptPath);
      summary = cache.getSummary(sessionId, transcriptPath);
      expect(summary?.totalUsage).toEqual(expectedTotal);
      expect(summary?.subagentUsage).toEqual(expectedSubagent);
    });

    it("degrades to an empty agents list, without throwing, when subagents/ doesn't exist", async () => {
      await writeFile(transcriptPath, `${userPromptLine("no subagents dir at all", "2026-01-01T00:00:00.000Z")}\n`);

      const cache = new TranscriptIndexCache();
      await cache.refreshAndWait(sessionId, transcriptPath);
      const summary = cache.getSummary(sessionId, transcriptPath);

      expect(summary?.subagents.agents).toEqual([]);
    });
  });

  describe("continuation flag (M4)", () => {
    it("flags a turn whose prompt is the post-compaction preamble, case-insensitively, without dropping or renumbering it", async () => {
      const preamble =
        "This session is being continued from a previous conversation that ran out of context. The summary below covers...";
      const lines = [
        userPromptLine("ordinary first prompt", "2026-01-01T00:00:00.000Z"),
        assistantLine("ordinary reply", "2026-01-01T00:00:01.000Z"),
        userPromptLine(preamble.toUpperCase(), "2026-01-01T00:00:02.000Z"),
      ];
      await writeFile(transcriptPath, lines.map((l) => `${l}\n`).join(""));

      const cache = new TranscriptIndexCache();
      await cache.refreshAndWait(sessionId, transcriptPath);
      const summary = cache.getSummary(sessionId, transcriptPath);

      expect(summary?.turnCount).toBe(2);
      expect(summary?.recentTurns).toHaveLength(2);
      expect(summary?.recentTurns[0]).toMatchObject({ index: 0, continuation: false });
      expect(summary?.recentTurns[1]).toMatchObject({ index: 1, continuation: true });
    });

    it("does not flag a turn that merely mentions the phrase later in its prompt", async () => {
      const lines = [
        userPromptLine(
          'quoting it back: "this session is being continued from a previous conversation that ran out of context" is what the docs say',
          "2026-01-01T00:00:00.000Z",
        ),
      ];
      await writeFile(transcriptPath, lines.map((l) => `${l}\n`).join(""));

      const cache = new TranscriptIndexCache();
      await cache.refreshAndWait(sessionId, transcriptPath);
      const summary = cache.getSummary(sessionId, transcriptPath);

      expect(summary?.recentTurns[0]).toMatchObject({ continuation: false });
    });
  });

  describe("sidechain isolation regression (M4)", () => {
    it("still contributes nothing to turnCount, gist, toolCounts, toolCallsTotal, or the snapshot usage/model fields", async () => {
      const lines = [
        userPromptLine("main chain prompt", "2026-01-01T00:00:00.000Z"),
        assistantLine("main chain gist", "2026-01-01T00:00:01.000Z"),
        userPromptLine("sidechain prompt", "2026-01-01T00:00:02.000Z", { isSidechain: true }),
        assistantToolUseLine("Grep", "2026-01-01T00:00:03.000Z", { synthetic: true }, { isSidechain: true }),
        assistantLine("sidechain gist should not appear", "2026-01-01T00:00:04.000Z", {
          isSidechain: true,
          message: {
            role: "assistant",
            model: "sidechain-only-model",
            content: [{ type: "text", text: "sidechain gist should not appear" }],
            usage: {
              input_tokens: 999,
              output_tokens: 999,
              cache_read_input_tokens: 999,
              cache_creation_input_tokens: 999,
            },
          },
        }),
      ];
      await writeFile(transcriptPath, lines.map((l) => `${l}\n`).join(""));

      const cache = new TranscriptIndexCache();
      await cache.refreshAndWait(sessionId, transcriptPath);
      const summary = cache.getSummary(sessionId, transcriptPath);

      // Main-chain-only fields: completely untouched by the three sidechain lines above.
      expect(summary?.turnCount).toBe(1);
      expect(summary?.lastAssistantGist).toEqual({ text: "main chain gist", truncated: false });
      expect(summary?.toolCounts).toEqual({});
      expect(summary?.toolCallsTotal).toBe(0);
      expect(summary?.recentTurns).toHaveLength(1);

      // The pre-existing snapshot fields stay a last-*main-chain*-message snapshot,
      // not a total — SessionCard.vue renders `usage` as "ctx" from exactly this field.
      expect(summary?.model).toBe("synthetic-model-1");
      expect(summary?.usage).toEqual({
        inputTokens: 10,
        outputTokens: 20,
        cacheReadTokens: 30,
        cacheCreationTokens: 40,
        contextTokens: 80,
      });

      // The new aggregate fields are the only ones allowed to have observed the sidechain data.
      expect(summary?.totalUsage).toEqual({
        inputTokens: 1009,
        outputTokens: 1019,
        cacheReadTokens: 1029,
        cacheCreationTokens: 1039,
      });
      expect(summary?.subagentUsage).toEqual({
        inputTokens: 999,
        outputTokens: 999,
        cacheReadTokens: 999,
        cacheCreationTokens: 999,
      });
    });
  });
});

describe("TranscriptIndexCache turn summaries", () => {
  let dir: string;
  let transcriptPath: string;
  let cacheDir: string;
  const sessionId = "synthetic-summary-session";

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "sessman-transcript-summary-"));
    transcriptPath = path.join(dir, `${sessionId}.jsonl`);
    cacheDir = await mkdtemp(path.join(tmpdir(), "sessman-transcript-summary-cache-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    await rm(cacheDir, { recursive: true, force: true });
  });

  /** A turn: a user prompt line, optionally followed by an assistant reply line. */
  function turnLines(index: number, atBase: number, withReply: boolean): string[] {
    const promptAt = new Date(atBase).toISOString();
    const lines = [userPromptLine(`turn ${index} prompt`, promptAt)];
    if (withReply) {
      const replyAt = new Date(atBase + 1).toISOString();
      lines.push(assistantLine(`turn ${index} reply`, replyAt));
    }
    return lines;
  }

  it("attaches a summary to the 3 most recent turns only, leaving older turns unsummarized", async () => {
    const summarizeTurn = vi.fn(async (_input: { prompt: string; response: string }) => ({
      response: "condensed",
    }));
    const summarizer: Pick<Summarizer, "summarizeTurn"> = { summarizeTurn };

    const lines = [0, 1, 2, 3, 4].flatMap((i) => turnLines(i, i * 1000, true));
    await writeFile(transcriptPath, lines.map((l) => `${l}\n`).join(""));

    const cache = new TranscriptIndexCache(undefined, summarizer, createSummaryCache(cacheDir));
    await cache.refreshAndWait(sessionId, transcriptPath);
    const summary = cache.getSummary(sessionId, transcriptPath);

    expect(summary?.recentTurns).toHaveLength(5);
    expect(summary?.recentTurns[0].summary).toBeNull();
    expect(summary?.recentTurns[1].summary).toBeNull();
    expect(summary?.recentTurns[2].summary).toEqual({ response: "condensed" });
    expect(summary?.recentTurns[3].summary).toEqual({ response: "condensed" });
    expect(summary?.recentTurns[4].summary).toEqual({ response: "condensed" });
    expect(summarizeTurn).toHaveBeenCalledTimes(3);
  });

  it("summarizes all 3 turns when the transcript has exactly the window size", async () => {
    const summarizeTurn = vi.fn(async (_input: { prompt: string; response: string }) => ({
      response: "condensed",
    }));
    const summarizer: Pick<Summarizer, "summarizeTurn"> = { summarizeTurn };

    const lines = [0, 1, 2].flatMap((i) => turnLines(i, i * 1000, true));
    await writeFile(transcriptPath, lines.map((l) => `${l}\n`).join(""));

    const cache = new TranscriptIndexCache(undefined, summarizer, createSummaryCache(cacheDir));
    await cache.refreshAndWait(sessionId, transcriptPath);
    const summary = cache.getSummary(sessionId, transcriptPath);

    expect(summary?.recentTurns).toHaveLength(3);
    expect(summary?.recentTurns[0].summary).toEqual({ response: "condensed" });
    expect(summary?.recentTurns[1].summary).toEqual({ response: "condensed" });
    expect(summary?.recentTurns[2].summary).toEqual({ response: "condensed" });
    expect(summarizeTurn).toHaveBeenCalledTimes(3);
  });

  it("never calls the summarizer for a turn whose assistant hasn't replied yet", async () => {
    const summarizeTurn = vi.fn(async () => ({ response: "should never happen" }));
    const summarizer: Pick<Summarizer, "summarizeTurn"> = { summarizeTurn };

    const lines = turnLines(0, 0, false); // prompt only, no assistant reply
    await writeFile(transcriptPath, lines.map((l) => `${l}\n`).join(""));

    const cache = new TranscriptIndexCache(undefined, summarizer, createSummaryCache(cacheDir));
    await cache.refreshAndWait(sessionId, transcriptPath);
    const summary = cache.getSummary(sessionId, transcriptPath);

    expect(summary?.recentTurns).toHaveLength(1);
    expect(summary?.recentTurns[0].summary).toBeNull();
    expect(summarizeTurn).not.toHaveBeenCalled();
  });

  it("exposes the same 3-most-recent-only summary window on the flow view", async () => {
    const summarizeTurn = vi.fn(async (_input: { prompt: string; response: string }) => ({
      response: "condensed",
    }));
    const summarizer: Pick<Summarizer, "summarizeTurn"> = { summarizeTurn };

    const lines = [0, 1, 2, 3].flatMap((i) => turnLines(i, i * 1000, true));
    await writeFile(transcriptPath, lines.map((l) => `${l}\n`).join(""));

    const cache = new TranscriptIndexCache(undefined, summarizer, createSummaryCache(cacheDir));
    await cache.refreshAndWait(sessionId, transcriptPath);
    const flow = cache.getFlowSummary(sessionId, transcriptPath);

    expect(flow?.turns).toHaveLength(4);
    expect(flow?.turns[0].summary).toBeNull();
    expect(flow?.turns[1].summary).toEqual({ response: "condensed" });
    expect(flow?.turns[2].summary).toEqual({ response: "condensed" });
    expect(flow?.turns[3].summary).toEqual({ response: "condensed" });
  });

  it("defaults to a null summary on every turn when no summarizer is configured", async () => {
    const lines = turnLines(0, 0, true);
    await writeFile(transcriptPath, lines.map((l) => `${l}\n`).join(""));

    const cache = new TranscriptIndexCache();
    await cache.refreshAndWait(sessionId, transcriptPath);
    const summary = cache.getSummary(sessionId, transcriptPath);

    expect(summary?.recentTurns[0].summary).toBeNull();
  });
});
