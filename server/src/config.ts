import os from "node:os";
import path from "node:path";

export interface SummarizerConfig {
  kind: "ollama" | "null";
  model: string;
  url: string;
  cacheDir: string;
}

export interface AppConfig {
  sessionsDir: string;
  projectsDir: string;
  host: string;
  port: number;
  summarizer: SummarizerConfig;
}

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 5178;
/**
 * Summarization is opt-in, not opt-out. Running an Ollama server costs real
 * memory and CPU on the operator's machine for the whole time sessman is up,
 * and the fallback (real prompt/response text, truncated) is good enough that
 * paying that cost by default is not justified. Only an explicit
 * `SESSMAN_SUMMARIZER=ollama` selects the Ollama path; anything else,
 * including the variable being unset or misspelled, gets `NullSummarizer` and
 * never probes or spawns a thing.
 */
const DEFAULT_SUMMARIZER_KIND = "null";
const DEFAULT_OLLAMA_MODEL = "qwen2.5:3b";
const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";

function parseSummarizerKind(value: string | undefined): "ollama" | "null" {
  return value === "ollama" ? "ollama" : DEFAULT_SUMMARIZER_KIND;
}

/**
 * Reads runtime config from env, overridable for tests:
 * - SESSMAN_CLAUDE_DIR -> sessions registry dir (default ~/.claude/sessions)
 * - SESSMAN_CLAUDE_PROJECTS_DIR -> transcripts dir (default ~/.claude/projects)
 * - SESSMAN_HOST / SESSMAN_PORT -> bind address (default 127.0.0.1:5178)
 * - SESSMAN_SUMMARIZER -> "ollama" | "null" (default "null"); only the exact
 *   value "ollama" opts in to summarization, everything else gets the
 *   graceful-degradation NullSummarizer with no Ollama calls at all
 * - SESSMAN_OLLAMA_MODEL -> model name passed to Ollama (default "qwen2.5:3b")
 * - SESSMAN_OLLAMA_URL -> Ollama base URL (default "http://127.0.0.1:11434")
 * - SESSMAN_CACHE_DIR -> on-disk summary cache dir, outside ~/.claude on
 *   purpose (default ~/.cache/claude-sessman)
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const home = os.homedir();

  return {
    sessionsDir: env.SESSMAN_CLAUDE_DIR ?? path.join(home, ".claude", "sessions"),
    projectsDir: env.SESSMAN_CLAUDE_PROJECTS_DIR ?? path.join(home, ".claude", "projects"),
    host: env.SESSMAN_HOST ?? DEFAULT_HOST,
    port: env.SESSMAN_PORT ? Number(env.SESSMAN_PORT) : DEFAULT_PORT,
    summarizer: {
      kind: parseSummarizerKind(env.SESSMAN_SUMMARIZER),
      model: env.SESSMAN_OLLAMA_MODEL ?? DEFAULT_OLLAMA_MODEL,
      url: env.SESSMAN_OLLAMA_URL ?? DEFAULT_OLLAMA_URL,
      cacheDir: env.SESSMAN_CACHE_DIR ?? path.join(home, ".cache", "claude-sessman"),
    },
  };
}
