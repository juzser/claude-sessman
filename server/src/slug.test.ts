import { describe, expect, it } from "vitest";
import { cwdToSlug, transcriptPathFor } from "./slug.js";

describe("cwdToSlug", () => {
  it("replaces every / and . with -", () => {
    expect(cwdToSlug("/Users/ser/scatola/jobs/projects/agent-scatola")).toBe(
      "-Users-ser-scatola-jobs-projects-agent-scatola",
    );
  });

  it("handles nested worktree paths with dots", () => {
    expect(
      cwdToSlug(
        "/Users/ser/scatola/jobs/projects/agent-scatola/.claude/worktrees/feat-digest-formatting",
      ),
    ).toBe(
      "-Users-ser-scatola-jobs-projects-agent-scatola--claude-worktrees-feat-digest-formatting",
    );
  });
});

describe("transcriptPathFor", () => {
  it("joins the projects dir, slug and sessionId into a .jsonl path", () => {
    const path = transcriptPathFor({
      projectsDir: "/Users/ser/.claude/projects",
      cwd: "/Users/ser/scatola/jobs/projects/agent-scatola",
      sessionId: "6099492f-e939-43ed-80df-181d61e5a410",
    });
    expect(path).toBe(
      "/Users/ser/.claude/projects/-Users-ser-scatola-jobs-projects-agent-scatola/6099492f-e939-43ed-80df-181d61e5a410.jsonl",
    );
  });
});
