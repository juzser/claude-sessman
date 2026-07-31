import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSessionSocket, nextBackoffMs } from "./ws-client";
import type { EnrichedSession } from "./types";

describe("nextBackoffMs", () => {
  it("doubles each attempt starting from the base delay", () => {
    expect(nextBackoffMs(0, 500, 15000)).toBe(500);
    expect(nextBackoffMs(1, 500, 15000)).toBe(1000);
    expect(nextBackoffMs(2, 500, 15000)).toBe(2000);
    expect(nextBackoffMs(3, 500, 15000)).toBe(4000);
  });

  it("caps at the max delay", () => {
    expect(nextBackoffMs(10, 500, 15000)).toBe(15000);
  });
});

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  url: string;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(): void {
    // no-op for tests
  }

  close(): void {
    this.onclose?.();
  }
}

describe("createSessionSocket", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("delivers parsed sessions from a 'sessions' frame", () => {
    const onSessions = vi.fn();
    const socket = createSessionSocket(
      "ws://127.0.0.1:5178/ws",
      { onSessions },
      { WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket },
    );

    const fake = FakeWebSocket.instances[0];
    fake.onopen?.();
    const payload: { type: "sessions"; data: EnrichedSession[] } = { type: "sessions", data: [] };
    fake.onmessage?.({ data: JSON.stringify(payload) });

    expect(onSessions).toHaveBeenCalledWith([]);
    socket.close();
  });

  it("ignores malformed frames instead of throwing", () => {
    const onSessions = vi.fn();
    const socket = createSessionSocket(
      "ws://127.0.0.1:5178/ws",
      { onSessions },
      { WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket },
    );

    const fake = FakeWebSocket.instances[0];
    expect(() => fake.onmessage?.({ data: "not json" })).not.toThrow();
    expect(onSessions).not.toHaveBeenCalled();
    socket.close();
  });

  it("reconnects with growing backoff after the socket closes", () => {
    const onStateChange = vi.fn();
    const socket = createSessionSocket(
      "ws://127.0.0.1:5178/ws",
      { onSessions: vi.fn(), onStateChange },
      { WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket, baseBackoffMs: 100, maxBackoffMs: 1000 },
    );

    expect(FakeWebSocket.instances).toHaveLength(1);
    FakeWebSocket.instances[0].onclose?.();
    expect(onStateChange).toHaveBeenCalledWith("reconnecting");

    vi.advanceTimersByTime(100);
    expect(FakeWebSocket.instances).toHaveLength(2);

    FakeWebSocket.instances[1].onclose?.();
    vi.advanceTimersByTime(199);
    expect(FakeWebSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(3);

    socket.close();
  });

  it("stops reconnecting once closed by the caller", () => {
    const socket = createSessionSocket(
      "ws://127.0.0.1:5178/ws",
      { onSessions: vi.fn() },
      { WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket, baseBackoffMs: 100, maxBackoffMs: 1000 },
    );

    socket.close();
    vi.advanceTimersByTime(10_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});
