import { mkdtemp, rm, mkdir, writeFile, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emptySubagentIndexState, refreshSubagentIndex, toSubagentRecords, sumSubagentUsage } from "./subagent-index.js";

const sessionId = "synthetic-session-1";

function assistantUsageLine(
  messageId: string,
  usage: { input: number; output: number } | null,
  blockText: string,
  agentId = "synthetic-agent-1",
): string {
  return (
    JSON.stringify({
      type: "assistant",
      isSidechain: true,
      agentId,
      message: {
        id: messageId,
        model: "claude-synthetic-model",
        ...(usage
          ? {
              usage: {
                input_tokens: usage.input,
                output_tokens: usage.output,
                cache_read_input_tokens: 0,
                cache_creation_input_tokens: 0,
              },
            }
          : {}),
        content: [{ type: "text", text: blockText }],
      },
    }) + "\n"
  );
}

function metaJson(
  overrides: Partial<{ agentType: string; description: string; spawnDepth: number; toolUseId: string }> = {},
): string {
  return JSON.stringify({
    agentType: overrides.agentType ?? "general-purpose",
    description: overrides.description ?? "Synthetic subagent task",
    spawnDepth: overrides.spawnDepth ?? 0,
    toolUseId: overrides.toolUseId ?? "toolu_synthetic_1",
  });
}

describe("subagent-index", () => {
  let dir: string;
  let transcriptPath: string;
  let subagentsDir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "sessman-subagent-index-"));
    transcriptPath = path.join(dir, `${sessionId}.jsonl`);
    subagentsDir = path.join(dir, sessionId, "subagents");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns an empty index when the subagents/ directory doesn't exist", async () => {
    const state = await refreshSubagentIndex(emptySubagentIndexState(), transcriptPath, sessionId);
    expect(toSubagentRecords(state)).toEqual([]);
  });

  it("folds a multi-line assistant message (one message.id, one usage snapshot repeated per content block) exactly once", async () => {
    await mkdir(subagentsDir, { recursive: true });
    await writeFile(
      path.join(subagentsDir, "agent-synthetic-agent-1.jsonl"),
      assistantUsageLine("msg_synthetic_a", { input: 100, output: 20 }, "thinking...") +
        assistantUsageLine("msg_synthetic_a", { input: 100, output: 20 }, "final answer"),
      "utf8",
    );
    await writeFile(path.join(subagentsDir, "agent-synthetic-agent-1.meta.json"), metaJson(), "utf8");

    const state = await refreshSubagentIndex(emptySubagentIndexState(), transcriptPath, sessionId);
    const records = toSubagentRecords(state);

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      agentId: "synthetic-agent-1",
      agentType: "general-purpose",
      description: "Synthetic subagent task",
      spawnDepth: 0,
      toolUseId: "toolu_synthetic_1",
    });
    // Folded once, not twice — 100/20, not 200/40.
    expect(records[0].usage).toEqual({ inputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheCreationTokens: 0 });
  });

  it("contributes nothing on a second poll for lines already folded, and folds only the newly-appended message — the common production case of a message split across two polls", async () => {
    await mkdir(subagentsDir, { recursive: true });
    const filePath = path.join(subagentsDir, "agent-synthetic-agent-1.jsonl");
    await writeFile(filePath, assistantUsageLine("msg_synthetic_a", { input: 100, output: 20 }, "thinking..."), "utf8");
    await writeFile(path.join(subagentsDir, "agent-synthetic-agent-1.meta.json"), metaJson(), "utf8");

    let state = await refreshSubagentIndex(emptySubagentIndexState(), transcriptPath, sessionId);
    expect(toSubagentRecords(state)[0].usage).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    });

    // Second content block of the SAME logical message lands (identical usage snapshot,
    // repeated per the real-world running-total convention) plus a genuinely new message.
    await appendFile(
      filePath,
      assistantUsageLine("msg_synthetic_a", { input: 100, output: 20 }, "final answer") +
        assistantUsageLine("msg_synthetic_b", { input: 30, output: 5 }, "second turn"),
      "utf8",
    );
    state = await refreshSubagentIndex(state, transcriptPath, sessionId);

    expect(toSubagentRecords(state)[0].usage).toEqual({
      inputTokens: 130,
      outputTokens: 25,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    });
  });

  it("degrades to a record with null meta fields (but real usage) when .meta.json is missing", async () => {
    await mkdir(subagentsDir, { recursive: true });
    await writeFile(
      path.join(subagentsDir, "agent-synthetic-agent-2.jsonl"),
      assistantUsageLine("msg_synthetic_c", { input: 10, output: 2 }, "no meta file for this one", "synthetic-agent-2"),
      "utf8",
    );

    const state = await refreshSubagentIndex(emptySubagentIndexState(), transcriptPath, sessionId);
    const records = toSubagentRecords(state);

    expect(records).toHaveLength(1);
    expect(records[0].agentType).toBeNull();
    expect(records[0].description).toBeNull();
    expect(records[0].spawnDepth).toBeNull();
    expect(records[0].toolUseId).toBeNull();
    expect(records[0].usage).toEqual({ inputTokens: 10, outputTokens: 2, cacheReadTokens: 0, cacheCreationTokens: 0 });
  });

  it("skips a malformed JSON line without throwing and still folds the well-formed lines around it", async () => {
    await mkdir(subagentsDir, { recursive: true });
    const goodLine = assistantUsageLine(
      "msg_synthetic_d",
      { input: 7, output: 1 },
      "before the bad line",
      "synthetic-agent-3",
    );
    const badLine = "{not valid json\n";
    const secondGoodLine = assistantUsageLine(
      "msg_synthetic_e",
      { input: 3, output: 1 },
      "after the bad line",
      "synthetic-agent-3",
    );
    await writeFile(path.join(subagentsDir, "agent-synthetic-agent-3.jsonl"), goodLine + badLine + secondGoodLine, "utf8");
    await writeFile(
      path.join(subagentsDir, "agent-synthetic-agent-3.meta.json"),
      metaJson({ toolUseId: "toolu_synthetic_3" }),
      "utf8",
    );

    const state = await refreshSubagentIndex(emptySubagentIndexState(), transcriptPath, sessionId);
    const records = toSubagentRecords(state);

    expect(records).toHaveLength(1);
    expect(records[0].usage).toEqual({ inputTokens: 10, outputTokens: 2, cacheReadTokens: 0, cacheCreationTokens: 0 });
  });

  it("sumSubagentUsage sums usage across multiple agents, skipping ones with no usage yet", async () => {
    await mkdir(subagentsDir, { recursive: true });
    await writeFile(
      path.join(subagentsDir, "agent-synthetic-agent-1.jsonl"),
      assistantUsageLine("msg_synthetic_a", { input: 100, output: 20 }, "agent one"),
      "utf8",
    );
    await writeFile(path.join(subagentsDir, "agent-synthetic-agent-1.meta.json"), metaJson(), "utf8");
    // Agent two has a meta file (already dispatched) but hasn't written any usage-bearing line yet.
    await writeFile(path.join(subagentsDir, "agent-synthetic-agent-2.jsonl"), "", "utf8");
    await writeFile(
      path.join(subagentsDir, "agent-synthetic-agent-2.meta.json"),
      metaJson({ toolUseId: "toolu_synthetic_2" }),
      "utf8",
    );

    const state = await refreshSubagentIndex(emptySubagentIndexState(), transcriptPath, sessionId);
    const total = sumSubagentUsage(toSubagentRecords(state));

    expect(total).toEqual({ inputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheCreationTokens: 0 });
  });
});
