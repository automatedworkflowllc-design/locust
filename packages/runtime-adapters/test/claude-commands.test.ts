import { describe, expect, it } from "vitest";

import { CLAUDE_COMMANDS_REQUEST, readClaudeCommands } from "../src/claude-commands.js";
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
    // One line only, the SDK's handshake: never a message, so no turn and nothing spent (0.694).
    expect(claude.state.written).toEqual([CLAUDE_COMMANDS_REQUEST]);
    expect(JSON.parse(claude.state.written[0]!)).toEqual({ type: "control_request", request_id: "locust_commands", request: { subtype: "initialize" } });
    expect(claude.state.killed).toBe(true);
    expect(claude.state.cwd).toBe("C:/work/pebble");
  });

  it("hears the answer to initialize, as 2.1.292 gives it: nothing until asked, then its whole list (0.694)", async () => {
    const answer = `${JSON.stringify({ type: "control_response", response: { subtype: "success", request_id: "locust_commands",
      response: { commands: [{ name: "deep-research", description: "Deep research", argumentHint: "" }, { name: "review", description: "Review a pull request", argumentHint: "<pr>" }], agents: [] } } })}\n`;
    const claude = fakeClaude([answer]);
    const command = createClaudeCommandListCommand(EXECUTABLE, { workspacePath: "C:/work/pebble" });
    const commands = await readClaudeCommands({ spawn: claude.spawn, command, settleMs: 20 });
    expect(commands.map((entry) => entry.name)).toEqual(["deep-research", "review"]);
    expect(claude.state.killed).toBe(true);
  });

  it("passes on the models the same answer lists, as 2.1.293 gives them (0.697)", async () => {
    // Trimmed from the real answer, 2026-10-07: `haiku` had become Haiku 5.5.
    const answer = `${JSON.stringify({ type: "control_response", response: { subtype: "success", request_id: "locust_commands",
      response: { commands: [{ name: "review", description: "Review a pull request", argumentHint: "<pr>" }], models: [
        { value: "haiku", resolvedModel: "claude-haiku-5-5", displayName: "Haiku 5.5", description: "Fastest for quick answers", supportsEffort: true, supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"] },
        { value: "claude-haiku-4-5-20251001", resolvedModel: "claude-haiku-4-5-20251001", displayName: "Haiku 4.5", description: "Fastest for quick answers" },
        { value: "", displayName: "nothing to pass" },
        { value: "opus", displayName: "Opus 5.5", supportsEffort: false, supportedEffortLevels: ["low"] },
      ] } } })}\n`;
    const claude = fakeClaude([answer]);
    const told: unknown[] = [];
    const command = createClaudeCommandListCommand(EXECUTABLE, { workspacePath: "C:/work/pebble" });
    const commands = await readClaudeCommands({ spawn: claude.spawn, command, settleMs: 20, onModels: (models) => told.push(models) });
    expect(commands.map((entry) => entry.name)).toEqual(["review"]);
    expect(told).toEqual([[
      { value: "haiku", resolvedModel: "claude-haiku-5-5", displayName: "Haiku 5.5", efforts: ["low", "medium", "high", "xhigh", "max"] },
      { value: "claude-haiku-4-5-20251001", resolvedModel: "claude-haiku-4-5-20251001", displayName: "Haiku 4.5" },
      { value: "opus", resolvedModel: "opus", displayName: "Opus 5.5" },
    ]]);
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
