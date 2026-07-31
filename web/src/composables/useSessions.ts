import { onMounted, onUnmounted, ref, type Ref } from "vue";
import { createSessionSocket, type ConnectionState, type SessionSocket } from "../lib/ws-client";
import type { EnrichedSession } from "../lib/types";

export interface UseSessionsResult {
  sessions: Ref<EnrichedSession[]>;
  connectionState: Ref<ConnectionState>;
  loaded: Ref<boolean>;
  error: Ref<string | null>;
}

function wsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws`;
}

/**
 * Fetches the initial session list over REST, then keeps it live via the
 * /ws push channel (with reconnect+backoff baked into createSessionSocket).
 */
export function useSessions(): UseSessionsResult {
  const sessions = ref<EnrichedSession[]>([]);
  const connectionState = ref<ConnectionState>("connecting");
  const loaded = ref(false);
  const error = ref<string | null>(null);

  let socket: SessionSocket | null = null;

  onMounted(async () => {
    try {
      const res = await fetch("/api/sessions");
      if (!res.ok) throw new Error(`GET /api/sessions -> ${res.status}`);
      const body = (await res.json()) as { sessions: EnrichedSession[] };
      sessions.value = body.sessions;
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
    } finally {
      loaded.value = true;
    }

    socket = createSessionSocket(
      wsUrl(),
      {
        onSessions: (next) => {
          sessions.value = next;
        },
        onStateChange: (state) => {
          connectionState.value = state;
        },
      },
    );
  });

  onUnmounted(() => {
    socket?.close();
  });

  return { sessions, connectionState, loaded, error };
}
