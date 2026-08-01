import type { SessionSummary, Summarizer, TurnSummary } from "./summarizer.js";

export interface OllamaClientConfig {
  model: string;
  url: string;
  /** Overrides GENERATE_TIMEOUT_MS; defaults to the real 20s production value. Only ever overridden in tests, to prove the timeout fires without waiting 20 real seconds. */
  timeoutMs?: number;
}

const GENERATE_TIMEOUT_MS = 20_000;

// A 3B model echoes instruction-like field descriptions back as answers, so
// the JSON contract below deliberately uses short noun keys ("ask"/"did"/
// "desc") instead of sentence-shaped field names, plus a few-shot example.
const TURN_SYSTEM_PROMPT =
  "You summarize one turn of a coding assistant transcript into a short ask/did pair for a UI card. " +
  "Respond with strict JSON only — no prose, no markdown fences — matching the example's shape exactly.";

const SESSION_SYSTEM_PROMPT =
  "You write a short one-line description of what a coding session is currently about, based on the " +
  "user's most recent prompts. Respond with strict JSON only — no prose, no markdown fences — matching " +
  "the example's shape exactly.";

function buildTurnPrompt(input: { prompt: string; response: string }): string {
  return [
    "Example:",
    "prompt: Fix the failing login test",
    "response: Updated the mock token expiry and reran the suite; test passes now.",
    'output: {"ask": "fix failing login test", "did": "fixed mock token expiry, test passes"}',
    "",
    "Now summarize this turn:",
    `prompt: ${input.prompt}`,
    `response: ${input.response}`,
    "output:",
  ].join("\n");
}

function buildSessionPrompt(input: { recentPrompts: string[] }): string {
  return [
    "Example:",
    "prompts:",
    "- Fix the failing login test",
    "- Add a retry to the flaky network call",
    'output: {"desc": "hardening login test reliability"}',
    "",
    "Now summarize this session:",
    "prompts:",
    ...input.recentPrompts.map((p) => `- ${p}`),
    "output:",
  ].join("\n");
}

/** Strips an optional ```json fenced block, then parses; returns null on anything unparseable. */
function parseJsonReply(text: string): unknown | null {
  const stripped = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  try {
    return JSON.parse(stripped);
  } catch {
    return null;
  }
}

function isTurnPayload(value: unknown): value is { ask: string; did: string } {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.ask === "string" && typeof record.did === "string";
}

function isSessionPayload(value: unknown): value is { desc: string } {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.desc === "string";
}

/**
 * Thin HTTP client over Ollama's `POST /api/generate` (loopback-only,
 * `stream: false`, `temperature: 0`). Never throws to the caller: any
 * network failure, non-2xx response, timeout, or unparseable reply resolves
 * `null` so callers degrade to truncated real text instead of losing the
 * request.
 */
export class OllamaSummarizer implements Summarizer {
  constructor(private readonly config: OllamaClientConfig) {}

  async summarizeTurn(input: { prompt: string; response: string }): Promise<TurnSummary | null> {
    const reply = await this.generate(TURN_SYSTEM_PROMPT, buildTurnPrompt(input));
    if (reply === null) return null;

    const parsed = parseJsonReply(reply);
    if (!isTurnPayload(parsed)) return null;

    return { prompt: parsed.ask, response: parsed.did };
  }

  async summarizeSession(input: { recentPrompts: string[] }): Promise<SessionSummary | null> {
    const reply = await this.generate(SESSION_SYSTEM_PROMPT, buildSessionPrompt(input));
    if (reply === null) return null;

    const parsed = parseJsonReply(reply);
    if (!isSessionPayload(parsed)) return null;

    return { description: parsed.desc };
  }

  async close(): Promise<void> {
    // Stateless HTTP client — no connection/resource to release.
  }

  private async generate(system: string, prompt: string): Promise<string | null> {
    try {
      const res = await fetch(`${this.config.url}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.config.model,
          system,
          prompt,
          stream: false,
          options: { temperature: 0 },
        }),
        signal: AbortSignal.timeout(this.config.timeoutMs ?? GENERATE_TIMEOUT_MS),
      });
      if (!res.ok) return null;

      const data = (await res.json()) as { response?: unknown };
      return typeof data.response === "string" ? data.response : null;
    } catch {
      return null;
    }
  }
}
