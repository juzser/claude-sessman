import { describe, expect, it } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import SessionFlowView from "./SessionFlowView.vue";
import { makeTurn } from "../test/factories";
import type { FlowSummary, TranscriptTurn } from "../lib/types";

// Vue Flow measures its pane the moment it mounts, and jsdom has no
// ResizeObserver to measure it with.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver ??= ResizeObserverStub;

function makeFlow(turns: TranscriptTurn[]): FlowSummary {
  return { turnCount: turns.length, retainedTurnCount: turns.length, turnsDropped: false, turns };
}

function mountView(props: Partial<InstanceType<typeof SessionFlowView>["$props"]> = {}) {
  return mount(SessionFlowView, {
    props: { state: "loaded", flow: makeFlow([makeTurn(0)]), errorMessage: "", ...props },
  });
}

/**
 * Vue Flow builds its node elements over several ticks after mount rather than
 * in the first render pass, so a node assertion has to wait for the graph
 * rather than for Vue alone.
 */
async function mountGraph(props: Partial<InstanceType<typeof SessionFlowView>["$props"]> = {}) {
  const wrapper = mountView(props);
  await nextTick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await nextTick();
  return wrapper;
}

async function clickFirstNode(wrapper: VueWrapper) {
  await wrapper.get('[data-slot="flow-node"]').trigger("click");
  await nextTick();
}

describe("SessionFlowView", () => {
  it("holds node-shaped placeholders while the flow loads", () => {
    const wrapper = mountView({ state: "loading", flow: null });
    expect(wrapper.find('[data-slot="flow-skeleton"]').exists()).toBe(true);
    expect(wrapper.text()).not.toContain("Loading");
  });

  it("offers a retry when the flow could not be loaded", async () => {
    const wrapper = mountView({ state: "error", flow: null, errorMessage: "We couldn't load this session's flow." });
    expect(wrapper.text()).toContain("We couldn't load this session's flow.");

    await wrapper.find("button").trigger("click");
    expect(wrapper.emitted("retry")).toHaveLength(1);
  });

  it("says the transcript is empty rather than drawing an empty pane", () => {
    const wrapper = mountView({ flow: makeFlow([]) });
    expect(wrapper.text()).toContain("No turns recorded yet.");
  });

  it("previews a long prompt on one line while the node is collapsed", async () => {
    const prompt = `${"a".repeat(400)} tail-marker`;
    const wrapper = await mountGraph({ flow: makeFlow([makeTurn(0, { prompt: { text: prompt, truncated: false } })]) });

    expect(wrapper.text()).not.toContain("tail-marker");
    expect(wrapper.text()).toContain("…");
  });

  it("shows the operator's whole prompt once the node is expanded", async () => {
    // What they typed is the thing they came back to read; an expanded node
    // that still truncates it sends them looking for it somewhere else.
    const prompt = `${"a".repeat(400)} tail-marker`;
    const wrapper = await mountGraph({ flow: makeFlow([makeTurn(0, { prompt: { text: prompt, truncated: false } })]) });

    await clickFirstNode(wrapper);
    expect(wrapper.get('[data-slot="turn-prompt"]').text()).toContain("tail-marker");
  });

  it("keeps the expanded prompt's own line breaks instead of reflowing them", async () => {
    const prompt = "first line\nsecond line";
    const wrapper = await mountGraph({ flow: makeFlow([makeTurn(0, { prompt: { text: prompt, truncated: false } })]) });

    await clickFirstNode(wrapper);
    expect(wrapper.get('[data-slot="turn-prompt"]').classes()).toContain("whitespace-pre-wrap");
  });

  it("shows the whole reply alongside the prompt when expanded", async () => {
    const gist = `${"b".repeat(400)} reply-marker`;
    const wrapper = await mountGraph({ flow: makeFlow([makeTurn(0, { gist: { text: gist, truncated: false } })]) });

    await clickFirstNode(wrapper);
    expect(wrapper.get('[data-slot="turn-reply"]').text()).toContain("reply-marker");
  });

  it("does not print the same prompt twice when a node is expanded", async () => {
    const turn = makeTurn(0, { prompt: { text: "unique-prompt", truncated: false } });
    const wrapper = await mountGraph({ flow: makeFlow([turn]) });

    await clickFirstNode(wrapper);
    expect(wrapper.text().split("unique-prompt")).toHaveLength(2);
  });

  it("collapses back to the preview when the node is clicked again", async () => {
    const prompt = `${"a".repeat(400)} tail-marker`;
    const wrapper = await mountGraph({ flow: makeFlow([makeTurn(0, { prompt: { text: prompt, truncated: false } })]) });

    await clickFirstNode(wrapper);
    await clickFirstNode(wrapper);
    expect(wrapper.find('[data-slot="turn-prompt"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("tail-marker");
  });

  it("shows the LLM reply summary, not the raw gist, in the collapsed preview", async () => {
    const turn = makeTurn(0, {
      summary: { response: "summarized reply" },
      gist: { text: "raw gist", truncated: false },
    });
    const wrapper = await mountGraph({ flow: makeFlow([turn]) });

    expect(wrapper.text()).toContain("summarized reply");
    expect(wrapper.text()).not.toContain("raw gist");
  });

  it("shows the LLM reply summary, not the raw gist, in the expanded block", async () => {
    const turn = makeTurn(0, {
      summary: { response: "summarized reply" },
      gist: { text: "raw gist", truncated: false },
    });
    const wrapper = await mountGraph({ flow: makeFlow([turn]) });

    await clickFirstNode(wrapper);
    const reply = wrapper.get('[data-slot="turn-reply"]');
    expect(reply.text()).toContain("summarized reply");
    expect(reply.text()).not.toContain("raw gist");
  });

  it("warns that older turns are missing when the server dropped some", () => {
    const flow = { ...makeFlow([makeTurn(0)]), turnCount: 900, retainedTurnCount: 1, turnsDropped: true };
    const wrapper = mountView({ flow });
    expect(wrapper.text()).toContain("most recent 1 of 900 turns");
  });
});
