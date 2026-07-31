import { stat } from "node:fs/promises";
import { cwdToSlug, transcriptPathFor } from "./slug.js";

export interface TranscriptInfo {
  projectSlug: string;
  transcriptPath: string;
  transcriptSize: number | null;
  transcriptMtime: number | null;
}

/**
 * Locates the transcript file for a session and stats it (existence, size,
 * mtime) without ever reading its contents — transcripts can reach tens of
 * MB. Content parsing is out of scope for M1 (see docs/ROADMAP.md M2).
 */
export async function getTranscriptInfo(
  projectsDir: string,
  cwd: string,
  sessionId: string,
): Promise<TranscriptInfo> {
  const projectSlug = cwdToSlug(cwd);
  const transcriptPath = transcriptPathFor({ projectsDir, cwd, sessionId });

  try {
    const info = await stat(transcriptPath);
    return {
      projectSlug,
      transcriptPath,
      transcriptSize: info.size,
      transcriptMtime: info.mtimeMs,
    };
  } catch {
    return {
      projectSlug,
      transcriptPath,
      transcriptSize: null,
      transcriptMtime: null,
    };
  }
}
