import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { enrichSession } from "./enrich.js";
import { GitInfoCache } from "./git-info.js";
import { TranscriptIndexCache } from "./transcript-index.js";
import type { RawSessionRecord } from "./types.js";

const execFileAsync = promisify(execFile);

function makeRaw(overrides: Partial<RawSessionRecord> = {}): RawSessionRecord {
  return {
    pid: process.pid,
    sessionId: "synthetic-session-id",
    cwd: "/tmp/synthetic-cwd",
    startedAt: Date.now() - 60_000,
    procStart: null,
    version: "2.1.220",
    peerProtocol: 1,
    kind: "interactive",
    entrypoint: "cli",
    name: "synthetic-name",
    status: "busy",
    updatedAt: Date.now() - 5_000,
    statusUpdatedAt: Date.now() - 5_000,
    sourceFile: "/tmp/synthetic-cwd/synthetic.json",
    ...overrides,
  };
}

async function waitFor<T>(fn: () => T, predicate: (v: T) => boolean, timeoutMs = 3000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = fn();
    if (predicate(value)) return value;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe("enrichSession", () => {
  let projectsDir: string;
  let gitCache: GitInfoCache;
  let transcriptIndexCache: TranscriptIndexCache;

  beforeEach(async () => {
    projectsDir = await mkdtemp(path.join(tmpdir(), "sessman-enrich-projects-"));
    gitCache = new GitInfoCache();
    transcriptIndexCache = new TranscriptIndexCache();
  });

  afterEach(async () => {
    await rm(projectsDir, { recursive: true, force: true });
  });

  it("marks a session with a live pid as alive, and computes uptime/last-activity", async () => {
    const raw = makeRaw();
    const now = Date.now();
    const enriched = await enrichSession(raw, { claudeProjectsDir: projectsDir, gitCache, transcriptIndexCache, now });

    expect(enriched.alive).toBe(true);
    expect(enriched.uptimeSec).toBeCloseTo(60, -1);
    expect(enriched.lastActivityAgoSec).toBeCloseTo(5, -1);
    expect(enriched.pidReuse).toBe("unknown"); // procStart is null in this fixture
  });

  it("marks a session with a dead pid as not alive", async () => {
    const raw = makeRaw({ pid: 2 ** 30 });
    const enriched = await enrichSession(raw, { claudeProjectsDir: projectsDir, gitCache, transcriptIndexCache });
    expect(enriched.alive).toBe(false);
  });

  it("normalises a missing name through untouched (registry already defaults it)", async () => {
    const raw = makeRaw({ name: null });
    const enriched = await enrichSession(raw, { claudeProjectsDir: projectsDir, gitCache, transcriptIndexCache });
    expect(enriched.name).toBeNull();
  });

  it("fills in transcript path/slug and stats an existing transcript", async () => {
    const raw = makeRaw({ cwd: "/tmp/proj-a/proj-b" });
    const slug = "-tmp-proj-a-proj-b";
    await mkdir(path.join(projectsDir, slug), { recursive: true });
    await writeFile(path.join(projectsDir, slug, `${raw.sessionId}.jsonl`), "{}\n");

    const enriched = await enrichSession(raw, { claudeProjectsDir: projectsDir, gitCache, transcriptIndexCache });
    expect(enriched.projectSlug).toBe(slug);
    expect(enriched.transcriptSize).toBeGreaterThan(0);
  });

  it("reports transcriptSummary:null before the first scan, then populated after one", async () => {
    const raw = makeRaw({ cwd: "/tmp/proj-c" });
    const slug = "-tmp-proj-c";
    await mkdir(path.join(projectsDir, slug), { recursive: true });
    const transcriptPath = path.join(projectsDir, slug, `${raw.sessionId}.jsonl`);
    await writeFile(
      transcriptPath,
      `${JSON.stringify({
        type: "user",
        timestamp: "2026-01-01T00:00:00.000Z",
        message: { role: "user", content: "synthetic prompt" },
      })}\n`,
    );

    const firstPass = await enrichSession(raw, { claudeProjectsDir: projectsDir, gitCache, transcriptIndexCache });
    expect(firstPass.transcriptSummary).toBeNull();

    await transcriptIndexCache.refreshAndWait(raw.sessionId, transcriptPath);

    const secondPass = await enrichSession(raw, { claudeProjectsDir: projectsDir, gitCache, transcriptIndexCache });
    expect(secondPass.transcriptSummary?.turnCount).toBe(1);
    expect(secondPass.transcriptSummary?.lastUserPrompt?.text).toBe("synthetic prompt");
  });

  it("reports git:null for a cwd that is not a git repo", async () => {
    const raw = makeRaw({ cwd: "/tmp/synthetic-non-git-cwd-xyz" });
    const enriched = await enrichSession(raw, { claudeProjectsDir: projectsDir, gitCache, transcriptIndexCache });
    expect(enriched.git).toBeNull();
  });

  it("eventually reports git branch/dirty for a real git cwd", async () => {
    const repoDir = await mkdtemp(path.join(tmpdir(), "sessman-enrich-git-"));
    try {
      await execFileAsync("git", ["init", "-q", "-b", "main"], { cwd: repoDir });
      await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: repoDir });
      await execFileAsync("git", ["config", "user.name", "Test"], { cwd: repoDir });
      await writeFile(path.join(repoDir, "a.txt"), "hi");
      await execFileAsync("git", ["add", "."], { cwd: repoDir });
      await execFileAsync("git", ["commit", "-q", "-m", "init"], { cwd: repoDir });

      const raw = makeRaw({ cwd: repoDir });
      gitCache.getGitInfo(repoDir); // prime
      await waitFor(() => gitCache.getGitInfo(repoDir), (v) => v !== null);

      const enriched = await enrichSession(raw, { claudeProjectsDir: projectsDir, gitCache, transcriptIndexCache });
      expect(enriched.git).toEqual({ branch: "main", dirty: false });
    } finally {
      await rm(repoDir, { recursive: true, force: true });
    }
  });
});
