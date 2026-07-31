export type StatusVisual = "busy" | "idle" | "stale" | "dead";

/**
 * Maps a raw session status + liveness to the card's status-dot visual.
 * Dead always wins over whatever status string was last recorded. Alive
 * sessions with an unrecognised status (including the registry's own
 * "unknown" normalisation) fall back to "stale" rather than a made-up
 * third color, per the M1 dot spec (busy=amber pulse, idle=green,
 * stale/dead=grey).
 */
export function statusVisualFor(status: string, alive: boolean): StatusVisual {
  if (!alive) return "dead";
  const normalized = status.toLowerCase();
  if (normalized === "busy") return "busy";
  if (normalized === "idle") return "idle";
  return "stale";
}
