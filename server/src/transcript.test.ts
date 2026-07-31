import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getTranscriptInfo } from "./transcript.js";
import { cwdToSlug } from "./slug.js";

describe("getTranscriptInfo", () => {
  let projectsDir: string;

  beforeEach(async () => {
    projectsDir = await mkdtemp(path.join(tmpdir(), "sessman-projects-"));
  });

  afterEach(async () => {
    await rm(projectsDir, { recursive: true, force: true });
  });

  it("stats an existing transcript without reading its contents", async () => {
    const cwd = "/tmp/synthetic-project";
    const sessionId = "synthetic-session-id";
    const slug = cwdToSlug(cwd);
    await mkdir(path.join(projectsDir, slug), { recursive: true });
    const content = "{\"synthetic\":true}\n".repeat(10);
    await writeFile(path.join(projectsDir, slug, `${sessionId}.jsonl`), content);

    const info = await getTranscriptInfo(projectsDir, cwd, sessionId);
    expect(info.projectSlug).toBe(slug);
    expect(info.transcriptPath).toBe(path.join(projectsDir, slug, `${sessionId}.jsonl`));
    expect(info.transcriptSize).toBe(Buffer.byteLength(content));
    expect(info.transcriptMtime).toEqual(expect.any(Number));
  });

  it("returns null size/mtime when the transcript doesn't exist", async () => {
    const info = await getTranscriptInfo(projectsDir, "/tmp/nope", "missing-session");
    expect(info.transcriptSize).toBeNull();
    expect(info.transcriptMtime).toBeNull();
  });
});
