import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, nextTick } from "vue";
import { useSessions, type UseSessionsResult } from "./useSessions";
import { createSessionSocket } from "../lib/ws-client";
import { makeSession } from "../test/factories";
import type { SessionSocketHandlers } from "../lib/ws-client";

vi.mock("../lib/ws-client", () => ({ createSessionSocket: vi.fn() }));

const socketMock = vi.mocked(createSessionSocket);
let handlers: SessionSocketHandlers | undefined;
let wrapper: VueWrapper | undefined;

/**
 * The composable owns onMounted, so it needs a real component around it; this
 * hands back the same refs the app binds to.
 */
async function mountComposable(): Promise<UseSessionsResult> {
  let result: UseSessionsResult | undefined;
  wrapper = mount(
    defineComponent({
      setup() {
        result = useSessions();
        return () => null;
      },
    }),
  );
  await nextTick();
  await nextTick();
  return result!;
}

function respondWith(body: unknown, ok = true, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok, status, json: () => Promise.resolve(body) }),
  );
}

beforeEach(() => {
  handlers = undefined;
  socketMock.mockReset();
  socketMock.mockImplementation((_url, given) => {
    handlers = given;
    return { close: () => {} };
  });
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  vi.unstubAllGlobals();
});

describe("useSessions", () => {
  it("serves the first list over REST and marks itself loaded", async () => {
    respondWith({ sessions: [makeSession("session-a")] });
    const { sessions, loaded, error } = await mountComposable();

    expect(sessions.value).toHaveLength(1);
    expect(loaded.value).toBe(true);
    expect(error.value).toBeNull();
  });

  it("reports a failed first load instead of showing an empty list as if it were the truth", async () => {
    respondWith({}, false, 500);
    const { sessions, loaded, error } = await mountComposable();

    expect(sessions.value).toEqual([]);
    expect(loaded.value).toBe(true);
    expect(error.value).toContain("500");
  });

  it("retries the list on demand", async () => {
    respondWith({}, false, 500);
    const { sessions, error, retry } = await mountComposable();
    expect(error.value).not.toBeNull();

    respondWith({ sessions: [makeSession("session-a")] });
    retry();
    await nextTick();
    await nextTick();

    expect(sessions.value).toHaveLength(1);
    expect(error.value).toBeNull();
  });

  it("clears a stale error once a socket frame proves the server is answering", async () => {
    // Without this the operator is told the server is unreachable while live
    // data streams in underneath the message.
    respondWith({}, false, 500);
    const { sessions, error } = await mountComposable();
    expect(error.value).not.toBeNull();

    handlers?.onSessions([makeSession("session-a")]);
    await nextTick();

    expect(sessions.value).toHaveLength(1);
    expect(error.value).toBeNull();
  });

  it("tracks the socket's connection state", async () => {
    respondWith({ sessions: [] });
    const { connectionState } = await mountComposable();
    expect(connectionState.value).toBe("connecting");

    handlers?.onStateChange?.("open");
    await nextTick();

    expect(connectionState.value).toBe("open");
  });
});
