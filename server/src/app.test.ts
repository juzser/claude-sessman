import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { GitInfoCache } from "./git-info.js";
import type { FocusResult, FocusRunner } from "./terminal-focus.js";
import { TranscriptIndexCache } from "./transcript-index.js";

function makeFakeFocusRunner(result: FocusResult): { runner: FocusRunner; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    runner: {
      focusTty(tty: string) {
        calls.push(tty);
        return Promise.resolve(result);
      },
    },
  };
}

const CLIENT_HEADERS = { "X-Sessman-Client": "1" };

describe("createApp", () => {
  let sessionsDir: string;
  let projectsDir: string;
  let transcriptIndexCache: TranscriptIndexCache;

  beforeEach(async () => {
    sessionsDir = await mkdtemp(path.join(tmpdir(), "sessman-app-sessions-"));
    projectsDir = await mkdtemp(path.join(tmpdir(), "sessman-app-projects-"));
    transcriptIndexCache = new TranscriptIndexCache();
  });

  afterEach(async () => {
    await rm(sessionsDir, { recursive: true, force: true });
    await rm(projectsDir, { recursive: true, force: true });
  });

  it("GET /api/health returns ok plus the server's home dir", async () => {
    const app = createApp({ sessionsDir, projectsDir }, new GitInfoCache(), transcriptIndexCache);
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; home: string };
    expect(body.ok).toBe(true);
    // The web client uses this to render "~/…/project" instead of the full
    // absolute path; just assert it's a non-empty absolute-looking string
    // rather than asserting the operator's real home value.
    expect(typeof body.home).toBe("string");
    expect(body.home.length).toBeGreaterThan(0);
  });

  it("GET /api/sessions returns only alive sessions by default", async () => {
    await writeFile(
      path.join(sessionsDir, "alive.json"),
      JSON.stringify({
        pid: process.pid,
        sessionId: "alive-session",
        cwd: "/tmp/alive-cwd",
        startedAt: Date.now(),
        status: "busy",
      }),
    );
    await writeFile(
      path.join(sessionsDir, "dead.json"),
      JSON.stringify({
        pid: 2 ** 30,
        sessionId: "dead-session",
        cwd: "/tmp/dead-cwd",
        startedAt: Date.now(),
        status: "busy",
      }),
    );

    const app = createApp({ sessionsDir, projectsDir }, new GitInfoCache(), transcriptIndexCache);

    const liveRes = await app.request("/api/sessions");
    const liveBody = (await liveRes.json()) as { sessions: Array<{ sessionId: string }> };
    expect(liveBody.sessions.map((s) => s.sessionId)).toEqual(["alive-session"]);

    const allRes = await app.request("/api/sessions?includeDead=1");
    const allBody = (await allRes.json()) as { sessions: Array<{ sessionId: string }> };
    expect(allBody.sessions.map((s) => s.sessionId).sort()).toEqual([
      "alive-session",
      "dead-session",
    ]);
  });

  it("GET /api/sessions/:sessionId/detail returns the enriched session plus transcript detail", async () => {
    const sessionId = "detail-session";
    await writeFile(
      path.join(sessionsDir, "detail.json"),
      JSON.stringify({
        pid: process.pid,
        sessionId,
        cwd: "/tmp/detail-cwd",
        startedAt: Date.now(),
        status: "busy",
      }),
    );

    const app = createApp({ sessionsDir, projectsDir }, new GitInfoCache(), transcriptIndexCache);
    const res = await app.request(`/api/sessions/${sessionId}/detail`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      session: { sessionId: string };
      transcriptDetail: unknown;
    };
    expect(body.session.sessionId).toBe(sessionId);
    // No transcript file exists for this session, so the index hasn't scanned
    // anything yet — detail is null until the first scan lands, same
    // contract as transcriptSummary on the plain session list.
    expect(body.transcriptDetail).toBeNull();
  });

  it("GET /api/sessions/:sessionId/detail returns 404 for an unknown session id", async () => {
    const app = createApp({ sessionsDir, projectsDir }, new GitInfoCache(), transcriptIndexCache);
    const res = await app.request("/api/sessions/no-such-session/detail");
    expect(res.status).toBe(404);
  });

  it("POST /api/sessions/:sessionId/focus rejects a session with no resolvable tty, without invoking the runner", async () => {
    const sessionId = "no-tty-session";
    await writeFile(
      path.join(sessionsDir, "no-tty.json"),
      JSON.stringify({
        // A pid this large should not correspond to a live process (or, on
        // the off chance it does, ps won't report a controlling tty for it
        // in this test environment either way — the resolved tty is null).
        pid: 2 ** 30,
        sessionId,
        cwd: "/tmp/no-tty-cwd",
        startedAt: Date.now(),
        status: "busy",
      }),
    );

    const { runner, calls } = makeFakeFocusRunner({ ok: true });
    const app = createApp({ sessionsDir, projectsDir }, new GitInfoCache(), transcriptIndexCache, {
      focusRunner: runner,
    });

    const res = await app.request(`/api/sessions/${sessionId}/focus`, {
      method: "POST",
      headers: CLIENT_HEADERS,
    });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBeTruthy();
    expect(calls).toEqual([]);
  });

  it("POST /api/sessions/:sessionId/focus returns 404 for an unknown session id", async () => {
    const { runner } = makeFakeFocusRunner({ ok: true });
    const app = createApp({ sessionsDir, projectsDir }, new GitInfoCache(), transcriptIndexCache, {
      focusRunner: runner,
    });

    const res = await app.request("/api/sessions/no-such-session/focus", {
      method: "POST",
      headers: CLIENT_HEADERS,
    });
    expect(res.status).toBe(404);
  });

  it("rejects a non-GET request missing the X-Sessman-Client header, without reaching the route", async () => {
    const { runner, calls } = makeFakeFocusRunner({ ok: true });
    const app = createApp({ sessionsDir, projectsDir }, new GitInfoCache(), transcriptIndexCache, {
      focusRunner: runner,
    });

    // No X-Sessman-Client header at all — should be rejected by the guard
    // before the route even looks up the (nonexistent) session, so this must
    // NOT be the 404 the route would otherwise produce.
    const res = await app.request("/api/sessions/no-such-session/focus", { method: "POST" });

    expect(res.status).toBe(403);
    expect(calls).toEqual([]);
  });

  it("rejects a non-GET request whose Origin header isn't on the allowlist", async () => {
    const { runner, calls } = makeFakeFocusRunner({ ok: true });
    const app = createApp({ sessionsDir, projectsDir }, new GitInfoCache(), transcriptIndexCache, {
      focusRunner: runner,
    });

    const res = await app.request("/api/sessions/no-such-session/focus", {
      method: "POST",
      headers: { ...CLIENT_HEADERS, Origin: "http://evil.example" },
    });

    expect(res.status).toBe(403);
    expect(calls).toEqual([]);
  });

  it("allows a non-GET request whose Origin is the known web dev origin", async () => {
    const { runner } = makeFakeFocusRunner({ ok: true });
    const app = createApp({ sessionsDir, projectsDir }, new GitInfoCache(), transcriptIndexCache, {
      focusRunner: runner,
    });

    const res = await app.request("/api/sessions/no-such-session/focus", {
      method: "POST",
      headers: { ...CLIENT_HEADERS, Origin: "http://localhost:5177" },
    });

    // Still 404 (unknown session) rather than 403 — the guard let it through
    // to the route.
    expect(res.status).toBe(404);
  });
});
