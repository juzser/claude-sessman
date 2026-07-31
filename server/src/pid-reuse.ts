import { parseCtime } from "./ctime.js";
import type { PidReuseResult } from "./types.js";

const DEFAULT_TOLERANCE_MS = 2000;

/**
 * Compares a registry file's recorded `procStart` (UTC-rendered) against a
 * freshly-queried live `ps -o lstart` string (local-rendered) for the same
 * pid. A mismatch beyond `toleranceMs` means the pid has been reused by an
 * unrelated process since the registry file was written (or the process is
 * dead and the pid now belongs to something else) — the session file is
 * stale. See ctime.ts for why the two strings need different parsing rules.
 */
export function checkPidReuse(
  procStart: string | null,
  liveLstart: string | null,
  toleranceMs: number = DEFAULT_TOLERANCE_MS,
): PidReuseResult {
  if (procStart === null || liveLstart === null) return "unknown";

  const recorded = parseCtime(procStart, { utc: true });
  const live = parseCtime(liveLstart, { utc: false });
  if (recorded === null || live === null) return "unknown";

  return Math.abs(recorded - live) <= toleranceMs ? "match" : "mismatch";
}
