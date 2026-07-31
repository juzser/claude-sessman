import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { RawSessionRecord } from "./types.js";

function asStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseRecord(raw: unknown, sourceFile: string): RawSessionRecord | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;

  const pid = asNumberOrNull(obj.pid);
  const sessionId = asStringOrNull(obj.sessionId);
  const cwd = asStringOrNull(obj.cwd);
  const startedAt = asNumberOrNull(obj.startedAt);

  // Required fields: without these the record is unusable, skip the file.
  if (pid === null || sessionId === null || cwd === null || startedAt === null) {
    return null;
  }

  const status = typeof obj.status === "string" && obj.status.length > 0 ? obj.status : "unknown";

  return {
    pid,
    sessionId,
    cwd,
    startedAt,
    procStart: asStringOrNull(obj.procStart),
    version: asStringOrNull(obj.version),
    peerProtocol: asNumberOrNull(obj.peerProtocol),
    kind: asStringOrNull(obj.kind),
    entrypoint: asStringOrNull(obj.entrypoint),
    name: asStringOrNull(obj.name),
    status,
    updatedAt: asNumberOrNull(obj.updatedAt),
    statusUpdatedAt: asNumberOrNull(obj.statusUpdatedAt),
    sourceFile,
  };
}

/**
 * Reads every `<pid>.json` file in the sessions directory into a validated
 * `RawSessionRecord`. Never throws for a missing directory, unreadable file,
 * malformed JSON, or a record missing required fields — those are silently
 * skipped so one bad file can't take down the whole dashboard.
 */
export async function readSessionRegistry(dir: string): Promise<RawSessionRecord[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  const jsonFiles = entries.filter((name) => name.endsWith(".json"));

  const results = await Promise.all(
    jsonFiles.map(async (name) => {
      const filePath = path.join(dir, name);
      let contents: string;
      try {
        contents = await readFile(filePath, "utf8");
      } catch {
        return null;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(contents);
      } catch {
        return null;
      }

      return parseRecord(parsed, filePath);
    }),
  );

  return results.filter((r): r is RawSessionRecord => r !== null);
}
