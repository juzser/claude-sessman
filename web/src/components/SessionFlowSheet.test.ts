import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import SessionFlowSheet from "./SessionFlowSheet.vue";
import { fetchSessionFlow } from "../lib/sessman-api";
import { makeSession, makeSummary, makeTurn } from "../test/factories";
import type { EnrichedSession, FlowSummary } from "../lib/types";

vi.mock("../lib/sessman-api", () => ({ fetchSessionFlow: vi.fn() }));

// jsdom has no ResizeObserver, but reka-ui's dialog calls it as soon as
// DialogContent mounts open.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver ??= ResizeObserverStub;

const flowMock = vi.mocked(fetchSessionFlow);

function makeFlow(): FlowSummary {
  const turns = [makeTurn(0), makeTurn(1)];
  return { turnCount: turns.length, retainedTurnCount: turns.length, turnsDropped: false, turns };
}

let wrapper: VueWrapper | undefined;

/**
 * reka-ui's Portal defers the real Teleport behind a useMounted() flag, so the
 * sheet body lands one flush after mount() returns and lives in document.body
 * rather than under the wrapper's own root.
 */
async function mountSheet(session: EnrichedSession | null, focusTurnIndex: number | null = null) {
  wrapper = mount(SessionFlowSheet, {
    props: { session, focusTurnIndex, home: "/home/synthetic" },
    attachTo: document.body,
    global: { stubs: { SessionFlowView: true } },
  });
  await nextTick();
  await nextTick();
  return wrapper;
}

function flowView() {
  return wrapper!.findComponent({ name: "SessionFlowView" });
}

beforeEach(() => {
  flowMock.mockReset();
  flowMock.mockResolvedValue({ ok: true, session: makeSession("a"), transcriptFlow: makeFlow() });
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  document.body.innerHTML = "";
});

describe("SessionFlowSheet", () => {
  it("stays shut and asks the server for nothing until a session is selected", async () => {
    await mountSheet(null);
    expect(document.body.querySelector('[data-slot="sheet-content"]')).toBeNull();
    expect(flowMock).not.toHaveBeenCalled();
  });

  it("names the open sheet after the session it is showing", async () => {
    await mountSheet(makeSession("session-a", { name: "demo-app" }));
    const dialog = document.body.querySelector('[data-slot="sheet-content"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain("demo-app");
  });

  it("labels the session's token total by direction, not as an unqualified number", async () => {
    // The card used to show a single figure labelled "ctx"; this is the
    // replacement, and it says which direction each number is.
    await mountSheet(
      makeSession("session-a", {
        transcriptSummary: makeSummary({
          totalUsage: { inputTokens: 128_400, outputTokens: 42_100, cacheReadTokens: 0, cacheCreationTokens: 0 },
        }),
      }),
    );

    const usage = document.body.querySelector('[data-slot="session-usage"]');
    expect(usage?.textContent).toContain("128.4k");
    expect(usage?.textContent).toContain("in");
    expect(usage?.textContent).toContain("42.1k");
    expect(usage?.textContent).toContain("out");
  });

  it("omits the token line rather than showing zeroes for an unindexed session", async () => {
    await mountSheet(makeSession("session-a", { transcriptSummary: null }));
    expect(document.body.querySelector('[data-slot="session-usage"]')).toBeNull();
  });

  it("loads the flow for the session it was opened on", async () => {
    await mountSheet(makeSession("session-a"));
    expect(flowMock).toHaveBeenCalledWith("session-a");
    expect(flowView().props("state")).toBe("loaded");
    expect(flowView().props("flow")).not.toBeNull();
  });

  it("centres the flow on the turn whose Expand was clicked", async () => {
    await mountSheet(makeSession("session-a"), 42);
    expect(flowView().props("focusTurnIndex")).toBe(42);
  });

  it("keeps a failure message that says something the operator can act on", async () => {
    flowMock.mockResolvedValue({
      ok: false,
      reason: "not-found",
      message: "This session is no longer running.",
    });
    await mountSheet(makeSession("session-a"));

    expect(flowView().props("state")).toBe("error");
    expect(flowView().props("errorMessage")).toBe("This session is no longer running.");
  });

  it("replaces a bare status-code failure with copy an operator can read", async () => {
    flowMock.mockResolvedValue({
      ok: false,
      reason: "unknown",
      message: "Unexpected server response (500).",
    });
    await mountSheet(makeSession("session-a"));

    expect(flowView().props("errorMessage")).toBe("We couldn't load this session's flow.");
  });

  it("refetches when the flow view asks to retry", async () => {
    flowMock.mockResolvedValue({ ok: false, reason: "network-error", message: "Could not reach the sessman server." });
    await mountSheet(makeSession("session-a"));
    expect(flowMock).toHaveBeenCalledTimes(1);

    flowMock.mockResolvedValue({ ok: true, session: makeSession("a"), transcriptFlow: makeFlow() });
    flowView().vm.$emit("retry");
    await nextTick();
    await nextTick();

    expect(flowMock).toHaveBeenCalledTimes(2);
    expect(flowView().props("state")).toBe("loaded");
  });

  it("does not open a second request while one is still in flight", async () => {
    // Two concurrent fetches can resolve out of order, and the loser would win.
    let resolve: ((value: Awaited<ReturnType<typeof fetchSessionFlow>>) => void) | undefined;
    flowMock.mockReturnValue(new Promise((r) => { resolve = r; }));
    await mountSheet(makeSession("session-a"));

    flowView().vm.$emit("retry");
    flowView().vm.$emit("retry");
    await nextTick();
    expect(flowMock).toHaveBeenCalledTimes(1);

    resolve?.({ ok: true, session: makeSession("a"), transcriptFlow: makeFlow() });
  });

  it("asks its parent to close when the sheet is dismissed", async () => {
    await mountSheet(makeSession("session-a"));
    const closeButton = document.body.querySelector('[aria-label="Close"]') as HTMLElement | null;
    expect(closeButton).not.toBeNull();

    closeButton?.click();
    await nextTick();
    expect(wrapper!.emitted("close")).toHaveLength(1);
  });

  it("loads the next session's flow when the parent switches sessions", async () => {
    await mountSheet(makeSession("session-a"));
    expect(flowMock).toHaveBeenCalledTimes(1);

    await wrapper!.setProps({ session: makeSession("session-b") });
    await nextTick();

    expect(flowMock).toHaveBeenLastCalledWith("session-b");
    expect(flowMock).toHaveBeenCalledTimes(2);
  });
});
