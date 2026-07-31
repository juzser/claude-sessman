import { describe, expect, it } from "vitest";
import { avatarGradientFor, avatarStyleFor, GLYPHS } from "./identicon";

describe("avatarStyleFor", () => {
  it("is deterministic for the same sessionId", () => {
    const a = avatarStyleFor("session-abc-123");
    const b = avatarStyleFor("session-abc-123");
    expect(b).toEqual(a);
  });

  it("produces two distinct hues in [0, 360)", () => {
    const style = avatarStyleFor("session-abc-123");
    expect(style.hueA).toBeGreaterThanOrEqual(0);
    expect(style.hueA).toBeLessThan(360);
    expect(style.hueB).toBeGreaterThanOrEqual(0);
    expect(style.hueB).toBeLessThan(360);
    expect(style.hueA).not.toBe(style.hueB);
  });

  it("picks a glyph from the fixed glyph set", () => {
    const style = avatarStyleFor("session-abc-123");
    expect(GLYPHS).toContain(style.glyph);
  });

  it("renders two sessions sharing one cwd distinctly", () => {
    // Same cwd, different sessionId -> the avatar must differ so two cards
    // for the same project are still visually distinguishable.
    const a = avatarStyleFor("11111111-aaaa-4bbb-8ccc-111111111111");
    const b = avatarStyleFor("22222222-aaaa-4bbb-8ccc-222222222222");
    expect(a).not.toEqual(b);
  });

  it("returns a usable CSS gradient string", () => {
    const gradient = avatarGradientFor("session-abc-123");
    expect(gradient).toMatch(/^linear-gradient\(135deg, hsl\(\d+, \d+%, \d+%\), hsl\(\d+, \d+%, \d+%\)\)$/);
  });
});
