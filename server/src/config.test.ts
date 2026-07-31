import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("defaults to ~/.claude/sessions, ~/.claude/projects, 127.0.0.1:5178", () => {
    const config = loadConfig({});
    expect(config.sessionsDir.endsWith(path.join(".claude", "sessions"))).toBe(true);
    expect(config.projectsDir.endsWith(path.join(".claude", "projects"))).toBe(true);
    expect(config.host).toBe("127.0.0.1");
    expect(config.port).toBe(5178);
  });

  it("honours SESSMAN_CLAUDE_DIR / SESSMAN_CLAUDE_PROJECTS_DIR / SESSMAN_HOST / SESSMAN_PORT overrides", () => {
    const config = loadConfig({
      SESSMAN_CLAUDE_DIR: "/tmp/fixture-sessions",
      SESSMAN_CLAUDE_PROJECTS_DIR: "/tmp/fixture-projects",
      SESSMAN_HOST: "0.0.0.0",
      SESSMAN_PORT: "9999",
    });
    expect(config.sessionsDir).toBe("/tmp/fixture-sessions");
    expect(config.projectsDir).toBe("/tmp/fixture-projects");
    expect(config.host).toBe("0.0.0.0");
    expect(config.port).toBe(9999);
  });
});
