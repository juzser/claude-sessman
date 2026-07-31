import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GitInfoCache } from "./git-info.js";
import type { GitInfo } from "./types.js";

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd });
}

async function waitFor(
  fn: () => GitInfo | null,
  predicate: (v: GitInfo | null) => boolean,
  timeoutMs = 3000,
): Promise<GitInfo | null> {
  const start = Date.now();
  for (;;) {
    const value = fn();
    if (predicate(value)) return value;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe("GitInfoCache", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "sessman-git-"));
    await git(dir, ["init", "-q", "-b", "main"]);
    await git(dir, ["config", "user.email", "test@example.com"]);
    await git(dir, ["config", "user.name", "Test"]);
    await writeFile(path.join(dir, "a.txt"), "hello");
    await git(dir, ["add", "."]);
    await git(dir, ["commit", "-q", "-m", "init"]);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns null for a cwd that is not a git repo", async () => {
    const notGitDir = await mkdtemp(path.join(tmpdir(), "sessman-notgit-"));
    try {
      const cache = new GitInfoCache();
      expect(cache.getGitInfo(notGitDir)).toBeNull();
      // give any background fetch a chance to settle - should stay null.
      await new Promise((r) => setTimeout(r, 100));
      expect(cache.getGitInfo(notGitDir)).toBeNull();
    } finally {
      await rm(notGitDir, { recursive: true, force: true });
    }
  });

  it("never blocks the caller: the first call returns synchronously without awaiting the git process", () => {
    const cache = new GitInfoCache();
    const before = Date.now();
    const result = cache.getGitInfo(dir);
    const elapsed = Date.now() - before;
    expect(result).toBeNull(); // cold cache: fetch kicked off in background
    expect(elapsed).toBeLessThan(20);
  });

  it("eventually reports the branch and a clean working tree", async () => {
    const cache = new GitInfoCache();
    cache.getGitInfo(dir); // prime the cache
    const value = await waitFor(() => cache.getGitInfo(dir), (v) => v !== null);
    expect(value).toEqual({ branch: "main", dirty: false });
  });

  it("reports dirty:true once a file is modified and the cache refreshes", async () => {
    const cache = new GitInfoCache(20); // short TTL so the test doesn't need to wait long
    cache.getGitInfo(dir);
    await waitFor(() => cache.getGitInfo(dir), (v) => v !== null);

    await writeFile(path.join(dir, "a.txt"), "changed");

    const value = await waitFor(() => cache.getGitInfo(dir), (v) => v?.dirty === true);
    expect(value).toEqual({ branch: "main", dirty: true });
  });
});
