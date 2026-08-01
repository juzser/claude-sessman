/** One recent turn's prompt/response reduced to a short pair for the card UI. */
export interface TurnSummary {
  prompt: string;
  response: string;
}

/** A whole-session description built from its recent prompts. */
export interface SessionSummary {
  description: string;
}

/**
 * Summarization backend contract. Implementations must never throw: a
 * failure (Ollama absent, unreachable, or an unparseable reply) resolves
 * `null` so callers can fall back to truncated real text instead of losing
 * the request.
 */
export interface Summarizer {
  summarizeTurn(input: { prompt: string; response: string }): Promise<TurnSummary | null>;
  summarizeSession(input: { recentPrompts: string[] }): Promise<SessionSummary | null>;
  close(): Promise<void>;
}

/**
 * Graceful-degradation summarizer used when Ollama is absent/disabled
 * (`SESSMAN_SUMMARIZER=null`, or the lifecycle probe fails to find/spawn the
 * `ollama` binary). Always resolves `null`, letting callers fall back to
 * truncated real prompt/response text.
 */
export class NullSummarizer implements Summarizer {
  async summarizeTurn(_input: { prompt: string; response: string }): Promise<TurnSummary | null> {
    return null;
  }

  async summarizeSession(_input: { recentPrompts: string[] }): Promise<SessionSummary | null> {
    return null;
  }

  async close(): Promise<void> {
    // No resources held.
  }
}
