import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { nextTick, ref, type Ref } from "vue";
import App from "./App.vue";
import { makeSession } from "./test/factories";
import type { EnrichedSession } from "./lib/types";
import type { ConnectionState } from "./lib/ws-client";

/**
 * The shell owns layout and the four canonical states; the composable owns the
 * transport. Driving the composable's refs directly is what lets a test say
 * "the first load failed" without staging a socket.
 */
const mockRetry = vi.fn();
let mockSessions: Ref<EnrichedSession[]>;
let mockConnectionState: Ref<ConnectionState>;
let mockLoaded: Ref<boolean>;
let mockError: Ref<string | null>;

vi.mock("./composables/useSessions", () => ({
  useSessions: () => ({
    sessions: mockSessions,
    connectionState: mockConnectionState,
    loaded: mockLoaded,
    error: mockError,
    retry: mockRetry,
  }),
}));

let wrapper: VueWrapper | undefined;

async function mountApp() {
  wrapper = mount(App, {
    global: {
      stubs: { SessionCard: true, AggregatePanel: true, SessionFlowSheet: true, ThemeToggle: true },
    },
  });
  await nextTick();
  await nextTick();
  return wrapper;
}

function sheet() {
  return wrapper!.findComponent({ name: "SessionFlowSheet" });
}

function buttonLabelled(label: string) {
  return wrapper!.findAll("button").find((b) => b.text() === label);
}

beforeEach(() => {
  mockRetry.mockReset();
  mockSessions = ref([]);
  mockConnectionState = ref("open");
  mockLoaded = ref(true);
  mockError = ref(null);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ home: "/home/synthetic" }) }),
  );
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  vi.unstubAllGlobals();
});

describe("App", () => {
  it("holds the shape of the list while the first load is still in flight", async () => {
    // An empty list and an unfinished load look identical to the operator
    // unless the waiting state says which one it is.
    mockLoaded.value = false;
    await mountApp();

    expect(wrapper!.findAll('[data-slot="session-skeleton"]')).toHaveLength(3);
    expect(wrapper!.find('[data-slot="empty-state"]').exists()).toBe(false);
  });

  it("replaces the list with one retryable message when the first load fails", async () => {
    mockError.value = "GET /api/sessions -> 500";
    await mountApp();

    const banners = wrapper!.findAll('[data-slot="banner"]');
    expect(banners).toHaveLength(1);
    expect(banners[0].text()).toContain("We couldn't load your sessions.");
    // The raw status line is a developer's sentence, not an operator's.
    expect(wrapper!.text()).not.toContain("GET /api/sessions");
    expect(wrapper!.find('[data-slot="session-list"]').exists()).toBe(false);
  });

  it("asks the composable to reload when the operator retries", async () => {
    mockError.value = "GET /api/sessions -> 500";
    await mountApp();

    await buttonLabelled("Retry")!.trigger("click");
    expect(mockRetry).toHaveBeenCalledTimes(1);
  });

  it("says how to get a session on screen when none are running", async () => {
    await mountApp();

    const empty = wrapper!.find('[data-slot="empty-state"]');
    expect(empty.exists()).toBe(true);
    expect(empty.text()).toContain("No active sessions");
    expect(empty.text()).toContain("Start a Claude Code session in your terminal");
  });

  it("names the query that matched nothing and offers a way back", async () => {
    mockSessions.value = [makeSession("session-a", { name: "demo-app" })];
    await mountApp();

    await wrapper!.find('[data-slot="input"]').setValue("nothing-matches-this");
    expect(wrapper!.text()).toContain('No sessions match "nothing-matches-this".');
    expect(wrapper!.findAllComponents({ name: "SessionCard" })).toHaveLength(0);

    await buttonLabelled("Clear search")!.trigger("click");
    expect(wrapper!.findAllComponents({ name: "SessionCard" })).toHaveLength(1);
  });

  it("keeps the aggregate rail up while the main column is empty", async () => {
    // The rail reports across all sessions; a filter that matches nothing says
    // nothing about the totals, so it must not blank them out.
    mockSessions.value = [makeSession("session-a", { name: "demo-app" })];
    await mountApp();

    await wrapper!.find('[data-slot="input"]').setValue("nothing-matches-this");
    expect(wrapper!.findComponent({ name: "AggregatePanel" }).exists()).toBe(true);
  });

  it("leads with the sessions and puts the rail after them in the DOM", async () => {
    // Source order is what a narrow screen and a screen reader both follow.
    mockSessions.value = [makeSession("session-a")];
    await mountApp();

    const list = wrapper!.find('[data-slot="session-list"]').element;
    const rail = wrapper!.find('[data-slot="rail"]').element;
    expect(list.compareDocumentPosition(rail) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("opens the flow on the turn the operator expanded", async () => {
    mockSessions.value = [makeSession("session-a"), makeSession("session-b")];
    await mountApp();
    expect(sheet().props("session")).toBeNull();

    wrapper!.findAllComponents({ name: "SessionCard" })[1].vm.$emit("expand", "session-b", 14);
    await nextTick();

    expect((sheet().props("session") as EnrichedSession).sessionId).toBe("session-b");
    expect(sheet().props("focusTurnIndex")).toBe(14);
  });

  it("shuts the flow when the sheet asks to close", async () => {
    mockSessions.value = [makeSession("session-a")];
    await mountApp();

    wrapper!.findComponent({ name: "SessionCard" }).vm.$emit("expand", "session-a", 3);
    await nextTick();
    expect(sheet().props("session")).not.toBeNull();

    sheet().vm.$emit("close");
    await nextTick();
    expect(sheet().props("session")).toBeNull();
  });

  it("drops the open flow when its session leaves the list", async () => {
    // Sessions end while the operator is reading them; a sheet pinned to a
    // stale copy would keep showing a session that is gone.
    mockSessions.value = [makeSession("session-a")];
    await mountApp();

    wrapper!.findComponent({ name: "SessionCard" }).vm.$emit("expand", "session-a", 3);
    await nextTick();

    mockSessions.value = [];
    await nextTick();
    expect(sheet().props("session")).toBeNull();
  });

  it("reports the socket's state in the topbar instead of a takeover banner", async () => {
    // Reconnect is automatic; a Banner promises a Retry that does not exist.
    mockConnectionState.value = "reconnecting";
    await mountApp();

    expect(wrapper!.findComponent({ name: "ConnectionLozenge" }).props("state")).toBe("reconnecting");
    expect(wrapper!.find('[data-slot="banner"]').exists()).toBe(false);
  });

  it("cycles the sort mode through its three orders", async () => {
    await mountApp();
    const sort = () => wrapper!.findAll("button").find((b) => b.text().startsWith("Sort:"))!;

    expect(sort().text()).toBe("Sort: Recent");
    await sort().trigger("click");
    expect(sort().text()).toBe("Sort: Name");
    await sort().trigger("click");
    expect(sort().text()).toBe("Sort: Project");
    await sort().trigger("click");
    expect(sort().text()).toBe("Sort: Recent");
  });
});
