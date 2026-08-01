import os from "node:os";
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

  it("defaults summarizer to ollama/qwen2.5:3b/127.0.0.1:11434 and a ~/.cache cache dir", () => {
    const config = loadConfig({});
    expect(config.summarizer.kind).toBe("ollama");
    expect(config.summarizer.model).toBe("qwen2.5:3b");
    expect(config.summarizer.url).toBe("http://127.0.0.1:11434");
    expect(config.summarizer.cacheDir).toBe(path.join(os.homedir(), ".cache", "claude-sessman"));
  });

  it("honours SESSMAN_SUMMARIZER / SESSMAN_OLLAMA_MODEL / SESSMAN_OLLAMA_URL / SESSMAN_CACHE_DIR overrides", () => {
    const config = loadConfig({
      SESSMAN_SUMMARIZER: "null",
      SESSMAN_OLLAMA_MODEL: "fixture-model",
      SESSMAN_OLLAMA_URL: "http://127.0.0.1:1234",
      SESSMAN_CACHE_DIR: "/tmp/fixture-cache",
    });
    expect(config.summarizer.kind).toBe("null");
    expect(config.summarizer.model).toBe("fixture-model");
    expect(config.summarizer.url).toBe("http://127.0.0.1:1234");
    expect(config.summarizer.cacheDir).toBe("/tmp/fixture-cache");
  });
});
