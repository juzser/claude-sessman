import type { Server } from "node:http";
import { serve } from "@hono/node-server";
import { WebSocket, WebSocketServer } from "ws";
import { createApp } from "./app.js";
import type { AppConfig } from "./config.js";
import { GitInfoCache } from "./git-info.js";
import { OllamaSummarizer } from "./ollama-client.js";
import { startOllamaLifecycle, type OllamaLifecycleHandle } from "./ollama-lifecycle.js";
import { getSessions } from "./sessions-service.js";
import { createSummaryCache } from "./summary-cache.js";
import { NullSummarizer, type Summarizer } from "./summarizer.js";
import { TranscriptIndexCache } from "./transcript-index.js";
import { watchSessionsDir, type SessionWatcher } from "./watcher.js";

export interface RunningServer {
  httpServer: Server;
  wss: WebSocketServer;
  close(): Promise<void>;
}

function broadcastPayload(wss: WebSocketServer, payload: string): void {
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

/**
 * Wires the Hono app, the sessions registry watcher, and a WebSocket server
 * onto one http.Server. The watcher's poll (2s, see watcher.ts) doubles as
 * the ~3s liveness recheck the spec calls for: every tick re-reads the
 * registry and re-enriches from scratch, which re-derives `alive` fresh
 * each time — no separate timer needed.
 */
export function startServer(config: AppConfig): RunningServer {
  const gitCache = new GitInfoCache();

  const summarizer: Pick<Summarizer, "summarizeTurn"> =
    config.summarizer.kind === "ollama"
      ? new OllamaSummarizer({ model: config.summarizer.model, url: config.summarizer.url })
      : new NullSummarizer();
  const summaryCache = createSummaryCache(config.summarizer.cacheDir);
  const transcriptIndexCache = new TranscriptIndexCache(undefined, summarizer, summaryCache);

  // Fire-and-forget: startServer stays synchronous (index.ts and tests call
  // it without awaiting), and OllamaSummarizer already degrades every call to
  // null if Ollama never becomes reachable, so nothing here needs to block
  // startup on the probe/spawn resolving.
  let ollamaLifecycle: OllamaLifecycleHandle | null = null;
  if (config.summarizer.kind === "ollama") {
    startOllamaLifecycle({ url: config.summarizer.url })
      .then((handle) => {
        ollamaLifecycle = handle;
      })
      .catch(() => {
        // Best-effort; a failed probe/spawn just leaves ollamaLifecycle null.
      });
  }

  const app = createApp(config, gitCache, transcriptIndexCache, {
    selfOrigin: `http://${config.host}:${config.port}`,
  });

  const httpServer = serve({
    fetch: app.fetch,
    hostname: config.host,
    port: config.port,
  }) as unknown as Server;

  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  const broadcastCurrentSessions = async (): Promise<void> => {
    const sessions = await getSessions(config, gitCache, transcriptIndexCache);
    broadcastPayload(wss, JSON.stringify({ type: "sessions", data: sessions }));
  };

  wss.on("connection", (ws) => {
    getSessions(config, gitCache, transcriptIndexCache)
      .then((sessions) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "sessions", data: sessions }));
        }
      })
      .catch(() => {
        // Best-effort initial push; the next watcher tick will retry.
      });
  });

  const watcher: SessionWatcher = watchSessionsDir(config.sessionsDir, () => {
    broadcastCurrentSessions().catch(() => {
      // Swallow — a transient read/enrich failure shouldn't crash the watcher loop.
    });
  });

  return {
    httpServer,
    wss,
    async close(): Promise<void> {
      watcher.stop();
      ollamaLifecycle?.stop();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}
