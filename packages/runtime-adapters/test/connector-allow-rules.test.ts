import { describe, expect, it } from "vitest";

import { createClaudePrintCommand, createCodexExecCommand } from "../src/commands.js";
import type { ExecutableLaunch } from "../src/types.js";

/**
 * A connector a teammate was given reaches its argv as a named allow rule.
 *
 * Without one the tool is offered and every call prompts; a printed run has
 * nowhere to put that question, so it is denied and the row reads `failed`.
 * That was measured by driving the built app in Ask on 2026-09-09. The rule
 * is the whole difference between a connector a teammate can use and one it
 * can only fail at.
 *
 * The shape is not ours to choose. MEASURED the same day:
 *
 *   --allowedTools "mcp__claude_ai_Robinhood__*"   accepted
 *   --allowedTools "mcp__*"                        refused, with "An allow
 *     pattern must name the scope it widens -- globs are permitted only in
 *     the tool position after a literal mcp__<server>__ prefix."
 */

const EXE: ExecutableLaunch = {
  commandName: "claude",
  discoveredPath: "C:\tools\claude.exe",
  executablePath: "C:\tools\claude.exe",
  prefixArgs: [],
  kind: "native",
};
const claude = (sandbox: "read-only" | "workspace-write" | "full-access", connectors?: readonly string[]) =>
  createClaudePrintCommand(EXE, {
    workspacePath: "C:\workspace",
    sandbox,
    ...(connectors === undefined ? {} : { connectors }),
  }).args.join(" ");

describe("the connectors a teammate was given", () => {
  it("become one named allow rule each", () => {
    const args = claude("workspace-write", ["claude.ai Robinhood", "claude.ai Gmail"]);
    expect(args).toContain("--allowedTools mcp__claude_ai_Robinhood__*,mcp__claude_ai_Gmail__*");
  });

  it("are absent entirely when none were given", () => {
    // The default has to stay "asks, and therefore cannot". A teammate that
    // was given nothing must not be handed anything.
    for (const sandbox of ["read-only", "workspace-write"] as const) {
      expect(claude(sandbox)).not.toContain("--allowedTools");
      expect(claude(sandbox, [])).not.toContain("--allowedTools");
    }
  });

  it("name one connector and not its neighbours", () => {
    const args = claude("read-only", ["claude.ai Robinhood"]);
    expect(args).toContain("mcp__claude_ai_Robinhood__*");
    // Giving a teammate Robinhood is not giving it the mailbox.
    expect(args).not.toContain("Gmail");
    expect(args).not.toContain("--allowedTools mcp__*");
  });

  it("are not sent in Auto, where nothing is asked in the first place", () => {
    // `bypassPermissions` already asks nothing, so a rule there would be a
    // second and weaker statement of the same thing.
    expect(claude("full-access", ["claude.ai Robinhood"])).not.toContain("--allowedTools");
  });

  it("never widen a scope nobody chose", () => {
    // A name that sanitises to nothing yields `mcp____*`, which the CLI
    // ACCEPTS -- it is not the bare `mcp__*` it refuses -- so failing closed
    // is the only safe answer. Nothing reaches the argv.
    const args = claude("workspace-write", ["", "   ", "!!!"]);
    expect(args).not.toContain("--allowedTools");
    expect(args).not.toContain("mcp____");
  });

  it("are ignored by every runtime that has no such flag", () => {
    const codex = createCodexExecCommand({ ...EXE, commandName: "codex" }, {
      workspacePath: "C:\workspace",
      sandbox: "workspace-write",
      connectors: ["claude.ai Robinhood"],
    }).args.join(" ");
    expect(codex).not.toContain("allowedTools");
    expect(codex).not.toContain("mcp__");
  });
})
