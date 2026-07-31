import type { EnrichedSession } from "./types";

export type ConnectionState = "connecting" | "open" | "reconnecting" | "closed";

export interface SessionSocketHandlers {
  onSessions: (sessions: EnrichedSession[]) => void;
  onStateChange?: (state: ConnectionState) => void;
}

export interface SessionSocketOptions {
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  WebSocketImpl?: typeof WebSocket;
}

export interface SessionSocket {
  close(): void;
}

/** Doubles the delay each attempt, capped at maxMs. Pure so it's directly testable. */
export function nextBackoffMs(attempt: number, baseMs = 500, maxMs = 15000): number {
  const ms = baseMs * 2 ** attempt;
  return Math.min(ms, maxMs);
}

interface SessionsFrame {
  type: "sessions";
  data: EnrichedSession[];
}

function isSessionsFrame(value: unknown): value is SessionsFrame {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "sessions" &&
    Array.isArray((value as { data?: unknown }).data)
  );
}

/**
 * Wraps the browser WebSocket with reconnect + exponential backoff. The
 * WebSocket constructor is injectable so reconnect scheduling can be tested
 * without a real network connection (see ws-client.test.ts).
 */
export function createSessionSocket(
  url: string,
  handlers: SessionSocketHandlers,
  options: SessionSocketOptions = {},
): SessionSocket {
  const WS = options.WebSocketImpl ?? WebSocket;
  const baseMs = options.baseBackoffMs ?? 500;
  const maxMs = options.maxBackoffMs ?? 15000;

  let attempt = 0;
  let closed = false;
  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function setState(state: ConnectionState): void {
    handlers.onStateChange?.(state);
  }

  function connect(): void {
    if (closed) return;
    setState(attempt === 0 ? "connecting" : "reconnecting");
    const ws = new WS(url);
    socket = ws;

    ws.onopen = () => {
      attempt = 0;
      setState("open");
    };

    ws.onmessage = (event: MessageEvent) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (isSessionsFrame(parsed)) {
        handlers.onSessions(parsed.data);
      }
    };

    ws.onclose = () => {
      if (closed) return;
      scheduleReconnect();
    };

    // onclose always follows onerror for browser WebSockets, so no separate
    // handling is needed here beyond not letting an unhandled rejection surface.
    ws.onerror = () => {};
  }

  function scheduleReconnect(): void {
    const delay = nextBackoffMs(attempt, baseMs, maxMs);
    attempt += 1;
    setState("reconnecting");
    reconnectTimer = setTimeout(connect, delay);
  }

  connect();

  return {
    close(): void {
      closed = true;
      setState("closed");
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      socket?.close();
    },
  };
}
