import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import TokenUsageRailCard from "./TokenUsageRailCard.vue";
import type { ModelUsage, SummedUsage } from "../lib/types";

function makeUsage(overrides: Partial<SummedUsage> = {}): SummedUsage {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, ...overrides };
}

function makeModelUsage(model: string, calls: number): ModelUsage {
  return { model, calls, ...makeUsage() };
}

describe("TokenUsageRailCard", () => {
  it("titles itself so the rail group is labelled even when it is empty", () => {
    const wrapper = mount(TokenUsageRailCard, { props: { total: null, byModel: [] } });
    expect(wrapper.text()).toContain("Token usage");
  });

  it("renders an inline empty line instead of vanishing when nothing is indexed yet", () => {
    const wrapper = mount(TokenUsageRailCard, { props: { total: null, byModel: [] } });
    expect(wrapper.text()).toContain("No usage yet.");
  });

  it("shows input and output totals compactly, each with its own label", () => {
    const wrapper = mount(TokenUsageRailCard, {
      props: { total: makeUsage({ inputTokens: 128_400, outputTokens: 42_100 }), byModel: [] },
    });
    expect(wrapper.text()).toContain("128.4k");
    expect(wrapper.text()).toContain("42.1k");
    expect(wrapper.text()).toContain("in");
    expect(wrapper.text()).toContain("out");
  });

  it("keeps a genuine zero visible rather than treating it as no data", () => {
    const wrapper = mount(TokenUsageRailCard, { props: { total: makeUsage(), byModel: [] } });
    expect(wrapper.text()).not.toContain("No usage yet.");
    expect(wrapper.findAll("[data-slot=\"total-value\"]").map((node) => node.text())).toEqual(["0", "0"]);
  });

  it("lists each model with its call count, in the order given", () => {
    const wrapper = mount(TokenUsageRailCard, {
      props: {
        total: makeUsage({ inputTokens: 10 }),
        byModel: [makeModelUsage("model-x", 12), makeModelUsage("model-y", 8)],
      },
    });

    const rows = wrapper.findAll('[data-slot="row"]');
    expect(rows).toHaveLength(2);
    expect(rows[0].text()).toContain("model-x");
    expect(rows[0].text()).toContain("12×");
    expect(rows[1].text()).toContain("model-y");
    expect(wrapper.text()).toContain("By model");
  });

  it("drops the by-model group entirely when no model has been attributed yet", () => {
    const wrapper = mount(TokenUsageRailCard, {
      props: { total: makeUsage({ inputTokens: 10 }), byModel: [] },
    });
    expect(wrapper.text()).not.toContain("By model");
    expect(wrapper.findAll('[data-slot="row"]')).toHaveLength(0);
  });

  it("aligns figures on tabular numerals so the column does not jitter as they change", () => {
    const wrapper = mount(TokenUsageRailCard, {
      props: { total: makeUsage({ inputTokens: 1 }), byModel: [makeModelUsage("model-x", 1)] },
    });
    for (const node of wrapper.findAll('[data-slot="total-value"]')) {
      expect(node.classes()).toContain("tabular-nums");
    }
  });
});
