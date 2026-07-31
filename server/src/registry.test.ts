import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readSessionRegistry } from "./registry.js";

describe("readSessionRegistry", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "sessman-registry-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("parses well-formed session files", async () => {
    await writeFile(
      path.join(dir, "111.json"),
      JSON.stringify({
        pid: 111,
        sessionId: "aaaa-bbbb",
        cwd: "/tmp/example-project",
        startedAt: 1700000000000,
        procStart: "Fri Jul 31 02:11:55 2026",
        version: "2.1.220",
        peerProtocol: 1,
        kind: "interactive",
        entrypoint: "cli",
        name: "my-session",
        status: "busy",
        updatedAt: 1700000005000,
        statusUpdatedAt: 1700000005000,
      }),
    );

    const records = await readSessionRegistry(dir);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      pid: 111,
      sessionId: "aaaa-bbbb",
      cwd: "/tmp/example-project",
      startedAt: 1700000000000,
      name: "my-session",
      status: "busy",
    });
  });

  it("defaults a missing name to null instead of throwing", async () => {
    await writeFile(
      path.join(dir, "222.json"),
      JSON.stringify({
        pid: 222,
        sessionId: "cccc-dddd",
        cwd: "/tmp/example-project-2",
        startedAt: 1700000000000,
        procStart: "Fri Jul 31 02:11:55 2026",
        status: "busy",
      }),
    );

    const records = await readSessionRegistry(dir);
    expect(records).toHaveLength(1);
    expect(records[0].name).toBeNull();
  });

  it("normalises a missing or non-string status to 'unknown' without crashing", async () => {
    await writeFile(
      path.join(dir, "333.json"),
      JSON.stringify({
        pid: 333,
        sessionId: "eeee-ffff",
        cwd: "/tmp/example-project-3",
        startedAt: 1700000000000,
      }),
    );
    await writeFile(
      path.join(dir, "334.json"),
      JSON.stringify({
        pid: 334,
        sessionId: "eeee-gggg",
        cwd: "/tmp/example-project-4",
        startedAt: 1700000000000,
        status: 42,
      }),
    );

    const records = await readSessionRegistry(dir);
    expect(records.map((r) => r.status).sort()).toEqual(["unknown", "unknown"]);
  });

  it("passes through any other status string unchanged (open string, not an enum)", async () => {
    await writeFile(
      path.join(dir, "335.json"),
      JSON.stringify({
        pid: 335,
        sessionId: "hhhh-iiii",
        cwd: "/tmp/example-project-5",
        startedAt: 1700000000000,
        status: "idle",
      }),
    );

    const records = await readSessionRegistry(dir);
    expect(records[0].status).toBe("idle");
  });

  it("skips malformed JSON instead of throwing", async () => {
    await writeFile(path.join(dir, "444.json"), "{not valid json");
    await writeFile(
      path.join(dir, "445.json"),
      JSON.stringify({
        pid: 445,
        sessionId: "valid-one",
        cwd: "/tmp/example-project-6",
        startedAt: 1700000000000,
        status: "busy",
      }),
    );

    const records = await readSessionRegistry(dir);
    expect(records).toHaveLength(1);
    expect(records[0].pid).toBe(445);
  });

  it("skips files missing required fields", async () => {
    await writeFile(
      path.join(dir, "446.json"),
      JSON.stringify({ sessionId: "no-pid-here", cwd: "/tmp/x", startedAt: 1700000000000 }),
    );
    await writeFile(
      path.join(dir, "447.json"),
      JSON.stringify({ pid: 447, cwd: "/tmp/x", startedAt: 1700000000000 }),
    );
    await writeFile(
      path.join(dir, "448.json"),
      JSON.stringify({ pid: 448, sessionId: "no-cwd", startedAt: 1700000000000 }),
    );
    await writeFile(
      path.join(dir, "449.json"),
      JSON.stringify({ pid: 449, sessionId: "no-startedat", cwd: "/tmp/x" }),
    );

    const records = await readSessionRegistry(dir);
    expect(records).toHaveLength(0);
  });

  it("ignores non-.json files in the directory", async () => {
    await writeFile(path.join(dir, "readme.txt"), "hello");
    await writeFile(path.join(dir, ".DS_Store"), "junk");

    const records = await readSessionRegistry(dir);
    expect(records).toHaveLength(0);
  });

  it("returns an empty array (not a throw) when the directory does not exist", async () => {
    const records = await readSessionRegistry(path.join(dir, "does-not-exist"));
    expect(records).toEqual([]);
  });

  it("defaults a malformed or missing procStart to null", async () => {
    await writeFile(
      path.join(dir, "555.json"),
      JSON.stringify({
        pid: 555,
        sessionId: "no-procstart",
        cwd: "/tmp/example-project-7",
        startedAt: 1700000000000,
        procStart: 12345,
      }),
    );

    const records = await readSessionRegistry(dir);
    expect(records[0].procStart).toBeNull();
  });
});
