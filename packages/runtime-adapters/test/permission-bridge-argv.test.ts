import { describe, expect, it } from "vitest";

import { createClaudePrintCommand, createCodexExecCommand } from "../src/commands.js";
import type { ExecutableLaunch } from "../src/types.js";

/**
 * A Claude Code run outside Auto is given somewhere to ASK.
 *
 * MEASURED 2026-09-10 with a throwaway MCP server: `--mcp-config` naming it
 * plus `--permission-prompt-tool` naming its tool made a `--print` run under
 * `--restricted`, in the strictest mode, call the tool before using a
 * connector, wait, and honour the answer. Without those two flags the run has
 * nowhere to put the question and refuses the call.
 *
 * The flags are only as good as their values: a config path that is not on
 * the command line is a bridge that never starts, and that failure is silent
 * -- every connector call is simply refused, which is how 0.60.1 looked.
 */

const EXE: ExecutableLaunch = {
  commandName: "claude",
  discoveredPath: "C:\\tools\\claude.exe",
  executablePath: "C:\\tools\\claude.exe",
  prefixArgs: [],
  kind: "native",
};
const BRIDGE = { configPath: "C:\\Users\\<home>\\AppData\\Local\\Temp\\locust-permission-abc\\mcp.json", toolName: "mcp__locust__approve" };
const claude = (sandbox: "read-only" | "workspace-write" | "full-access", bridge?: typeof BRIDGE) =>
  createClaudePrintCommand(EXE, { workspacePath: "C:\\workspace", sandbox, ...(bridge === undefined ? {} : { permissionBridge: bridge }) }).args;

describe("the permission bridge on the command line", () => {
  it("is named, config and tool both, in every mode that asks", () => {
    for (const sandbox of ["read-only", "workspace-write"] as const) {
      const args = claude(sandbox, BRIDGE);
      const at = args.indexOf("--mcp-config");
      expect(at, sandbox).toBeGreaterThan(-1);
      expect(args[at + 1], sandbox).toBe(BRIDGE.configPath);
      const tool = args.indexOf("--permission-prompt-tool");
      expect(tool, sandbox).toBeGreaterThan(-1);
      expect(args[tool + 1], sandbox).toBe("mcp__locust__approve");
    }
  });

  it("is absent in Auto, which asks nothing", () => {
    // `bypassPermissions` never prompts, so a prompt tool there would be a
    // question nobody is asked. The CLI also refuses `--restricted` with it.
    const args = claude("full-access", BRIDGE).join(" ");
    expect(args).not.toContain("--mcp-config");
    expect(args).not.toContain("--permission-prompt-tool");
  });

  it("is absent when no bridge was registered, rather than naming a file that does not exist", () => {
    for (const sandbox of ["read-only", "workspace-write"] as const) {
      const args = claude(sandbox).join(" ");
      expect(args, sandbox).not.toContain("--mcp-config");
      expect(args, sandbox).not.toContain("--permission-prompt-tool");
    }
  });

  it("does not replace the connector allow rules; it comes after them", () => {
    // Colin's ruling stands: connectors the person has are allowed without
    // asking. The bridge is where a call goes that no rule covered.
    const args = createClaudePrintCommand(EXE, {
      workspacePath: "C:\\workspace",
      sandbox: "workspace-write",
      connectors: ["claude.ai Robinhood"],
      permissionBridge: BRIDGE,
    }).args;
    const rules = args.indexOf("--allowedTools");
    const bridge = args.indexOf("--mcp-config");
    expect(rules).toBeGreaterThan(-1);
    expect(bridge).toBeGreaterThan(rules);
  });

  it("is ignored by a runtime that has no such flags", () => {
    const codex = createCodexExecCommand({ ...EXE, commandName: "codex" }, {
      workspacePath: "C:\\workspace",
      sandbox: "workspace-write",
      permissionBridge: BRIDGE,
    }).args.join(" ");
    expect(codex).not.toContain("mcp-config");
    expect(codex).not.toContain("permission-prompt-tool");
  });

  it("refuses an empty config path rather than sending a flag with nothing after it", () => {
    expect(() => createClaudePrintCommand(EXE, { workspacePath: "C:\\workspace", sandbox: "workspace-write", permissionBridge: { configPath: "", toolName: "mcp__locust__approve" } })).toThrow();
  });
});
