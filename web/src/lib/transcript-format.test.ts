import { describe, expect, it } from "vitest";
import { formatTokenCount, formatTurnTime, replyText, sortToolCounts, truncateLine } from "./transcript-format";

describe("truncateLine", () => {
  it("returns short text unchanged", () => {
    expect(truncateLine("fix the login bug", 40)).toBe("fix the login bug");
  });

  it("collapses newlines and tabs into single spaces", () => {
    expect(truncateLine("fix the\nlogin\tbug   please", 40)).toBe("fix the login bug please");
  });

  it("truncates long text with an ellipsis, capping total length at maxLength", () => {
    const result = truncateLine("a".repeat(100), 20);
    expect(result).toHaveLength(20);
    expect(result.endsWith("…")).toBe(true);
  });

  it("does not add an ellipsis when the collapsed text is exactly maxLength", () => {
    const text = "a".repeat(20);
    expect(truncateLine(text, 20)).toBe(text);
  });

  it("returns an empty string unchanged", () => {
    expect(truncateLine("", 20)).toBe("");
  });
});

describe("formatTokenCount", () => {
  it("renders small counts verbatim", () => {
    expect(formatTokenCount(0)).toBe("0");
    expect(formatTokenCount(999)).toBe("999");
  });

  it("renders thousands with one decimal, trimming a trailing .0", () => {
    expect(formatTokenCount(1000)).toBe("1k");
    expect(formatTokenCount(1234)).toBe("1.2k");
    expect(formatTokenCount(15000)).toBe("15k");
  });

  it("renders millions the same way", () => {
    expect(formatTokenCount(1_000_000)).toBe("1M");
    expect(formatTokenCount(2_500_000)).toBe("2.5M");
  });

  it("treats negative or non-finite input as zero rather than throwing", () => {
    expect(formatTokenCount(-5)).toBe("0");
    expect(formatTokenCount(NaN)).toBe("0");
  });
});

describe("sortToolCounts", () => {
  it("sorts by count descending", () => {
    expect(sortToolCounts({ Read: 2, Edit: 5, Bash: 1 })).toEqual([
      { name: "Edit", count: 5 },
      { name: "Read", count: 2 },
      { name: "Bash", count: 1 },
    ]);
  });

  it("breaks ties by name ascending", () => {
    expect(sortToolCounts({ Edit: 5, Bash: 5 })).toEqual([
      { name: "Bash", count: 5 },
      { name: "Edit", count: 5 },
    ]);
  });

  it("returns an empty array for an empty map", () => {
    expect(sortToolCounts({})).toEqual([]);
  });
});

describe("formatTurnTime", () => {
  it("returns an em dash placeholder for a null timestamp", () => {
    expect(formatTurnTime(null)).toBe("—");
  });

  it("extracts the HH:MM:SS portion from an ISO timestamp with milliseconds", () => {
    expect(formatTurnTime("2026-07-31T13:09:03.123Z")).toBe("13:09:03");
  });

  it("extracts the HH:MM:SS portion from an ISO timestamp without milliseconds", () => {
    expect(formatTurnTime("2026-07-31T13:09:03Z")).toBe("13:09:03");
  });

  it("falls back to the raw string for an unrecognised shape rather than throwing", () => {
    expect(formatTurnTime("not-a-timestamp")).toBe("not-a-timestamp");
  });
});

describe("replyText", () => {
  it("prefers the LLM summary when one exists", () => {
    const turn = { summary: { response: "summarized reply" }, gist: { text: "raw gist", truncated: false } };
    expect(replyText(turn)).toBe("summarized reply");
  });

  it("falls back to the raw captured gist when there is no summary", () => {
    const turn = { summary: null, gist: { text: "raw gist", truncated: false } };
    expect(replyText(turn)).toBe("raw gist");
  });

  it("still returns the summary when the raw gist is empty", () => {
    const turn = { summary: { response: "summarized reply" }, gist: { text: "", truncated: false } };
    expect(replyText(turn)).toBe("summarized reply");
  });
});
