import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";

export type ProbeFn = (url: string) => Promise<boolean>;
export type SpawnFn = (command: string, args: string[]) => ChildProcess;

export interface OllamaLifecycleHandle {
  /** True if this process spawned `ollama serve`; false if an existing instance was reused, or spawn failed. */
  spawnedByUs: boolean;
  /** True if the `ollama` binary could not be found at all; caller should use NullSummarizer. */
  fellBackToNull: boolean;
  /** Kills the child ONLY if we spawned it — never touches an Ollama the operator started themselves. */
  stop(): void;
}

const PROBE_TIMEOUT_MS = 2000;

async function defaultProbe(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    return res.ok;
  } catch {
    return false;
  }
}

function defaultSpawn(command: string, args: string[]): ChildProcess {
  // stdio: "ignore" detaches ollama's own stdout/stderr from ours — we don't
  // want its logs interleaved with the server's.
  return nodeSpawn(command, args, { stdio: "ignore" });
}

/** Node emits exactly one of "spawn" (success) or "error" (e.g. ENOENT) — never both, never neither. */
function waitForSpawnOutcome(child: ChildProcess): Promise<"spawned" | "error"> {
  return new Promise((resolve) => {
    child.once("spawn", () => resolve("spawned"));
    child.once("error", () => resolve("error"));
  });
}

/**
 * Ensures Ollama is reachable before the server starts summarizing, without
 * ever touching an Ollama instance the operator started themselves:
 * - Probes `/api/tags`; if it answers, does nothing and never spawns.
 * - If unreachable, spawns `ollama serve` detached from this process's
 *   stdio; only the returned handle's `stop()` will ever kill that child.
 * - If the `ollama` binary is missing (spawn ENOENT), logs once and reports
 *   `fellBackToNull: true` so the caller can degrade to NullSummarizer
 *   instead of failing to start.
 */
export async function startOllamaLifecycle(
  config: { url: string },
  deps: { probe?: ProbeFn; spawn?: SpawnFn } = {},
): Promise<OllamaLifecycleHandle> {
  const probe = deps.probe ?? defaultProbe;
  const spawn = deps.spawn ?? defaultSpawn;

  const alreadyRunning = await probe(config.url);
  if (alreadyRunning) {
    return { spawnedByUs: false, fellBackToNull: false, stop() {} };
  }

  const child = spawn("ollama", ["serve"]);
  const outcome = await waitForSpawnOutcome(child);

  if (outcome === "error") {
    console.error(
      "[ollama-lifecycle] ollama binary not found; summaries will fall back to NullSummarizer (no LLM calls).",
    );
    return { spawnedByUs: false, fellBackToNull: true, stop() {} };
  }

  return {
    spawnedByUs: true,
    fellBackToNull: false,
    stop() {
      child.kill();
    },
  };
}
