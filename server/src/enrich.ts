import { GitInfoCache } from "./git-info.js";
import { checkPidReuse } from "./pid-reuse.js";
import { getLiveProcessInfo, isProcessAlive } from "./process-info.js";
import { getTranscriptInfo } from "./transcript.js";
import { TranscriptIndexCache } from "./transcript-index.js";
import type { EnrichedSession, RawSessionRecord } from "./types.js";

export interface EnrichOptions {
  claudeProjectsDir: string;
  gitCache: GitInfoCache;
  transcriptIndexCache: TranscriptIndexCache;
  /** Injectable for deterministic tests; defaults to Date.now(). */
  now?: number;
}

function secondsSince(now: number, epochMs: number): number {
  return Math.max(0, Math.round((now - epochMs) / 1000));
}

export async function enrichSession(
  raw: RawSessionRecord,
  options: EnrichOptions,
): Promise<EnrichedSession> {
  const now = options.now ?? Date.now();

  const [liveInfo, transcriptInfo] = await Promise.all([
    getLiveProcessInfo(raw.pid),
    getTranscriptInfo(options.claudeProjectsDir, raw.cwd, raw.sessionId),
  ]);

  const aliveBySignal = isProcessAlive(raw.pid);
  const pidReuse = checkPidReuse(raw.procStart, liveInfo?.lstart ?? null);
  const alive = aliveBySignal && pidReuse !== "mismatch";

  const uptimeSec = secondsSince(now, raw.startedAt);
  const lastActivityAgoSec =
    raw.updatedAt !== null ? secondsSince(now, raw.updatedAt) : uptimeSec;

  return {
    ...raw,
    alive,
    pidReuse,
    tty: liveInfo?.tty ?? null,
    uptimeSec,
    lastActivityAgoSec,
    ...transcriptInfo,
    transcriptSummary: options.transcriptIndexCache.getSummary(raw.sessionId, transcriptInfo.transcriptPath),
    git: options.gitCache.getGitInfo(raw.cwd),
  };
}

export async function enrichSessions(
  raws: RawSessionRecord[],
  options: EnrichOptions,
): Promise<EnrichedSession[]> {
  return Promise.all(raws.map((raw) => enrichSession(raw, options)));
}
