import os from "node:os";
import { Hono } from "hono";
import type { GitInfoCache } from "./git-info.js";
import { getSessions, type SessionsServiceConfig } from "./sessions-service.js";
import { createOsascriptFocusRunner, type FocusRunner } from "./terminal-focus.js";
import type { TranscriptIndexCache } from "./transcript-index.js";

/** Matches the tty names ps/AppleScript report on macOS, e.g. "ttys004". */
const TTY_PATTERN = /^ttys\d+$/;

export interface CreateAppOptions {
  /** Defaults to the real osascript-driven runner; tests inject a fake so they never launch osascript. */
  focusRunner?: FocusRunner;
}

/** Builds the Hono app; kept separate from the http/WS wiring so it's testable via app.request(). */
export function createApp(
  config: SessionsServiceConfig,
  gitCache: GitInfoCache,
  transcriptIndexCache: TranscriptIndexCache,
  options: CreateAppOptions = {},
): Hono {
  const app = new Hono();
  const focusRunner = options.focusRunner ?? createOsascriptFocusRunner();

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

  app.post("/api/sessions/:sessionId/focus", async (c) => {
    const sessionId = c.req.param("sessionId");
    // The tty is always resolved server-side from the registry/live-process
    // lookup; the request body is never consulted for tty/path/command, so a
    // malicious client can't point this at an arbitrary tty or process.
    const sessions = await getSessions(config, gitCache, transcriptIndexCache, { includeDead: true });
    const session = sessions.find((s) => s.sessionId === sessionId);
    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }

    const tty = session.tty;
    if (!tty || !TTY_PATTERN.test(tty)) {
      return c.json(
        {
          error:
            "No terminal tab could be resolved for this session (it may not be running in a tty, " +
            "or the tty could not be determined).",
        },
        422,
      );
    }

    const result = await focusRunner.focusTty(tty);
    if (!result.ok) {
      return c.json({ error: result.error ?? "Could not focus that terminal tab." }, 502);
    }

    return c.json({ ok: true });
  });

  return app;
}
