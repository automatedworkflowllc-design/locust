import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { agyUserLine } from "../src/process-runner.js";
import { assertSafeRuntimeCommand, createAgyEventNormalizer, createAgyPrintCommand, parseAgyModelList } from "../src/index.js";
import type { NormalizedRuntimeEvent } from "../src/codex-events.js";

/**
 * ANTIGRAVITY CLI (0.540). Every record below is a real `agy` 1.2.14 capture,
 * 2026-10-02, Gemini 3.8 Flash (Low), with the user name scrubbed and the
 * tool list shortened (test/fixtures/agy-2026-10-02/).
 */
const fixture = (name: string): string[] =>
  readFileSync(fileURLToPath(new URL(`./fixtures/agy-2026-10-02/${name}.jsonl`, import.meta.url)), "utf8").trim().split("\n");
const completion = (exitCode = 0) => ({
  exitCode, signal: null, stderr: "", stderrTruncated: false, recordCount: 0, inputDeliveryFailed: false,
  outputLimitExceeded: false, forcedTerminationAttempted: false, terminationUnconfirmed: false, cancelled: false,
  startedAt: "2026-10-02T00:00:00.000Z", finishedAt: "2026-10-02T00:00:10.000Z",
}) as never;
const run = (name: string, exitCode = 0) => {
  const normalizer = createAgyEventNormalizer({ runId: "run_1", missionId: "mission_1", now: () => new Date("2026-10-02T00:00:00Z") });
  const events: NormalizedRuntimeEvent[] = [];
  fixture(name).forEach((raw, index) => events.push(...normalizer.accept({ sequence: index + 1, raw } as never)));
  events.push(...normalizer.finish(completion(exitCode)));
  return { events, thread: normalizer.runtimeThreadId };
};
const payload = <T>(event: NormalizedRuntimeEvent | undefined): T => (event as unknown as { payload: T }).payload;
const types = (events: readonly NormalizedRuntimeEvent[]) => events.map((event) => event.type);

describe("Antigravity CLI's stream", () => {
  it("reads a file: one tool row, the answer whole, the conversation to carry on, and usage", () => {
    const { events, thread } = run("reads-a-file");
    expect(thread).toBe("c0da4624-b6cd-4e9e-9979-87b67b7abe60");
    const tools = events.filter((event) => event.type.startsWith("tool."));
    expect(types(tools)).toEqual(["tool.started", "tool.completed"]);
    expect(payload<{ name: string; command: string }>(tools[0])).toMatchObject({ name: "view_file", command: "C:/Users/person/Documents/locust-scratch/agy-probe/note.txt" });
    const final = events.filter((event) => event.type === "message.delta").at(-1);
    expect(payload<{ text: string; final: boolean; operation: string }>(final)).toMatchObject({ text: "hello from a file\nDONE\n", final: true, operation: "replace" });
    const done = events.at(-1)!;
    expect(done.type).toBe("run.completed");
    expect(payload<{ usage: unknown }>(done).usage).toEqual({ inputTokens: 20836, outputTokens: 173 });
  });

  it("a write in the default mode is refused, its row says so, and the person is told how to allow it", () => {
    const { events } = run("write-denied");
    expect(types(events.filter((event) => event.type.startsWith("tool.")))).toEqual(["tool.started", "tool.failed"]);
    const said = events.find((event) => event.type === "adapter.diagnostic");
    expect(payload<{ message: string; level: string }>(said)).toMatchObject({ level: "warning", message: "Antigravity was not allowed to change files in this mode. Choose Edit or Auto to let it." });
    expect(events.at(-1)!.type).toBe("run.completed");
  });

  it("in Edit, the file is written and the command refused, said as such", () => {
    const { events } = run("edit-then-command-denied");
    const tools = events.filter((event) => event.type.startsWith("tool."));
    expect(tools.map((event) => `${event.type}:${payload<{ name: string }>(event).name}`)).toEqual([
      "tool.started:write_to_file", "tool.completed:write_to_file", "tool.started:run_command", "tool.failed:run_command",
    ]);
    expect(payload<{ message: string }>(events.find((event) => event.type === "adapter.diagnostic")).message).toMatch(/^Antigravity was not allowed to run a command in this mode/);
  });

  it("an allowed command carries its command line and its output", () => {
    const { events } = run("command-allowed");
    const done = events.find((event) => event.type === "tool.completed");
    expect(payload<{ command: string; output: string }>(done)).toMatchObject({ command: "node -e \"console.log(40+2)\"", output: "42\n" });
  });

  it("an unknown model fails the run with agy's own reason, first line only", () => {
    const { events } = run("unknown-model", 1);
    const failed = events.at(-1)!;
    expect(failed.type).toBe("run.failed");
    expect(payload<{ message: string }>(failed).message).toBe("Antigravity could not run it: invalid model selection (--model \"no-such-model\" --effort \"\"): model no-such-model is not recognized as a known model or custom model in settings");
  });

  it("never records reasoning text: agy only counts it", () => {
    const { events } = run("reads-a-file");
    expect(JSON.stringify(events.map((event) => event.payload))).not.toMatch(/"thinking"|reasoning text/);
  });
});

