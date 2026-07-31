import { describe, expect, it } from "vitest";
import { checkPidReuse } from "./pid-reuse.js";

// vitest.config.ts pins TZ=Asia/Bangkok (UTC+7) for this whole suite so that
// "local" parsing is deterministic across machines/CI. This mirrors the
// operator's real machine, where procStart (UTC-rendered) and a live
// `ps -o lstart` (local-rendered) are offset by exactly this much.
describe("checkPidReuse", () => {
  it("matches when the UTC-rendered procStart lines up with a local-rendered live lstart", () => {
    const result = checkPidReuse("Fri Jul 31 02:11:55 2026", "Fri Jul 31 09:11:55 2026");
    expect(result).toBe("match");
  });

  it("tolerates sub-second/rounding differences within the default tolerance", () => {
    const result = checkPidReuse("Fri Jul 31 02:11:55 2026", "Fri Jul 31 09:11:56 2026");
    expect(result).toBe("match");
  });

  it("reports a mismatch when the live process started at a clearly different time", () => {
    const result = checkPidReuse("Fri Jul 31 02:11:55 2026", "Fri Jul 31 09:45:00 2026");
    expect(result).toBe("mismatch");
  });

  it("respects a custom tolerance", () => {
    expect(checkPidReuse("Fri Jul 31 02:11:55 2026", "Fri Jul 31 09:11:58 2026", 1000)).toBe(
      "mismatch",
    );
    expect(checkPidReuse("Fri Jul 31 02:11:55 2026", "Fri Jul 31 09:11:58 2026", 5000)).toBe(
      "match",
    );
  });

  it("returns unknown when either input is missing or unparseable", () => {
    expect(checkPidReuse(null, "Fri Jul 31 09:11:55 2026")).toBe("unknown");
    expect(checkPidReuse("Fri Jul 31 02:11:55 2026", null)).toBe("unknown");
    expect(checkPidReuse("garbage", "also garbage")).toBe("unknown");
  });
});
