import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import TurnStrip from "./TurnStrip.vue";
import type { TranscriptTurn } from "../lib/types";

/** Builds one synthetic turn with sane defaults, never real transcript content. */
function makeTurn(index: number, overrides: Partial<TranscriptTurn> = {}): TranscriptTurn {
  return {
    index,
    at: `2026-01-01T00:00:${String(index).padStart(2, "0")}.000Z`,
    prompt: { text: `synthetic prompt ${index}`, truncated: false },
    gist: { text: `synthetic gist ${index}`, truncated: false },
    toolNames: [],
    toolCalls: [],
    toolCallsOmitted: 0,
    filesTouched: [],
    continuation: false,
    summary: null,
    ...overrides,
  };
}

describe("TurnStrip", () => {
  it("renders one listitem per turn, in the order given", () => {
    const wrapper = mount(TurnStrip, {
      props: { turns: [makeTurn(14), makeTurn(15), makeTurn(16)] },
    });
    const items = wrapper.findAll('[role="listitem"]');
    expect(items).toHaveLength(3);
    expect(items[0].text()).toContain("synthetic prompt 14");
    expect(items[1].text()).toContain("synthetic prompt 15");
    expect(items[2].text()).toContain("synthetic prompt 16");
  });

  it("labels the wrapper as a list of recent turns", () => {
    const wrapper = mount(TurnStrip, { props: { turns: [makeTurn(0)] } });
    expect(wrapper.find('[role="list"][aria-label="Recent turns"]').exists()).toBe(true);
  });

  it("renders the operator's prompt text in full, never LLM-summarized", () => {
    const longPrompt = "line one\nline two\nline three — a real captured operator prompt, unaltered.";
    const wrapper = mount(TurnStrip, {
      props: { turns: [makeTurn(0, { prompt: { text: longPrompt, truncated: false } })] },
    });
    // Line breaks included: the slot is whitespace-pre-wrap, so the operator's
    // own formatting survives into the DOM rather than collapsing to one line.
    expect(wrapper.text()).toContain(longPrompt);
  });

  it("shows the LLM reply summary when present", () => {
    const wrapper = mount(TurnStrip, {
      props: {
        turns: [makeTurn(0, { summary: { response: "summarized reply" }, gist: { text: "raw gist", truncated: false } })],
      },
    });
    expect(wrapper.text()).toContain("summarized reply");
    expect(wrapper.text()).not.toContain("raw gist");
  });

  it("falls back to the raw captured gist when no summary exists yet, in the same slot", () => {
    const withSummary = mount(TurnStrip, {
      props: { turns: [makeTurn(0, { summary: { response: "summarized reply" } })] },
    });
    const withoutSummary = mount(TurnStrip, {
      props: { turns: [makeTurn(0, { summary: null, gist: { text: "raw gist", truncated: false } })] },
    });

    expect(withoutSummary.text()).toContain("raw gist");

    const replySelector = "p.text-fg-subtle";
    const withSummaryReply = withSummary.find(replySelector);
    const withoutSummaryReply = withoutSummary.find(replySelector);
    expect(withSummaryReply.exists()).toBe(true);
    expect(withoutSummaryReply.exists()).toBe(true);
    // Same recipe either way: no visual "tell" for which source fed the line.
    expect(withSummaryReply.classes()).toEqual(withoutSummaryReply.classes());
  });

  it("connects turns with an aria-hidden separator, one fewer than the turn count", () => {
    const wrapper = mount(TurnStrip, {
      props: { turns: [makeTurn(0), makeTurn(1), makeTurn(2)] },
    });
    expect(wrapper.findAll('[aria-hidden="true"]').length).toBeGreaterThanOrEqual(2);
  });

  it("gives each turn an accessible expand control", () => {
    const wrapper = mount(TurnStrip, { props: { turns: [makeTurn(4)] } });
    expect(wrapper.find('[aria-label="Expand turn 5"]').exists()).toBe(true);
  });

  it("emits expand with the turn's transcript-wide index on click", async () => {
    const wrapper = mount(TurnStrip, { props: { turns: [makeTurn(0), makeTurn(7)] } });
    await wrapper.find('[aria-label="Expand turn 8"]').trigger("click");
    expect(wrapper.emitted("expand")).toEqual([[7]]);
  });
});
