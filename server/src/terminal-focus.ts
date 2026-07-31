import { execFile } from "node:child_process";

export interface FocusResult {
  ok: boolean;
  /** Present only when ok is false; a human-readable message, never a raw stack trace. */
  error?: string;
}

export interface FocusRunner {
  focusTty(tty: string): Promise<FocusResult>;
}

/** Matches the shape of node:child_process's execFile with a plain (error-only) callback. */
export type ExecFileFn = (
  command: string,
  args: readonly string[],
  callback: (error: Error | null) => void,
) => void;

const GENERIC_FAILURE_MESSAGE =
  "Could not focus that terminal tab. This action only supports Apple Terminal " +
  "(iTerm2 and other terminal apps are not supported); the tab may also have been closed.";

/**
 * Focuses a Terminal.app tab by tty via AppleScript. The tty is always passed
 * as its own `on run argv` element — never interpolated into the script
 * string — so a crafted tty value can't inject AppleScript.
 */
const FOCUS_SCRIPT = `
on run argv
  set targetTty to item 1 of argv
  tell application "Terminal"
    activate
    repeat with w in windows
      repeat with t in tabs of w
        if tty of t is targetTty then
          set selected of w to t
          set index of w to 1
          return
        end if
      end repeat
    end repeat
  end tell
  error "tty not found in Terminal.app: " & targetTty
end run
`;

export function createOsascriptFocusRunner(execFileImpl: ExecFileFn = execFile as unknown as ExecFileFn): FocusRunner {
  return {
    focusTty(tty: string): Promise<FocusResult> {
      return new Promise((resolve) => {
        execFileImpl("osascript", ["-e", FOCUS_SCRIPT, tty], (error) => {
          if (error) {
            resolve({ ok: false, error: GENERIC_FAILURE_MESSAGE });
            return;
          }
          resolve({ ok: true });
        });
      });
    },
  };
}
