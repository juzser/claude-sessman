/** A parsed, validated record from ~/.claude/sessions/<pid>.json. */
export interface RawSessionRecord {
  pid: number;
  sessionId: string;
  cwd: string;
  startedAt: number;
  /** ctime-style string, UTC-rendered by Claude Code (see ctime.ts). Null if missing/malformed. */
  procStart: string | null;
  version: string | null;
  peerProtocol: number | null;
  kind: string | null;
  entrypoint: string | null;
  /** User-set session name via /rename. Absent for unnamed sessions. */
  name: string | null;
  /** Open string; unrecognised/missing values normalise to "unknown". */
  status: string;
  updatedAt: number | null;
  statusUpdatedAt: number | null;
  /** Absolute path to the registry file this record was parsed from. */
  sourceFile: string;
}

export type PidReuseResult = "match" | "mismatch" | "unknown";

export interface GitInfo {
  branch: string;
  dirty: boolean;
}

export interface EnrichedSession extends RawSessionRecord {
  alive: boolean;
  /** Whether the recorded procStart matches the live process's start time. */
  pidReuse: PidReuseResult;
  tty: string | null;
  uptimeSec: number;
  lastActivityAgoSec: number;
  projectSlug: string;
  transcriptPath: string;
  transcriptSize: number | null;
  transcriptMtime: number | null;
  git: GitInfo | null;
}
