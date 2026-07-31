import path from "node:path";

/**
 * Encodes a session's cwd into the slug directory name Claude Code uses
 * under ~/.claude/projects/<slug>/<sessionId>.jsonl, by replacing every
 * "/" and "." with "-".
 */
export function cwdToSlug(cwd: string): string {
  return cwd.replace(/[/.]/g, "-");
}

export interface TranscriptPathInput {
  projectsDir: string;
  cwd: string;
  sessionId: string;
}

export function transcriptPathFor({ projectsDir, cwd, sessionId }: TranscriptPathInput): string {
  const slug = cwdToSlug(cwd);
  return path.join(projectsDir, slug, `${sessionId}.jsonl`);
}
