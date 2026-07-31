/**
 * Deterministic avatar styling hashed from a sessionId: same session always
 * looks the same, and two sessions sharing a cwd still render distinctly
 * because the hash keys off sessionId, not cwd.
 */
export interface AvatarStyle {
  hueA: number;
  hueB: number;
  glyph: string;
}

export const GLYPHS = ["◆", "●", "▲", "■", "★", "◉", "✦", "◈", "▼", "✚", "◐", "☰"] as const;

/** FNV-1a, 32-bit. Cheap, deterministic, no external dependency needed. */
function hashString(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function avatarStyleFor(sessionId: string): AvatarStyle {
  const h = hashString(sessionId);
  const hueA = h % 360;
  // Offset by a large odd-ish constant (not a multiple of 360) so hueB
  // reliably differs from hueA even when h % 360 is small.
  const hueB = (hueA + 137) % 360;
  const glyph = GLYPHS[h % GLYPHS.length];
  return { hueA, hueB, glyph };
}

export function avatarGradientFor(sessionId: string): string {
  const { hueA, hueB } = avatarStyleFor(sessionId);
  return `linear-gradient(135deg, hsl(${hueA}, 70%, 45%), hsl(${hueB}, 70%, 35%))`;
}
