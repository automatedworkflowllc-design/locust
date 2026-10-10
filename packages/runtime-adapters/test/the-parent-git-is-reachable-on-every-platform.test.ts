import { describe, expect, it } from "vitest";

import { gitDirPattern, opencodeWorktreeConfig } from "../src/commands.js";

/**
 * An OpenCode run in a worktree may reach the parent repository's `.git`, and nothing else outside
 * its folder. The 2026-10-10 sweep: the pattern was written with backslashes on every platform, so
 * on a Mac it named no path and the one directory it exists for was denied.
 */
describe("the parent repository's .git, for a worktree run", () => {
  it("is spelled as the root is: backslashes on Windows, slashes elsewhere", () => {
    expect(gitDirPattern("C:\\work\\repo")).toBe("C:\\work\\repo\\.git\\*");
    expect(gitDirPattern("/home/u/repo")).toBe("/home/u/repo/.git/*");
    expect(gitDirPattern("/home/u/repo/")).toBe("/home/u/repo/.git/*");
  });

  it("is the one directory allowed outside the worktree", () => {
    const config = JSON.parse(opencodeWorktreeConfig("/home/u/repo", false));
    expect(config.permission.external_directory).toEqual({ "/home/u/repo/.git/*": "allow", "*": "deny" });
  });
});
