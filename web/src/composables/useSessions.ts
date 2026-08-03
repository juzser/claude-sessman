import { onMounted, onUnmounted, ref, type Ref } from "vue";
import { createSessionSocket, type ConnectionState, type SessionSocket } from "../lib/ws-client";
import type { EnrichedSession } from "../lib/types";

export interface UseSessionsResult {
  sessions: Ref<EnrichedSession[]>;
  connectionState: Ref<ConnectionState>;
  loaded: Ref<boolean>;
  error: Ref<string | null>;
  /** Re-runs the REST load after a failed one; the socket is left alone. */
  retry: () => void;
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
  let loading = false;

  async function loadSessions(): Promise<void> {
    if (loading) return;
    loading = true;
    try {
      const res = await fetch("/api/sessions");
      if (!res.ok) throw new Error(`GET /api/sessions -> ${res.status}`);
      const body = (await res.json()) as { sessions: EnrichedSession[] };
      sessions.value = body.sessions;
      error.value = null;
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
      loaded.value = true;
    }
  }

  onMounted(async () => {
    await loadSessions();

    socket = createSessionSocket(
      wsUrl(),
      {
        onSessions: (next) => {
          sessions.value = next;
          // A frame arriving is proof the server is answering, so a failed
          // REST load must not keep claiming otherwise while data streams in.
          error.value = null;
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

  return {
    sessions,
    connectionState,
    loaded,
    error,
    retry: () => {
      void loadSessions();
    },
  };
}
