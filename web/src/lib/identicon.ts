/**
 * Deterministic avatar styling hashed from a sessionId: the same session always
 * looks the same, and two sessions sharing a cwd still differ because the hash
 * keys off sessionId, not cwd.
 *
 * The ground is a gradient, which the design system otherwise reserves for
 * nothing — the exception is deliberate and bounded: a 32px decorative tile
 * built from the CVD-safe `--ds-chart-*` palette the token file already
 * earmarks for "charts, avatars, and other decorative-categorical colouring",
 * never a colour invented here.
 */
export interface AvatarSwatch {
  /** 1-based `--ds-chart-N` index for the gradient's first stop. */
  from: number;
  /** 1-based index for the second stop; always the palette's next entry. */
  to: number;
}

/** The token file caps the categorical palette at eight series. */
export const CHART_SWATCH_COUNT = 8;

/**
 * How much of the raw chart colour survives the mix with black. Three of the
 * eight swatches (orange, green, cyan) carry white text at under 4.5:1 at full
 * strength, and which one a session lands on is the luck of a hash — so every
 * swatch is darkened to the point where the whole palette clears AA. sRGB
 * interpolation keeps a mid-gradient pixel no lighter than its lighter stop,
 * so clearing both stops clears the tile.
 */
const SWATCH_STRENGTH = 80;

/** First letter-or-digit of a name; anything else is chrome, not identity. */
const MONOGRAM_CHAR = /\p{L}|\p{N}/u;

/** FNV-1a, 32-bit. Cheap, deterministic, no external dependency needed. */
function hashString(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Avalanche step. FNV-1a's low bits carry the least entropy, and a modulus this
 * small reads nothing else — session ids that differ only in their tail would
 * otherwise pile onto two or three swatches.
 */
function mix32(hash: number): number {
  let h = hash;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  return h >>> 0;
}

export function avatarSwatchFor(sessionId: string): AvatarSwatch {
  const from = (mix32(hashString(sessionId)) % CHART_SWATCH_COUNT) + 1;
  // Adjacent rather than opposite: neighbours in this palette are close enough
  // that the tile reads as one colour with depth, not as two colours fighting.
  return { from, to: (from % CHART_SWATCH_COUNT) + 1 };
}

function stop(swatch: number): string {
  return `color-mix(in srgb, var(--ds-chart-${swatch}) ${SWATCH_STRENGTH}%, black)`;
}

export function avatarGradientFor(sessionId: string): string {
  const { from, to } = avatarSwatchFor(sessionId);
  return `linear-gradient(135deg, ${stop(from)}, ${stop(to)})`;
}

/**
 * One character standing in for the session's name. Iterating by codepoint
 * keeps a multi-byte first character whole instead of slicing a surrogate pair.
 */
export function monogramFor(label: string): string {
  const first = [...label].find((char) => MONOGRAM_CHAR.test(char));
  return (first ?? "?").toUpperCase();
}
