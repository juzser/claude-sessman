import os from "node:os";
import { Hono } from "hono";
import type { GitInfoCache } from "./git-info.js";
import { getSessions, type SessionsServiceConfig } from "./sessions-service.js";
import type { TranscriptIndexCache } from "./transcript-index.js";

/** Builds the Hono app; kept separate from the http/WS wiring so it's testable via app.request(). */
export function createApp(
  config: SessionsServiceConfig,
  gitCache: GitInfoCache,
  transcriptIndexCache: TranscriptIndexCache,
): Hono {
  const app = new Hono();

  // The web client uses `home` to render "~/…/project" instead of the full
  // absolute cwd; it has no other way to know the server machine's home dir.
  app.get("/api/health", (c) => c.json({ ok: true, home: os.homedir() }));

  app.get("/api/sessions", async (c) => {
    const includeDead = c.req.query("includeDead") === "1";
    const sessions = await getSessions(config, gitCache, transcriptIndexCache, { includeDead });
    return c.json({ sessions });
  });

  app.get("/api/sessions/:sessionId/detail", async (c) => {
    const sessionId = c.req.param("sessionId");
    const sessions = await getSessions(config, gitCache, transcriptIndexCache, { includeDead: true });
    const session = sessions.find((s) => s.sessionId === sessionId);
    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }

    const transcriptDetail = transcriptIndexCache.getDetailSummary(session.sessionId, session.transcriptPath);
    return c.json({ session, transcriptDetail });
  });

  return app;
}
