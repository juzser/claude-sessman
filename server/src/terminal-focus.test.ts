import { describe, expect, it } from "vitest";
import { createOsascriptFocusRunner } from "./terminal-focus.js";
import type { ExecFileFn } from "./terminal-focus.js";

describe("createOsascriptFocusRunner", () => {
  it("invokes osascript with the tty as a plain argv element, never string-interpolated", async () => {
    let capturedCommand: string | undefined;
    let capturedArgs: readonly string[] | undefined;

    const fakeExecFile: ExecFileFn = ((command: string, args: readonly string[], callback: (error: Error | null) => void) => {
      capturedCommand = command;
      capturedArgs = args;
      callback(null);
    }) as unknown as ExecFileFn;

    const runner = createOsascriptFocusRunner(fakeExecFile);
    const result = await runner.focusTty("ttys004");

    expect(result.ok).toBe(true);
    expect(capturedCommand).toBe("osascript");
    expect(capturedArgs?.[0]).toBe("-e");
    // The tty must arrive as its own argv element (index 2), not concatenated
    // into the script string at index 1 — this is what makes injection via a
    // crafted tty value impossible.
    expect(capturedArgs?.[2]).toBe("ttys004");
    expect(capturedArgs?.[1]).not.toContain("ttys004");
    expect(capturedArgs?.[1]).toContain("on run argv");
  });

  it("returns a clear, non-stack-trace error when osascript fails (e.g. Terminal.app not running an iTerm2 tty)", async () => {
    const fakeExecFile: ExecFileFn = ((_command: string, _args: readonly string[], callback: (error: Error | null) => void) => {
      callback(new Error("osascript: some internal AppleScript failure detail"));
    }) as unknown as ExecFileFn;

    const runner = createOsascriptFocusRunner(fakeExecFile);
    const result = await runner.focusTty("ttys004");

    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
    // A stack trace has a "\n    at " frame line; a friendly message doesn't.
    expect(result.error).not.toMatch(/\n\s*at /);
    expect(result.error).not.toContain("osascript: some internal AppleScript failure detail");
  });
});
