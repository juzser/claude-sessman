import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GitInfo } from "./types.js";

const execFileAsync = promisify(execFile);

const DEFAULT_TTL_MS = 5000;

interface CacheEntry {
  value: GitInfo | null;
  fetchedAt: number;
  pending: Promise<GitInfo | null> | null;
}

async function fetchGitInfo(cwd: string): Promise<GitInfo | null> {
  try {
    const branchResult = await execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd,
    });
    const branch = branchResult.stdout.trim();
    if (!branch) return null;

    const statusResult = await execFileAsync("git", ["status", "--porcelain"], { cwd });
    const dirty = statusResult.stdout.trim().length > 0;

    return { branch, dirty };
  } catch {
    // Not a git repo, git not installed, or any other failure -> no git info.
    return null;
  }
}

/**
 * Caches git branch/dirty lookups per cwd for at least `ttlMs`. Never blocks
 * the caller on a fresh git process: on a cold cache it kicks off the fetch
 * in the background and returns null immediately (or the previous stale
 * value, once one exists), so a slow/hung git call can never stall the
 * `/api/sessions` response. Call `getGitInfo` again on the next poll tick to
 * pick up the refreshed value once it lands.
 */
export class GitInfoCache {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly ttlMs: number = DEFAULT_TTL_MS) {}

  getGitInfo(cwd: string): GitInfo | null {
    const entry = this.cache.get(cwd);
    const now = Date.now();

    if (entry && now - entry.fetchedAt < this.ttlMs) {
      return entry.value;
    }

    if (entry?.pending) {
      // A refresh is already in flight; return the last known value meanwhile.
      return entry.value;
    }

    const pending = fetchGitInfo(cwd).then((value) => {
      this.cache.set(cwd, { value, fetchedAt: Date.now(), pending: null });
      return value;
    });

    this.cache.set(cwd, {
      value: entry?.value ?? null,
      fetchedAt: entry?.fetchedAt ?? 0,
      pending,
    });

    return entry?.value ?? null;
  }
}
