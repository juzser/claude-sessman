import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { startOllamaLifecycle } from "./ollama-lifecycle.js";

/**
 * A fake spawn() that returns a child emitting either "spawn" (success) or
 * "error" (ENOENT) on the next microtask — scheduled only once the caller
 * actually invokes spawn(), so the "once" listener is always attached first.
 */
function fakeSpawn(outcome: "spawn" | "error"): { child: EventEmitter & { kill: ReturnType<typeof vi.fn> }; spawn: ReturnType<typeof vi.fn> } {
  const child = Object.assign(new EventEmitter(), { kill: vi.fn(() => true) });
  const spawn = vi.fn(() => {
    queueMicrotask(() => {
      child.emit(outcome, outcome === "error" ? new Error("spawn ollama ENOENT") : undefined);
    });
    return child as unknown as ChildProcess;
  });
  return { child, spawn };
}

describe("startOllamaLifecycle", () => {
  it("does not spawn when Ollama already answers /api/tags", async () => {
    const spawn = vi.fn();
    const probe = vi.fn().mockResolvedValue(true);

    const handle = await startOllamaLifecycle({ url: "http://127.0.0.1:11434" }, { probe, spawn });

    expect(handle.spawnedByUs).toBe(false);
    expect(handle.fellBackToNull).toBe(false);
    expect(spawn).not.toHaveBeenCalled();
    handle.stop();
  });

  it("spawns `ollama serve` when nothing answers /api/tags, and stop() kills only that child", async () => {
    const probe = vi.fn().mockResolvedValue(false);
    const { child, spawn } = fakeSpawn("spawn");

    const handle = await startOllamaLifecycle({ url: "http://127.0.0.1:11434" }, { probe, spawn });

    expect(spawn).toHaveBeenCalledWith("ollama", ["serve"]);
    expect(handle.spawnedByUs).toBe(true);
    expect(handle.fellBackToNull).toBe(false);

    handle.stop();
    expect(child.kill).toHaveBeenCalledTimes(1);
  });

  it("falls back to NullSummarizer without throwing when the ollama binary is missing (spawn ENOENT)", async () => {
    const probe = vi.fn().mockResolvedValue(false);
    const { child, spawn } = fakeSpawn("error");

    const handle = await startOllamaLifecycle({ url: "http://127.0.0.1:11434" }, { probe, spawn });

    expect(handle.spawnedByUs).toBe(false);
    expect(handle.fellBackToNull).toBe(true);
    expect(() => handle.stop()).not.toThrow();
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("stop() never kills a child we did not spawn (an operator-started Ollama survives)", async () => {
    const spawn = vi.fn();
    const probe = vi.fn().mockResolvedValue(true);

    const handle = await startOllamaLifecycle({ url: "http://127.0.0.1:11434" }, { probe, spawn });
    expect(() => handle.stop()).not.toThrow();
    expect(spawn).not.toHaveBeenCalled();
  });
});
