import { describe, expect, it } from "vitest";

import { brieflyPut, namedTool, whyRefused, REFUSAL_DETAIL_LIMIT } from "../src/claude-events.js";

/**
 * A refusal has to be readable, which means it cannot be a program.
 *
 * Colin, 2026-09-10, sending a capture: the amber row carried a `cd` into a
 * long Windows path, `&&`, and an entire `python3 -c` program with embedded
 * JSON parsing -- eight wrapped lines, ending in the sentence that actually
 * mattered. The register is for something a person can act on, and the whole
 * command is already in the activity row and the receipt, where a command
 * belongs.
 */

/** A real newline, never typed inline: this file is about escaping. */
const NEWLINE = String.fromCharCode(10);

const LONG = [
  'cd "C:/Users/<home>/.claude/projects/C--Users-<home>--claude/335bab6b-6a87-4507-b0df/tool-results"',
  '&& python3 -c " import json',
  "for f in ['mcp-claude_ai_Robinhood-run_scan-1789017927582.txt']:",
  "  d = json.load(open(f, encoding='utf-8'))",
  '"'
].join(NEWLINE);

describe("what a refusal says", () => {
  it("keeps the first line and stops there", () => {
    const said = brieflyPut(LONG);
    expect(said.length).toBeLessThanOrEqual(REFUSAL_DETAIL_LIMIT + 3);
    expect(said).toContain("cd ");
    // Not the program. Not the second line at all.
    expect(said).not.toContain("python3");
    expect(said).not.toContain("json.load");
    expect(said).not.toContain(NEWLINE);
  });

  it("leaves an ordinary command exactly as it was", () => {
    for (const command of ["pnpm test", "git status", "node _tools/drive-room-many.mjs"]) {
      expect(brieflyPut(command)).toBe(command);
    }
  });

  it("never cuts a token in half when it can avoid it", () => {
    // A path or a flag broken mid-token reads as corruption rather than as a
    // truncation somebody chose.
    const words = `git commit -m ${"word ".repeat(60)}`;
    const said = brieflyPut(words);
    expect(said.endsWith("...")).toBe(true);
    expect(said.slice(0, -3).endsWith("word")).toBe(true);
  });

  it("still says something when the whole thing is one unbroken token", () => {
    const blob = "x".repeat(400);
    const said = brieflyPut(blob);
    expect(said.length).toBeLessThanOrEqual(REFUSAL_DETAIL_LIMIT + 3);
    expect(said.endsWith("...")).toBe(true);
  });

  it("names a connector the way the activity rows name it", () => {
    // `mcp__claude_ai_Robinhood__get_accounts` is a machine name and reads as
    // one; the rows already split it, and a sentence about the same call has
    // no business doing worse.
    expect(namedTool("mcp__claude_ai_Robinhood__get_accounts")).toBe("get_accounts on Robinhood");
    expect(namedTool("mcp__linear__create_issue")).toBe("create_issue on linear");
    // Anything that is not an MCP tool is left alone.
    expect(namedTool("Bash")).toBe("Bash");
  });

  it("gives a connector refusal a reason the person can act on", () => {
    const connectors = whyRefused([{ tool: "mcp__claude_ai_Robinhood__get_accounts" }]);
    expect(connectors).toContain("Give this teammate the connector, or run it in Auto.");
    // A command refusal keeps its own reason -- "commands" is the right word
    // there and the wrong one for a connector.
    expect(whyRefused([{ tool: "Bash" }])).toContain("before running commands");
    // Mixed: the command sentence, because it is the one that still applies.
    expect(whyRefused([{ tool: "Bash" }, { tool: "mcp__x__y" }])).toContain("before running commands");
  });
});
