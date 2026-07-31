import os from "node:os";
import path from "node:path";

export interface AppConfig {
  sessionsDir: string;
  projectsDir: string;
  host: string;
  port: number;
}

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 5178;

/**
 * Reads runtime config from env, overridable for tests:
 * - SESSMAN_CLAUDE_DIR -> sessions registry dir (default ~/.claude/sessions)
 * - SESSMAN_CLAUDE_PROJECTS_DIR -> transcripts dir (default ~/.claude/projects)
 * - SESSMAN_HOST / SESSMAN_PORT -> bind address (default 127.0.0.1:5178)
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const home = os.homedir();

  return {
    sessionsDir: env.SESSMAN_CLAUDE_DIR ?? path.join(home, ".claude", "sessions"),
    projectsDir: env.SESSMAN_CLAUDE_PROJECTS_DIR ?? path.join(home, ".claude", "projects"),
    host: env.SESSMAN_HOST ?? DEFAULT_HOST,
    port: env.SESSMAN_PORT ? Number(env.SESSMAN_PORT) : DEFAULT_PORT,
  };
}