describe("the agy command", () => {
  const launch = { executablePath: "C:\\Users\\a\\AppData\\Local\\agy\\bin\\agy.exe", prefixArgs: [] } as never;
  it("is print mode with the prompt on stdin, and each mode is the measured flag", () => {
    const ask = createAgyPrintCommand(launch, { workspacePath: "C:/work", sandbox: "read-only", model: "gemini-3.8-flash-low" });
    expect(ask.args).toEqual(["--output-format", "stream-json", "--input-format", "stream-json", "--model", "gemini-3.8-flash-low", "-p="]);
    expect(ask.stdin).toBe("agy-json");
    expect(createAgyPrintCommand(launch, { workspacePath: "C:/work", sandbox: "workspace-write" }).args).toContain("accept-edits");
    expect(createAgyPrintCommand(launch, { workspacePath: "C:/work", sandbox: "full-access" }).args).toContain("--dangerously-skip-permissions");
    expect(createAgyPrintCommand(launch, { workspacePath: "C:/work", sandbox: "workspace-write" }).args).not.toContain("--dangerously-skip-permissions");
    expect(createAgyPrintCommand(launch, { workspacePath: "C:/work", resumeThreadId: "c0da" }).args).toEqual(expect.arrayContaining(["--conversation", "c0da"]));
  });

  it("allows everything only under full access, and the flag stays banned for every other runtime", () => {
    const spec = createAgyPrintCommand(launch, { workspacePath: "C:/work", sandbox: "full-access" });
    expect(() => assertSafeRuntimeCommand({ ...spec, sandbox: "workspace-write" })).toThrow(/Forbidden runtime argument/);
    expect(() => assertSafeRuntimeCommand({ ...spec, runtime: "claude" }, "full-access")).toThrow(/Forbidden runtime argument/);
  });

  it("sends the prompt in the one input shape agy accepted", () => {
    expect(JSON.parse(agyUserLine("Fix it"))).toEqual({ event: "user", message: { role: "user", content: [{ type: "text", text: "Fix it" }] } });
  });

  it("reads agy models as printed", () => {
    const listed = parseAgyModelList("Fetching available models...\ngemini-3.8-flash-high\tGemini 3.8 Flash (High)\ngemini-3.1-pro-low\tGemini 3.1 Pro (Low)\nclaude-opus-4-6-thinking\tClaude Opus 4.6 (Thinking)\n");
    expect(listed?.models).toEqual([
      { id: "gemini-3.8-flash-high", displayName: "Gemini 3.8 Flash (High)" },
      { id: "gemini-3.1-pro-low", displayName: "Gemini 3.1 Pro (Low)" },
      { id: "claude-opus-4-6-thinking", displayName: "Claude Opus 4.6 (Thinking)" },
    ]);
  });
});
