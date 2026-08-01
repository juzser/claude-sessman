import { describe, expect, it } from "vitest";
import { NullSummarizer } from "./summarizer.js";

describe("NullSummarizer", () => {
  it("resolves null from summarizeTurn (graceful degradation, no Ollama)", async () => {
    const summarizer = new NullSummarizer();
    const result = await summarizer.summarizeTurn({ prompt: "hello", response: "hi there" });
    expect(result).toBeNull();
  });

  it("resolves null from summarizeSession", async () => {
    const summarizer = new NullSummarizer();
    const result = await summarizer.summarizeSession({ recentPrompts: ["hello", "fix the bug"] });
    expect(result).toBeNull();
  });

  it("close() resolves without throwing", async () => {
    const summarizer = new NullSummarizer();
    await expect(summarizer.close()).resolves.toBeUndefined();
  });
});
