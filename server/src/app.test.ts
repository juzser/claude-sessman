import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { GitInfoCache } from "./git-info.js";

describe("createApp", () => {
  let sessionsDir: string;
  let projectsDir: string;

  beforeEach(async () => {
    sessionsDir = await mkdtemp(path.join(tmpdir(), "sessman-app-sessions-"));
    projectsDir = await mkdtemp(path.join(tmpdir(), "sessman-app-projects-"));
  });

  afterEach(async () => {
    await rm(sessionsDir, { recursive: true, force: true });
    await rm(projectsDir, { recursive: true, force: true });
  });

  it("GET /api/health returns ok", async () => {
    const app = createApp({ sessionsDir, projectsDir }, new GitInfoCache());
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
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

    const app = createApp({ sessionsDir, projectsDir }, new GitInfoCache());

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
});
