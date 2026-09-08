import { describe, expect, it } from "vitest";

import { createCopilotPromptCommand, parseEffortChoices } from "../src/commands.js";
import type { ExecutableLaunch } from "../src/commands.js";

/**
 * The effort levels a CLI offers must be the ones Locust offers.
 *
 * Colin, 2026-09-08: "make sure that the effort levels actually match the
 * levels for the associated models". They did not. Copilot names seven levels
 * in its own help; Locust read none of them and its command builder threw
 * "Copilot CLI takes no effort level", which was simply untrue.
 *
 * The help text below is verbatim from copilot 1.0.83 on this machine,
 * wrapping and quotes included -- that wrapping is exactly what the original
 * pattern could not read.
 */
const COPILOT_HELP = `
  --allow-all-tools                     Allow all tools without confirmation
  --effort, --reasoning-effort <level>  Set the reasoning effort level (choices:
                                        "none", "minimal", "low", "medium",
                                        "high", "xhigh", "max")
  --enable-all-github-mcp-tools         Enable all GitHub MCP server tools
`;

/** Claude writes the same fact a different way: bare words, one line. */
const CLAUDE_HELP = `
  --effort <level>  Effort level for the current session (low, medium, high)
`;

describe("reading the effort levels a CLI says it takes", () => {
  it("reads Copilot's seven, through the quotes and the line wraps", () => {
    // THE test. This exact string returned nothing before.
    expect(parseEffortChoices(COPILOT_HELP)).toEqual([
      "none",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
  });

  it("still reads the bare, single-line form", () => {
    expect(parseEffortChoices(CLAUDE_HELP)).toEqual(["low", "medium", "high"]);
  });

  it("invents nothing when a CLI names no levels", () => {
    // The control. A parser that guessed would put a level in the picker that
    // the runtime then refuses -- which is the failure this whole area keeps
    // producing, in both directions.
    expect(parseEffortChoices("--help\n  --model <name>  The model to use\n")).toEqual([]);
    expect(parseEffortChoices("")).toEqual([]);
  });
});

describe("what Copilot is actually sent", () => {
  const copilot: ExecutableLaunch = {
    commandName: "copilot",
    discoveredPath: "C:\\tools\\copilot.cmd",
    executablePath: "C:\\tools\\copilot.cmd",
    prefixArgs: []
  };
  const spec = (effort?: string) =>
    createCopilotPromptCommand(copilot, {
      workspacePath: "C:\\work",
      prompt: "Summarise this repository.",
      sandbox: "read-only",
      ...(effort === undefined ? {} : { effort })
    });

  it("passes the effort through as --effort", () => {
    // It used to throw. A runtime that takes a level and is never given one is
    // the same defect as a runtime that is given one it refuses.
    const args = spec("high").args;
    expect(args).toContain("--effort");
    expect(args[args.indexOf("--effort") + 1]).toBe("high");
  });

  it("sends no effort flag when none was chosen", () => {
    expect(spec().args).not.toContain("--effort");
  });
});
