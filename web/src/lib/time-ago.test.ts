import { describe, expect, it } from "vitest";
import { formatAgo, formatDurationShort } from "./time-ago";

describe("formatAgo", () => {
  it("renders sub-5s as just now", () => {
    expect(formatAgo(0)).toBe("just now");
    expect(formatAgo(4)).toBe("just now");
  });

  it("renders seconds", () => {
    expect(formatAgo(5)).toBe("5s ago");
    expect(formatAgo(59)).toBe("59s ago");
  });

  it("renders minutes", () => {
    expect(formatAgo(60)).toBe("1m ago");
    expect(formatAgo(125)).toBe("2m ago");
  });

  it("renders hours", () => {
    expect(formatAgo(3600)).toBe("1h ago");
    expect(formatAgo(7260)).toBe("2h ago");
  });

  it("renders days", () => {
    expect(formatAgo(86400)).toBe("1d ago");
    expect(formatAgo(200000)).toBe("2d ago");
  });
});

describe("formatDurationShort", () => {
  it("renders seconds only", () => {
    expect(formatDurationShort(45)).toBe("45s");
  });

  it("renders minutes and seconds dropped past minute scale", () => {
    expect(formatDurationShort(125)).toBe("2m");
  });

  it("renders hours and minutes", () => {
    expect(formatDurationShort(7860)).toBe("2h 11m");
  });

  it("renders days and hours", () => {
    expect(formatDurationShort(93600)).toBe("1d 2h");
  });
});
