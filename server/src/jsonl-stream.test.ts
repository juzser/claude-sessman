import { mkdtemp, rm, writeFile, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { streamAppend } from "./jsonl-stream.js";

describe("streamAppend", () => {
  let dir: string;
  let filePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "sessman-jsonl-stream-"));
    filePath = path.join(dir, "synthetic.jsonl");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("calls onLine once per complete newline-terminated line and returns the consumed byte offset", async () => {
    await writeFile(filePath, 'line-one\nline-two\n', "utf8");

    const lines: string[] = [];
    const offset = await streamAppend(filePath, 0, (line) => lines.push(line));

    expect(lines).toEqual(["line-one", "line-two"]);
    expect(offset).toBe(Buffer.byteLength("line-one\nline-two\n", "utf8"));
  });

  it("leaves a half-written trailing line (no newline yet) unconsumed", async () => {
    await writeFile(filePath, 'complete-line\nhalf-writ', "utf8");

    const lines: string[] = [];
    const offset = await streamAppend(filePath, 0, (line) => lines.push(line));

    expect(lines).toEqual(["complete-line"]);
    expect(offset).toBe(Buffer.byteLength("complete-line\n", "utf8"));
  });

  it("never re-reads bytes already consumed by a prior call, and picks up a since-completed trailing line on the next call", async () => {
    await writeFile(filePath, 'first\nsecond-half', "utf8");

    const firstPass: string[] = [];
    const offsetAfterFirst = await streamAppend(filePath, 0, (line) => firstPass.push(line));
    expect(firstPass).toEqual(["first"]);

    await appendFile(filePath, "-completed\nthird\n", "utf8");

    const secondPass: string[] = [];
    const offsetAfterSecond = await streamAppend(filePath, offsetAfterFirst, (line) => secondPass.push(line));

    expect(secondPass).toEqual(["second-half-completed", "third"]);
    expect(offsetAfterSecond).toBeGreaterThan(offsetAfterFirst);
  });

  it("resolves 0 additional lines and the same offset when started exactly at end-of-file", async () => {
    await writeFile(filePath, "only-line\n", "utf8");
    const endOffset = Buffer.byteLength("only-line\n", "utf8");

    const lines: string[] = [];
    const offset = await streamAppend(filePath, endOffset, (line) => lines.push(line));

    expect(lines).toEqual([]);
    expect(offset).toBe(endOffset);
  });
});
