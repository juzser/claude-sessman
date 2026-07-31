import { describe, expect, it } from "vitest";
import { getLiveProcessInfo, isProcessAlive } from "./process-info.js";

describe("isProcessAlive", () => {
  it("returns true for the current process", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  it("returns false for a pid that almost certainly doesn't exist", () => {
    expect(isProcessAlive(2 ** 30)).toBe(false);
  });
});

describe("getLiveProcessInfo", () => {
  it("returns an lstart string for the current process", async () => {
    const info = await getLiveProcessInfo(process.pid);
    expect(info).not.toBeNull();
    expect(info?.lstart).toMatch(/^\w{3}\s+\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4}$/);
  });

  it("returns null for a pid that doesn't exist", async () => {
    const info = await getLiveProcessInfo(2 ** 30);
    expect(info).toBeNull();
  });
});
