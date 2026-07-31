import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { watchSessionsDir } from "./watcher.js";

async function waitUntil(predicate: () => boolean, timeoutMs = 3000, stepMs = 20): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitUntil timed out");
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

describe("watchSessionsDir", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "sessman-watch-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("fires onChange (debounced) after a file is written", async () => {
    // fs.watch is flaky on macOS (the reason a poll fallback exists at all —
    // see watcher.ts), so this test leans on both paths together, same as
    // production: a short poll interval guarantees the change is observed
    // even on a run where fs.watch drops the event.
    const onChange = vi.fn();
    const watcher = watchSessionsDir(dir, onChange, {
      debounceMs: 30,
      pollIntervalMs: 300,
    });

    try {
      await writeFile(path.join(dir, "111.json"), "{}");
      await waitUntil(() => onChange.mock.calls.length >= 1);
      expect(onChange.mock.calls.length).toBeGreaterThanOrEqual(1);
    } finally {
      watcher.stop();
    }
  });

  it("collapses a burst of writes into a single debounced call", async () => {
    const onChange = vi.fn();
    const watcher = watchSessionsDir(dir, onChange, {
      debounceMs: 100,
      // Long enough that the 2s-style poll tick can't sneak in a second call
      // during this test's assertion window, but see the comment below.
      pollIntervalMs: 2000,
    });

    try {
      await Promise.all([
        writeFile(path.join(dir, "a.json"), "{}"),
        writeFile(path.join(dir, "b.json"), "{}"),
        writeFile(path.join(dir, "c.json"), "{}"),
      ]);
      // fs.watch is flaky on macOS, so wait for the first debounced call via
      // whichever path fires it, then confirm it settled to exactly 1 (the
      // burst collapsed) well before the poll interval could contribute another.
      await waitUntil(() => onChange.mock.calls.length >= 1, 1800);
      await new Promise((r) => setTimeout(r, 400));
      expect(onChange.mock.calls.length).toBe(1);
    } finally {
      watcher.stop();
    }
  });

  it("falls back to polling even with no fs events", async () => {
    const onChange = vi.fn();
    const watcher = watchSessionsDir(dir, onChange, {
      debounceMs: 5,
      pollIntervalMs: 40,
    });

    try {
      await waitUntil(() => onChange.mock.calls.length >= 2, 2000);
      expect(onChange.mock.calls.length).toBeGreaterThanOrEqual(2);
    } finally {
      watcher.stop();
    }
  });

  it("stop() halts further callbacks", async () => {
    const onChange = vi.fn();
    const watcher = watchSessionsDir(dir, onChange, {
      debounceMs: 5,
      pollIntervalMs: 30,
    });

    await waitUntil(() => onChange.mock.calls.length >= 1, 2000);
    watcher.stop();
    const countAtStop = onChange.mock.calls.length;

    await new Promise((r) => setTimeout(r, 150));
    expect(onChange.mock.calls.length).toBe(countAtStop);
  });
});
