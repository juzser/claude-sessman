import { watch, type FSWatcher } from "node:fs";

export interface WatcherOptions {
  /** Debounce window after a change event / poll tick before firing onChange. */
  debounceMs?: number;
  /** Poll fallback interval — fs.watch is unreliable on macOS, so we always poll too. */
  pollIntervalMs?: number;
}

const DEFAULT_DEBOUNCE_MS = 150;
const DEFAULT_POLL_INTERVAL_MS = 2000;

export interface SessionWatcher {
  stop(): void;
}

/**
 * Watches a directory for changes via fs.watch, with a periodic poll as a
 * fallback (fs.watch misses changes on macOS in some cases). Both paths are
 * debounced into a single onChange callback so a burst of file writes only
 * triggers one broadcast.
 */
export function watchSessionsDir(
  dir: string,
  onChange: () => void,
  options: WatcherOptions = {},
): SessionWatcher {
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

  let debounceTimer: NodeJS.Timeout | null = null;
  const trigger = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      onChange();
    }, debounceMs);
  };

  let fsWatcher: FSWatcher | null = null;
  try {
    fsWatcher = watch(dir, { persistent: false }, () => trigger());
  } catch {
    // Directory may not exist yet, or the platform may not support watch
    // here; the poll fallback below still covers us.
    fsWatcher = null;
  }

  const pollTimer = setInterval(trigger, pollIntervalMs);
  // Don't let the poll interval keep the process alive on its own.
  pollTimer.unref?.();

  return {
    stop(): void {
      if (debounceTimer) clearTimeout(debounceTimer);
      clearInterval(pollTimer);
      fsWatcher?.close();
    },
  };
}
