import { describe, expect, it } from "vitest";
import { parseCtime } from "./ctime.js";

describe("parseCtime", () => {
  it("parses a ctime-style string as UTC when asUtc is true", () => {
    // Fri Jul 31 2026 02:11:55 UTC -> epoch ms
    const epoch = parseCtime("Fri Jul 31 02:11:55 2026", { utc: true });
    expect(epoch).toBe(Date.UTC(2026, 6, 31, 2, 11, 55));
  });

  it("parses a ctime-style string as local time when asUtc is false", () => {
    const epoch = parseCtime("Fri Jul 31 09:11:55 2026", { utc: false });
    expect(epoch).toBe(new Date(2026, 6, 31, 9, 11, 55).getTime());
  });

  it("handles single-digit days with extra padding space", () => {
    const epoch = parseCtime("Mon Jan  5 00:00:00 2026", { utc: true });
    expect(epoch).toBe(Date.UTC(2026, 0, 5, 0, 0, 0));
  });

  it("returns null for malformed input", () => {
    expect(parseCtime("not a date", { utc: true })).toBeNull();
    expect(parseCtime("", { utc: true })).toBeNull();
    expect(parseCtime("Fri Jul 31 2026", { utc: true })).toBeNull();
  });

  it("returns null for an unrecognised month", () => {
    expect(parseCtime("Fri Xyz 31 02:11:55 2026", { utc: true })).toBeNull();
  });
});
