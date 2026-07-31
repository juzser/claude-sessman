import { describe, expect, it } from "vitest";
import { shortenPath } from "./path";

describe("shortenPath", () => {
  it("collapses a deep home-relative path to ~/…/<last segment>", () => {
    expect(shortenPath("/Users/ser/scatola/jobs/projects/agent-scatola", "/Users/ser")).toBe(
      "~/…/agent-scatola",
    );
  });

  it("keeps a short home-relative path intact", () => {
    expect(shortenPath("/Users/ser/projects", "/Users/ser")).toBe("~/projects");
  });

  it("renders the home dir itself as ~", () => {
    expect(shortenPath("/Users/ser", "/Users/ser")).toBe("~");
  });

  it("collapses a deep non-home path the same way", () => {
    expect(shortenPath("/opt/build/deep/nested/project", "/Users/ser")).toBe("/…/project");
  });

  it("does not mistake a sibling dir with the same prefix for home", () => {
    // /Users/serena should not be treated as inside /Users/ser
    expect(shortenPath("/Users/serena/projects/thing", "/Users/ser")).toBe("/…/thing");
  });
});
