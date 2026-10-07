import { describe, expect, it } from "vitest";

import { createOpenCodeRunCommand, createOpenCodeServeCommand, withoutOpenCodeQuestionTool } from "../src/commands.js";

/*
 * AN OPENCODE TEAMMATE ASKS THE WAY EVERY TEAMMATE ASKS (0.700).
 *
 * OpenCode offers its models a `question` tool whenever its client is `cli`,
 * which `serve` is. Called, it waits on a reply Locust never sends: drive-
 * needs-you's Wren read "Working…" for 11 minutes. Measured 2026-10-07 on
 * `opencode serve` 1.18.27 with the drive's own prompt: 3 of 3 asked through
 * the tool and were still waiting at 60-90 s; with it off, 3 of 3 finished in
 * 11-23 s, asking in their reply (Locust's question card).
 */
const EXECUTABLE = { executablePath: "C:/tools/opencode.exe", prefixArgs: [] as readonly string[] };
const toolsOf = (env: Readonly<Record<string, string>> | undefined): unknown => JSON.parse(env?.OPENCODE_CONFIG_CONTENT ?? "{}").tools;

describe("OpenCode's own question tool is off for every run Locust starts", () => {
  for (const sandbox of ["read-only", "workspace-write", "full-access"] as const) {
    it(`on the server, ${sandbox}`, () => {
      expect(toolsOf(createOpenCodeServeCommand(EXECUTABLE, { workspacePath: "C:/w", sandbox }).env)).toEqual({ question: false });
    });
    it(`on run, ${sandbox}`, () => {
      expect(toolsOf(createOpenCodeRunCommand(EXECUTABLE, { workspacePath: "C:/w", sandbox, prompt: "go" }).env)).toEqual({ question: false });
    });
  }

  it("in Approve each, which asks for everything else", () => {
    expect(toolsOf(createOpenCodeServeCommand(EXECUTABLE, { workspacePath: "C:/w" }).env)).toEqual({ question: false });
  });

  it("in a worktree, beside the repository it may reach", () => {
    const env = createOpenCodeServeCommand(EXECUTABLE, { workspacePath: "C:/w", sandbox: "workspace-write", repositoryRoot: "C:/repo" }).env;
    expect(toolsOf(env)).toEqual({ question: false });
    expect(JSON.parse(env?.OPENCODE_CONFIG_CONTENT ?? "{}").permission).toBeDefined();
  });

  it("keeps a chat-only model's tools off, every one of them", () => {
    expect(JSON.parse(withoutOpenCodeQuestionTool(JSON.stringify({ tools: { "*": false } }))).tools).toEqual({ "*": false, question: false });
  });

  it("starts a config when there was none", () => {
    expect(JSON.parse(withoutOpenCodeQuestionTool(undefined))).toEqual({ tools: { question: false } });
  });
});
