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

/** Injectable seam for tests: overrides how the Ollama lifecycle is started, without ever spawning a real process or touching the network. Defaults to the real `startOllamaLifecycle`. */
export interface StartServerDeps {
  startOllamaLifecycle?: (config: { url: string }) => Promise<OllamaLifecycleHandle>;
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
export function startServer(config: AppConfig, deps: StartServerDeps = {}): RunningServer {
  const startLifecycle = deps.startOllamaLifecycle ?? startOllamaLifecycle;
  const gitCache = new GitInfoCache();

  const summarizer: Pick<Summarizer, "summarizeTurn"> =
    config.summarizer.kind === "ollama"
      ? new OllamaSummarizer({ model: config.summarizer.model, url: config.summarizer.url })
      : new NullSummarizer();
  const summaryCache = createSummaryCache(config.summarizer.cacheDir);
  const transcriptIndexCache = new TranscriptIndexCache(undefined, summarizer, summaryCache);

  // startServer stays synchronous (index.ts and tests call it without
  // awaiting), and OllamaSummarizer already degrades every call to null if
  // Ollama never becomes reachable, so nothing here needs to block startup on
  // the probe/spawn resolving. The PROMISE itself (not just its side effect)
  // is retained and awaited inside close() below — reading a variable
  // assigned from within a `.then()` would race close(): if shutdown happens
  // before the spawn/probe settles, the variable would still be null,
  // `?.stop()` would silently no-op, and a self-spawned `ollama serve` would
  // be orphaned forever.
  const lifecyclePromise: Promise<OllamaLifecycleHandle | null> =
    config.summarizer.kind === "ollama"
      ? startLifecycle({ url: config.summarizer.url }).catch(() => null)
      : Promise.resolve(null);

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
      // Awaited (not read off a variable a `.then()` may not have assigned
      // yet), so a self-spawned `ollama serve` is always stopped even if
      // shutdown races the spawn/probe settling. Safe to call twice: the
      // promise is already settled on a second close(), and stop() (a plain
      // child.kill()) is a no-op on an already-killed child.
      const handle = await lifecyclePromise;
      handle?.stop();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}
