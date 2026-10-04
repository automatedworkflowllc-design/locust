import { describe, expect, it } from "vitest";

import { createClaudePrintCommand, createOpenCodeRunCommand } from "../src/commands.js";

/**
 * A QUESTION ON THE SIDE FORKS THE SESSION (0.461).
 *
 * Devin's side chats: ask about a conversation without interrupting it. Each
 * runtime can continue a COPY of a session, leaving the session itself as it
 * was -- measured on OpenCode's free model 2026-09-29: the fork answered from
 * the earlier turns and the original never held the question. Only with a
 * session to fork: a flag with nothing to resume would be a new session that
 * claims to be a copy.
 */
const EXECUTABLE = { executablePath: "C:/tools/x.exe", prefixArgs: [] as readonly string[], kind: "native" as const };

describe("a question on the side", () => {
  it("forks a Claude Code session: --resume, then --fork-session", () => {
    const args = createClaudePrintCommand({ ...EXECUTABLE, commandName: "claude" }, { workspacePath: "C:/work", resumeThreadId: "sess-1", forkSession: true }).args;
    expect(args.slice(args.indexOf("--resume"), args.indexOf("--resume") + 3)).toEqual(["--resume", "sess-1", "--fork-session"]);
  });

  it("forks an OpenCode session: -s, then --fork", () => {
    const args = createOpenCodeRunCommand({ ...EXECUTABLE, commandName: "opencode" }, { workspacePath: "C:/work", prompt: "why?", resumeThreadId: "ses_1", forkSession: true }).args;
    expect(args.slice(args.indexOf("-s"), args.indexOf("-s") + 3)).toEqual(["-s", "ses_1", "--fork"]);
  });

  it("adds no fork flag without a session, or to an ordinary follow-up", () => {
    const fresh = createClaudePrintCommand({ ...EXECUTABLE, commandName: "claude" }, { workspacePath: "C:/work", forkSession: true }).args;
    expect(fresh).not.toContain("--fork-session");
    const reply = createOpenCodeRunCommand({ ...EXECUTABLE, commandName: "opencode" }, { workspacePath: "C:/work", prompt: "and?", resumeThreadId: "ses_1" }).args;
    expect(reply).not.toContain("--fork");
  });
});
