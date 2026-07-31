import { enrichSessions } from "./enrich.js";
import type { GitInfoCache } from "./git-info.js";
import { readSessionRegistry } from "./registry.js";
import type { TranscriptIndexCache } from "./transcript-index.js";
import type { EnrichedSession } from "./types.js";

export interface SessionsServiceConfig {
  sessionsDir: string;
  projectsDir: string;
}

export interface GetSessionsOptions {
  includeDead?: boolean;
}

/**
 * The single read path shared by the REST endpoint and the WS broadcaster:
 * read the registry, enrich every record, and filter dead/stale sessions out
 * by default.
 */
export async function getSessions(
  config: SessionsServiceConfig,
  gitCache: GitInfoCache,
  transcriptIndexCache: TranscriptIndexCache,
  options: GetSessionsOptions = {},
): Promise<EnrichedSession[]> {
  const raws = await readSessionRegistry(config.sessionsDir);
  const enriched = await enrichSessions(raws, {
    claudeProjectsDir: config.projectsDir,
    gitCache,
    transcriptIndexCache,
  });

  return options.includeDead ? enriched : enriched.filter((s) => s.alive);
}
