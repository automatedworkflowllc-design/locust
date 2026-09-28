import { describe, expect, it } from "vitest";

import { readClaudeCommands } from "../src/claude-commands.js";
import type { AppServerRunProcess } from "../src/codex-app-server-run.js";
import { createClaudeCommandListCommand } from "../src/commands.js";

/*
 * Claude Code's commands before any run (0.428). The shape is 2.1.283's,
 * measured 2026-09-28 with stream-json input and nothing ever sent: two
 * `commands_changed` records inside about two seconds, then silence.
 */
const EXECUTABLE = { executablePath: "C:/tools/claude.exe", prefixArgs: [] as readonly string[] };
const listed = (names: readonly string[]) =>
  `${JSON.stringify({ type: "system", subtype: "commands_changed", commands: names.map((name) => ({ name, description: `the ${name} command`, argumentHint: "" })) })}\n`;

function fakeClaude(chunks: readonly string[]) {
  const state = { written: [] as string[], killed: false, cwd: undefined as string | undefined };
  const spawn = (_exe: string, _args: readonly string[], _env?: Readonly<Record<string, string>>, cwd?: string): AppServerRunProcess => {
    state.cwd = cwd;
    return {
      write: (line) => { state.written.push(line); },
      kill: () => { state.killed = true; },
      onData: (listener) => { chunks.forEach((chunk, index) => setTimeout(() => listener(chunk), index * 5)); },
      onExit: () => undefined,
    };
  };
  return { spawn, state };
}

describe("Claude Code's commands, before any run", () => {
  it("are the last list it announces, read without ever sending it a message, and it is then stopped", async () => {
    // Split mid-line, as a pipe delivers it.
    const second = listed(["compact", "init", "security-review"]);
    const claude = fakeClaude([listed(["compact"]), second.slice(0, 30), second.slice(30)]);
    const command = createClaudeCommandListCommand(EXECUTABLE, { workspacePath: "C:/work/pebble" });
    const commands = await readClaudeCommands({ spawn: claude.spawn, command, settleMs: 40 });
    expect(commands.map((entry) => entry.name)).toEqual(["compact", "init", "security-review"]);
    expect(claude.state.written).toEqual([]);
    expect(claude.state.killed).toBe(true);
    expect(claude.state.cwd).toBe("C:/work/pebble");
  });

  it("is started as every run outside Auto is, restricted, and leaves no session behind", () => {
    const command = createClaudeCommandListCommand(EXECUTABLE, { workspacePath: "C:/work/pebble" });
    expect(command.args).toEqual(["--restricted", "--print", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--no-session-persistence"]);
    expect(command.args).not.toContain("--dangerously-skip-permissions");
  });

  it("is a refusal, not an empty menu, when no list comes, and Claude Code is still stopped", async () => {
    const claude = fakeClaude([`${JSON.stringify({ type: "system", subtype: "init" })}\n`]);
    const command = createClaudeCommandListCommand(EXECUTABLE, { workspacePath: "C:/work/pebble" });
    await expect(readClaudeCommands({ spawn: claude.spawn, command, timeoutMs: 60 })).rejects.toThrow(/did not list/);
    expect(claude.state.killed).toBe(true);
  });
});
