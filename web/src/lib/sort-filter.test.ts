import { describe, expect, it } from "vitest";
import { filterSessions, sortSessions } from "./sort-filter";
import type { EnrichedSession } from "./types";

function makeSession(overrides: Partial<EnrichedSession>): EnrichedSession {
  return {
    pid: 111,
    sessionId: "session-1",
    cwd: "/Users/dev/projects/alpha",
    startedAt: 0,
    procStart: null,
    version: null,
    peerProtocol: null,
    kind: null,
    entrypoint: null,
    name: null,
    status: "idle",
    updatedAt: null,
    statusUpdatedAt: null,
    sourceFile: "/tmp/111.json",
    alive: true,
    pidReuse: "match",
    tty: null,
    uptimeSec: 100,
    lastActivityAgoSec: 100,
    projectSlug: "-Users-ser-projects-alpha",
    transcriptPath: "/tmp/transcript.jsonl",
    transcriptSize: null,
    transcriptMtime: null,
    transcriptSummary: null,
    git: null,
    ...overrides,
  };
}

describe("filterSessions", () => {
  const sessions = [
    makeSession({ sessionId: "s1", name: "Refactor auth", cwd: "/Users/dev/projects/alpha" }),
    makeSession({ sessionId: "s2", name: null, cwd: "/Users/dev/projects/beta" }),
    makeSession({ sessionId: "s3", name: "Beta docs", cwd: "/Users/dev/projects/gamma", git: { branch: "feat/docs", dirty: false } }),
  ];

  it("returns all sessions for an empty query", () => {
    expect(filterSessions(sessions, "")).toHaveLength(3);
  });

  it("matches against the session name case-insensitively", () => {
    const result = filterSessions(sessions, "refactor");
    expect(result.map((s) => s.sessionId)).toEqual(["s1"]);
  });

  it("matches against the cwd basename when name is absent", () => {
    const result = filterSessions(sessions, "beta");
    // "beta" matches s2's cwd basename AND s3's name "Beta docs"
    expect(result.map((s) => s.sessionId).sort()).toEqual(["s2", "s3"]);
  });

  it("matches against the git branch", () => {
    const result = filterSessions(sessions, "feat/docs");
    expect(result.map((s) => s.sessionId)).toEqual(["s3"]);
  });
});

describe("sortSessions", () => {
  const sessions = [
    makeSession({ sessionId: "s1", name: "Zebra", lastActivityAgoSec: 500, projectSlug: "z" }),
    makeSession({ sessionId: "s2", name: "Apple", lastActivityAgoSec: 10, projectSlug: "a" }),
    makeSession({ sessionId: "s3", name: "Mango", lastActivityAgoSec: 100, projectSlug: "m" }),
  ];

  it("sorts by most recent activity first", () => {
    const result = sortSessions(sessions, "recent");
    expect(result.map((s) => s.sessionId)).toEqual(["s2", "s3", "s1"]);
  });

  it("sorts by display name alphabetically", () => {
    const result = sortSessions(sessions, "name");
    expect(result.map((s) => s.sessionId)).toEqual(["s2", "s3", "s1"]);
  });

  it("sorts by project slug alphabetically", () => {
    const result = sortSessions(sessions, "project");
    expect(result.map((s) => s.sessionId)).toEqual(["s2", "s3", "s1"]);
  });

  it("does not mutate the input array", () => {
    const copy = [...sessions];
    sortSessions(sessions, "name");
    expect(sessions).toEqual(copy);
  });
});
