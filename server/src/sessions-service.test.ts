import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GitInfoCache } from "./git-info.js";
import { getSessions } from "./sessions-service.js";

describe("getSessions", () => {
  let sessionsDir: string;
  let projectsDir: string;
  let gitCache: GitInfoCache;

  beforeEach(async () => {
    sessionsDir = await mkdtemp(path.join(tmpdir(), "sessman-svc-sessions-"));
    projectsDir = await mkdtemp(path.join(tmpdir(), "sessman-svc-projects-"));
    gitCache = new GitInfoCache();
  });

  afterEach(async () => {
    await rm(sessionsDir, { recursive: true, force: true });
    await rm(projectsDir, { recursive: true, force: true });
  });

  it("returns only alive sessions by default", async () => {
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

    const config = { sessionsDir, projectsDir };
    const liveOnly = await getSessions(config, gitCache);
    expect(liveOnly.map((s) => s.sessionId)).toEqual(["alive-session"]);

    const withDead = await getSessions(config, gitCache, { includeDead: true });
    expect(withDead.map((s) => s.sessionId).sort()).toEqual(["alive-session", "dead-session"]);
  });

  it("returns an empty array when there are no session files", async () => {
    const sessions = await getSessions({ sessionsDir, projectsDir }, gitCache);
    expect(sessions).toEqual([]);
  });
});
