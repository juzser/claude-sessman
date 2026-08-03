import { describe, expect, it } from "vitest";
import { avatarGradientFor, avatarSwatchFor, CHART_SWATCH_COUNT, monogramFor } from "./identicon";

const STOP = String.raw`color-mix\(in srgb, var\(--ds-chart-[1-8]\) \d{1,3}%, black\)`;
const GRADIENT = new RegExp(String.raw`^linear-gradient\(135deg, ${STOP}, ${STOP}\)$`);

function sampleIds(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `session-${i}-aaaa-4bbb-8ccc-${i}${i}${i}`);
}

describe("avatarSwatchFor", () => {
  it("gives the same session the same swatch every time", () => {
    expect(avatarSwatchFor("session-abc-123")).toEqual(avatarSwatchFor("session-abc-123"));
  });

  it("stays inside the eight-swatch palette for any session id", () => {
    for (const id of sampleIds(64)) {
      const { from, to } = avatarSwatchFor(id);
      expect(from).toBeGreaterThanOrEqual(1);
      expect(from).toBeLessThanOrEqual(CHART_SWATCH_COUNT);
      expect(to).toBeGreaterThanOrEqual(1);
      expect(to).toBeLessThanOrEqual(CHART_SWATCH_COUNT);
    }
  });

  it("keeps the two stops adjacent so the gradient reads as one colour, not two", () => {
    for (const id of sampleIds(64)) {
      const { from, to } = avatarSwatchFor(id);
      expect(to).toBe((from % CHART_SWATCH_COUNT) + 1);
    }
  });

  it("spreads sessions across the palette instead of parking them on one swatch", () => {
    // Session ids differ mostly in their tail, which is exactly where a naive
    // `hash % 8` reads the least entropy.
    const used = new Set(sampleIds(64).map((id) => avatarSwatchFor(id).from));
    expect(used.size).toBeGreaterThanOrEqual(6);
  });
});

describe("avatarGradientFor", () => {
  it("builds both stops out of chart tokens rather than a raw colour", () => {
    expect(avatarGradientFor("session-abc-123")).toMatch(GRADIENT);
  });

  it("darkens every swatch so a white monogram reads on all eight", () => {
    // Three of the eight chart colours are too light for white text at full
    // strength; which one a session lands on is the luck of a hash, so the
    // contrast cannot be left to it.
    for (const id of sampleIds(64)) {
      expect(avatarGradientFor(id)).toMatch(GRADIENT);
    }
  });
});

describe("monogramFor", () => {
  it("takes the display name's first letter, uppercased", () => {
    expect(monogramFor("demo-app")).toBe("D");
  });

  it("skips leading punctuation so a path-shaped name still yields a letter", () => {
    expect(monogramFor("  ~/demo-app")).toBe("D");
  });

  it("keeps a digit when the name starts with one", () => {
    expect(monogramFor("2fa-service")).toBe("2");
  });

  it("takes whole characters, not half a surrogate pair", () => {
    expect(monogramFor("𝒜pp")).toHaveLength(2);
  });

  it("falls back to a placeholder rather than an empty circle", () => {
    expect(monogramFor("")).toBe("?");
    expect(monogramFor("---")).toBe("?");
  });
});
