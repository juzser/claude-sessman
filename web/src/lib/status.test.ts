import { describe, expect, it } from "vitest";
import { statusVisualFor } from "./status";

describe("statusVisualFor", () => {
  it("maps a dead session to dead regardless of reported status", () => {
    expect(statusVisualFor("busy", false)).toBe("dead");
    expect(statusVisualFor("idle", false)).toBe("dead");
  });

  it("maps an alive busy session to busy", () => {
    expect(statusVisualFor("busy", true)).toBe("busy");
    expect(statusVisualFor("BUSY", true)).toBe("busy");
  });

  it("maps an alive idle session to idle", () => {
    expect(statusVisualFor("idle", true)).toBe("idle");
  });

  it("maps an alive unrecognised status to stale", () => {
    expect(statusVisualFor("unknown", true)).toBe("stale");
    expect(statusVisualFor("something-new", true)).toBe("stale");
  });
});
