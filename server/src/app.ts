import os from "node:os";
import { Hono } from "hono";
import type { GitInfoCache } from "./git-info.js";
import { getSessions, type SessionsServiceConfig } from "./sessions-service.js";
import { createOsascriptFocusRunner, type FocusRunner } from "./terminal-focus.js";
import type { TranscriptIndexCache } from "./transcript-index.js";

/** Matches the tty names ps/AppleScript report on macOS, e.g. "ttys004". */
const TTY_PATTERN = /^ttys\d+$/;

/** Origins the bundled web client is known to run from during local dev. */
const ALLOWED_CLIENT_ORIGINS = new Set(["http://localhost:5177", "http://127.0.0.1:5177"]);

const CLIENT_HEADER = "X-Sessman-Client";

export interface CreateAppOptions {
  /** Defaults to the real osascript-driven runner; tests inject a fake so they never launch osascript. */
  focusRunner?: FocusRunner;
  /**
   * This server's own origin (e.g. "http://127.0.0.1:5178"), allowed as a
   * same-origin exception to the Origin allowlist below. Omit if unknown —
   * the guard then only accepts the known web dev origins.
   */
  selfOrigin?: string;
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

  // Local-origin guard: every non-GET request must self-identify as the
  // bundled client, and — if it presents an Origin at all — that Origin must
  // be one this server trusts. This is a defense-in-depth check against a
  // random web page driving mutating actions (like focusing a terminal tab)
  // against a locally running sessman server; it is not meant to replace
  // proper auth for anything beyond a single-user local tool.
  app.use("*", async (c, next) => {
    if (c.req.method === "GET" || c.req.method === "HEAD" || c.req.method === "OPTIONS") {
      return next();
    }

    if (c.req.header(CLIENT_HEADER) !== "1") {
      return c.json({ error: "This endpoint requires the sessman client." }, 403);
    }

    const origin = c.req.header("Origin");
    if (origin && !ALLOWED_CLIENT_ORIGINS.has(origin) && origin !== options.selfOrigin) {
      return c.json({ error: "Request origin is not allowed." }, 403);
    }

    return next();
  });

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
