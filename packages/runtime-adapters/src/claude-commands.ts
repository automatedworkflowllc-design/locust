import type { AppServerRunProcess } from "./codex-app-server-run.js";
import { runtimeCommandsFrom } from "./claude-events.js";
import type { RuntimeCommandInfo } from "./claude-events.js";
import type { RuntimeCommandSpec } from "./types.js";

/**
 * CLAUDE CODE'S COMMANDS, BEFORE ANY RUN (0.428).
 *
 * 0.426 learned them only from a run, so a person who updated and opened the
 * / menu saw Locust's own and nothing else (Colin, 2026-09-28: "am i doing
 * something wrong?" -- he was not). Claude Code announces its list at start
 * and waits for a message before it does anything else
 * (createClaudeCommandListCommand), so it is started, listened to, and
 * stopped: nothing is ever written to it. The list can arrive twice as
 * plugins load, so the last one is kept once it has been quiet a moment.
 */
export interface ClaudeCommandsOptions {
  readonly spawn: (
    executablePath: string,
    args: readonly string[],
    env?: Readonly<Record<string, string>>,
    cwd?: string,
  ) => AppServerRunProcess;
  /** `createClaudeCommandListCommand`'s spec for the folder. */
  readonly command: RuntimeCommandSpec;
  /** How long a list must stand before it is taken. */
  readonly settleMs?: number;
  readonly timeoutMs?: number;
}

export function readClaudeCommands(options: ClaudeCommandsOptions): Promise<readonly RuntimeCommandInfo[]> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let buffer = "";
    let latest: readonly RuntimeCommandInfo[] | undefined;
    let quiet: ReturnType<typeof setTimeout> | undefined;
    const child = options.spawn(options.command.executablePath, options.command.args, options.command.env, options.command.cwd);
    const end = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (quiet !== undefined) clearTimeout(quiet);
      try {
        child.kill();
      } catch {
        // Already gone.
      }
      if (latest !== undefined) resolve(latest);
      else reject(error ?? new Error("Claude Code did not list its commands."));
    };
    const timer = setTimeout(() => end(new Error("Claude Code did not list its commands in time.")), options.timeoutMs ?? 20_000);
    child.onExit(() => end(new Error("Claude Code exited before it listed its commands.")));
    child.onData((chunk) => {
      if (settled) return;
      buffer = `${buffer}${chunk}`;
      let at: number;
      while ((at = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, at).trim();
        buffer = buffer.slice(at + 1);
        if (line.length === 0) continue;
        let record: unknown;
        try {
          record = JSON.parse(line);
        } catch {
          continue;
        }
        if (typeof record !== "object" || record === null) continue;
        const { type, subtype, commands } = record as Record<string, unknown>;
        if (type !== "system" || subtype !== "commands_changed") continue;
        const listed = runtimeCommandsFrom(commands);
        if (listed.length === 0) continue;
        latest = listed;
        if (quiet !== undefined) clearTimeout(quiet);
        quiet = setTimeout(() => end(), options.settleMs ?? 1_500);
      }
      // A line that never ends is not a list.
      if (buffer.length > 2_000_000) end(new Error("Claude Code sent more than a command list."));
    });
  });
}
