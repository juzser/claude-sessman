import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import AggregatePanel from "./AggregatePanel.vue";
import { makeSession, makeSummary } from "../test/factories";

describe("AggregatePanel", () => {
  it("labels itself as a region covering every session, not the focused one", () => {
    const wrapper = mount(AggregatePanel, { props: { sessions: [] } });
    const region = wrapper.find('[role="region"]');
    expect(region.exists()).toBe(true);
    expect(region.attributes("aria-label")).toBe("Aggregate usage across all sessions");
  });

  it("is not a live region: the numbers change on every frame and would talk over the operator", () => {
    const wrapper = mount(AggregatePanel, { props: { sessions: [] } });
    expect(wrapper.find("[aria-live]").exists()).toBe(false);
  });

  it("renders both cards even with no sessions at all", () => {
    const wrapper = mount(AggregatePanel, { props: { sessions: [] } });
    expect(wrapper.text()).toContain("Token usage");
    expect(wrapper.text()).toContain("No usage yet.");
    expect(wrapper.text()).toContain("Running subagents");
    expect(wrapper.text()).toContain("No subagents running.");
  });

  it("folds the sessions it is handed into both cards", () => {
    const wrapper = mount(AggregatePanel, {
      props: {
        sessions: [
          makeSession("a", {
            name: "alpha",
            transcriptSummary: makeSummary({
              totalUsage: { inputTokens: 2000, outputTokens: 300, cacheReadTokens: 0, cacheCreationTokens: 0 },
              modelBreakdown: [
                { model: "model-x", calls: 4, inputTokens: 2000, outputTokens: 300, cacheReadTokens: 0, cacheCreationTokens: 0 },
              ],
              subagents: {
                sidechainLineCount: 0,
                lastSidechainAt: null,
                running: [
                  { toolUseId: "tool-1", description: "add tests", subagentType: "dev", startedAt: "2026-01-01T00:00:00.000Z" },
                ],
                agents: [],
              },
            }),
          }),
        ],
      },
    });

    expect(wrapper.text()).toContain("2k");
    expect(wrapper.text()).toContain("model-x");
    expect(wrapper.text()).toContain("dev");
    expect(wrapper.text()).toContain("alpha");
  });

  it("recomputes when the session list changes", async () => {
    const wrapper = mount(AggregatePanel, { props: { sessions: [] } });
    expect(wrapper.text()).toContain("No subagents running.");

    await wrapper.setProps({
      sessions: [
        makeSession("a", {
          transcriptSummary: makeSummary({
            subagents: {
              sidechainLineCount: 0,
              lastSidechainAt: null,
              running: [{ toolUseId: "tool-1", description: null, subagentType: "dev", startedAt: null }],
              agents: [],
            },
          }),
        }),
      ],
    });

    expect(wrapper.text()).not.toContain("No subagents running.");
    expect(wrapper.findAll('[data-slot="row"]')).toHaveLength(1);
  });
});
