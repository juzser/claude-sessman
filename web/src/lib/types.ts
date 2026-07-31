/**
 * Mirrors server/src/types.ts EnrichedSession. Kept as a separate copy
 * (rather than importing across the workspace boundary) so the web
 * workspace has no build-time dependency on the server package.
 */
export type PidReuseResult = "match" | "mismatch" | "unknown";

export interface GitInfo {
  branch: string;
  dirty: boolean;
}

export interface EnrichedSession {
  pid: number;
  sessionId: string;
  cwd: string;
  startedAt: number;
  procStart: string | null;
  version: string | null;
  peerProtocol: number | null;
  kind: string | null;
  entrypoint: string | null;
  name: string | null;
  status: string;
  updatedAt: number | null;
  statusUpdatedAt: number | null;
  sourceFile: string;
  alive: boolean;
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
