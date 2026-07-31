import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface LiveProcessInfo {
  tty: string | null;
  lstart: string | null;
}

/**
 * Queries `ps` for a pid's tty and process start time (ctime-style,
 * local-rendered — see ctime.ts). Returns null if the pid doesn't exist or
 * `ps` fails for any reason; never throws.
 */
export async function getLiveProcessInfo(pid: number): Promise<LiveProcessInfo | null> {
  try {
    const { stdout } = await execFileAsync("ps", ["-o", "tty=,lstart=", "-p", String(pid)]);
    const line = stdout.trim();
    if (!line) return null;

    // "tty=,lstart=" -> "ttys005 Fri Jul 31 09:11:55 2026"
    const match = /^(\S+)\s+(.+)$/.exec(line);
    if (!match) return null;

    const [, tty, lstart] = match;
    return {
      tty: tty === "??" ? null : tty,
      lstart,
    };
  } catch {
    return null;
  }
}

/** Liveness check via signal 0 — throws nothing, returns a boolean. */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but we lack permission to signal it —
    // still alive from our point of view.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}
