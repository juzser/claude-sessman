import { mkdtemp, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import type { AppConfig } from "./config.js";
import { startServer, type RunningServer } from "./server.js";

interface SessionsMessage {
  type: "sessions";
  data: Array<{ sessionId: string }>;
}

function waitForMessage(ws: WebSocket): Promise<SessionsMessage> {
  return new Promise((resolve, reject) => {
    ws.once("message", (raw) => {
      try {
        resolve(JSON.parse(raw.toString()) as SessionsMessage);
      } catch (err) {
        reject(err);
      }
    });
    ws.once("error", reject);
  });
}

describe("startServer (integration)", () => {
  let sessionsDir: string;
  let projectsDir: string;
  let running: RunningServer;
  let baseUrl: string;
  let wsUrl: string;

  beforeEach(async () => {
    sessionsDir = await mkdtemp(path.join(tmpdir(), "sessman-server-sessions-"));
    projectsDir = await mkdtemp(path.join(tmpdir(), "sessman-server-projects-"));

    const config: AppConfig = {
      sessionsDir,
      projectsDir,
      host: "127.0.0.1",
      port: 0,
    };

    running = startServer(config);
    await new Promise<void>((resolve) => running.httpServer.once("listening", resolve));
    const address = running.httpServer.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
    wsUrl = `ws://127.0.0.1:${address.port}/ws`;
  });

  afterEach(async () => {
    await running.close();
    await rm(sessionsDir, { recursive: true, force: true });
    await rm(projectsDir, { recursive: true, force: true });
  });

  it("serves /api/health and /api/sessions over real HTTP", async () => {
    const healthRes = await fetch(`${baseUrl}/api/health`);
    const healthBody = (await healthRes.json()) as { ok: boolean; home: string };
    expect(healthBody.ok).toBe(true);
    expect(typeof healthBody.home).toBe("string");

    const sessionsRes = await fetch(`${baseUrl}/api/sessions`);
    expect(await sessionsRes.json()).toEqual({ sessions: [] });
  });

  it("pushes the current session list to a newly-connected WS client", async () => {
    await writeFile(
      path.join(sessionsDir, "alive.json"),
      JSON.stringify({
        pid: process.pid,
        sessionId: "ws-initial-session",
        cwd: "/tmp/ws-initial-cwd",
        startedAt: Date.now(),
        status: "busy",
      }),
    );

    const ws = new WebSocket(wsUrl);
    try {
      await new Promise<void>((resolve, reject) => {
        ws.once("open", () => resolve());
        ws.once("error", reject);
      });
      const message = await waitForMessage(ws);
      expect(message.type).toBe("sessions");
      expect(message.data.map((s) => s.sessionId)).toEqual(["ws-initial-session"]);
    } finally {
      ws.close();
    }
  });

  it("broadcasts an updated session list once a new registry file appears (watcher)", async () => {
    const ws = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    // Drain the initial (empty) push.
    await waitForMessage(ws);

    await writeFile(
      path.join(sessionsDir, "new.json"),
      JSON.stringify({
        pid: process.pid,
        sessionId: "watcher-triggered-session",
        cwd: "/tmp/watcher-cwd",
        startedAt: Date.now(),
        status: "busy",
      }),
    );

    const message = await Promise.race([
      waitForMessage(ws),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timed out waiting for watcher broadcast")), 5000),
      ),
    ]);
    expect(message.data.map((s) => s.sessionId)).toEqual(["watcher-triggered-session"]);
    ws.close();
  });
});
