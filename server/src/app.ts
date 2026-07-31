import os from "node:os";
import { Hono } from "hono";
import type { GitInfoCache } from "./git-info.js";
import { getSessions, type SessionsServiceConfig } from "./sessions-service.js";

/** Builds the Hono app; kept separate from the http/WS wiring so it's testable via app.request(). */
export function createApp(config: SessionsServiceConfig, gitCache: GitInfoCache): Hono {
  const app = new Hono();

  // The web client uses `home` to render "~/…/project" instead of the full
  // absolute cwd; it has no other way to know the server machine's home dir.
  app.get("/api/health", (c) => c.json({ ok: true, home: os.homedir() }));

  app.get("/api/sessions", async (c) => {
    const includeDead = c.req.query("includeDead") === "1";
    const sessions = await getSessions(config, gitCache, { includeDead });
    return c.json({ sessions });
  });

  return app;
}
