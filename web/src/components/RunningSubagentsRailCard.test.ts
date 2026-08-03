import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import RunningSubagentsRailCard from "./RunningSubagentsRailCard.vue";
import type { RunningSubagentRow } from "../composables/useAggregateUsage";

function makeRow(key: string, overrides: Partial<RunningSubagentRow> = {}): RunningSubagentRow {
  return {
    key,
    sessionId: "session-a",
    sessionName: "alpha",
    agentType: "reviewer",
    description: `work ${key}`,
    startedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("RunningSubagentsRailCard", () => {
  it("titles itself so the rail group is labelled even when it is empty", () => {
    const wrapper = mount(RunningSubagentsRailCard, { props: { running: [] } });
    expect(wrapper.text()).toContain("Running subagents");
  });

  it("renders an inline empty line instead of vanishing when nothing is running", () => {
    const wrapper = mount(RunningSubagentsRailCard, { props: { running: [] } });
    expect(wrapper.text()).toContain("No subagents running.");
    expect(wrapper.findAll('[data-slot="row"]')).toHaveLength(0);
  });

  it("counts what is running above the list", () => {
    const wrapper = mount(RunningSubagentsRailCard, { props: { running: [makeRow("a"), makeRow("b")] } });
    expect(wrapper.find('[data-slot="running-count"]').text()).toBe("2");
    expect(wrapper.text()).toContain("running");
  });

  it("lists each agent by type, in the order given", () => {
    const wrapper = mount(RunningSubagentsRailCard, {
      props: { running: [makeRow("a", { agentType: "dev" }), makeRow("b", { agentType: "retriever" })] },
    });

    const rows = wrapper.findAll('[data-slot="row"]');
    expect(rows).toHaveLength(2);
    expect(rows[0].text()).toContain("dev");
    expect(rows[1].text()).toContain("retriever");
  });

  it("attributes every agent to the session that dispatched it", () => {
    const wrapper = mount(RunningSubagentsRailCard, {
      props: { running: [makeRow("a", { sessionName: "alpha", description: "add tests" })] },
    });
    const row = wrapper.find('[data-slot="row"]');
    expect(row.text()).toContain("alpha");
    expect(row.text()).toContain("add tests");
  });

  it("still names an agent whose sidecar metadata is missing", () => {
    // .meta.json absent or malformed leaves agentType/description null while
    // the run itself is real — the row must not collapse to a blank line.
    const wrapper = mount(RunningSubagentsRailCard, {
      props: { running: [makeRow("a", { agentType: null, description: null, sessionName: "alpha" })] },
    });
    const row = wrapper.find('[data-slot="row"]');
    expect(row.text()).toContain("Subagent");
    expect(row.text()).toContain("alpha");
  });
});
