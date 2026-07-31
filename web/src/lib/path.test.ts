import { describe, expect, it } from "vitest";
import { shortenPath } from "./path";

describe("shortenPath", () => {
  it("collapses a deep home-relative path to ~/…/<last segment>", () => {
    expect(shortenPath("/Users/dev/code/work/projects/demo-app", "/Users/dev")).toBe(
      "~/…/demo-app",
    );
  });

  it("keeps a short home-relative path intact", () => {
    expect(shortenPath("/Users/dev/projects", "/Users/dev")).toBe("~/projects");
  });

  it("renders the home dir itself as ~", () => {
    expect(shortenPath("/Users/dev", "/Users/dev")).toBe("~");
  });

  it("collapses a deep non-home path the same way", () => {
    expect(shortenPath("/opt/build/deep/nested/project", "/Users/dev")).toBe("/…/project");
  });

  it("does not mistake a sibling dir with the same prefix for home", () => {
    // /Users/developer should not be treated as inside /Users/dev
    expect(shortenPath("/Users/developer/projects/thing", "/Users/dev")).toBe("/…/thing");
  });
});
