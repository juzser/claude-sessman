import { describe, expect, it } from "vitest";
import { cwdToSlug, transcriptPathFor } from "./slug.js";

describe("cwdToSlug", () => {
  it("replaces every / and . with -", () => {
    expect(cwdToSlug("/Users/dev/code/work/projects/demo-app")).toBe(
      "-Users-dev-code-work-projects-demo-app",
    );
  });

  it("handles nested worktree paths with dots", () => {
    expect(
      cwdToSlug(
        "/Users/dev/code/work/projects/demo-app/.claude/worktrees/feat-example",
      ),
    ).toBe(
      "-Users-dev-code-work-projects-demo-app--claude-worktrees-feat-example",
    );
  });
});

describe("transcriptPathFor", () => {
  it("joins the projects dir, slug and sessionId into a .jsonl path", () => {
    const path = transcriptPathFor({
      projectsDir: "/Users/dev/.claude/projects",
      cwd: "/Users/dev/code/work/projects/demo-app",
      sessionId: "9f7c1a2b-0d34-4e56-8a90-1b2c3d4e5f60",
    });
    expect(path).toBe(
      "/Users/dev/.claude/projects/-Users-dev-code-work-projects-demo-app/9f7c1a2b-0d34-4e56-8a90-1b2c3d4e5f60.jsonl",
    );
  });
});
