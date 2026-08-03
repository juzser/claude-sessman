import type { TranscriptTurn } from "./types";

/**
 * Collapses whitespace/newlines into single spaces and truncates for a
 * single-line display (card prompt line, drawer turn list). Server-side
 * captures are already whitespace-collapsed, but this stays defensive so
 * any raw text passed in still renders as one line.
 */
export function truncateLine(text: string, maxLength: number): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxLength) return collapsed;
  return `${collapsed.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

const TOKEN_UNITS: ReadonlyArray<readonly [number, string]> = [
  [1_000_000, "M"],
  [1_000, "k"],
];

/** Compact display for a token/context figure, e.g. 1234 -> "1.2k", 2_500_000 -> "2.5M". */
export function formatTokenCount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n < 1000) return String(Math.round(n));

  for (const [threshold, suffix] of TOKEN_UNITS) {
    if (n >= threshold) {
      const rounded = Math.round((n / threshold) * 10) / 10;
      const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
      return `${text}${suffix}`;
    }
  }
  return String(Math.round(n));
}

/** Orders a per-tool call-count map for deterministic display: busiest tool first, ties broken by name. */
export function sortToolCounts(toolCounts: Record<string, number>): Array<{ name: string; count: number }> {
  return Object.entries(toolCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** Extracts the HH:MM:SS portion of an ISO-8601 UTC timestamp; never converts time zone. */
export function formatTurnTime(at: string | null): string {
  if (at === null) return "—";
  const match = at.match(/T(\d{2}:\d{2}:\d{2})/);
  return match ? match[1] : at;
}

/**
 * The reply slot takes the LLM summary when one exists and the raw captured
 * gist otherwise. Same slot, same classes either way, so a summarized reply
 * must not be visually distinguishable from a raw one. The operator's own
 * prompt follows the opposite rule and is never routed through this
 * function: it is always rendered as real captured text, verbatim.
 *
 * Every call site that renders a turn's reply (TurnStrip, SessionFlowView)
 * must go through this one function rather than reading `gist.text`
 * directly, so the two cannot drift on which source wins.
 */
export function replyText(turn: Pick<TranscriptTurn, "summary" | "gist">): string {
  return turn.summary?.response ?? turn.gist.text;
}
