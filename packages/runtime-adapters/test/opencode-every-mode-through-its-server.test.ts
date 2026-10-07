import { describe, expect, it } from "vitest";

import { OPENCODE_AUTO_CONFIG, OPENCODE_CONFINED_CONFIG, OPENCODE_READ_ONLY_CONFIG, createOpenCodeRunCommand, createOpenCodeServeCommand, withoutOpenCodeQuestionTool } from "../src/commands.js";
import type { AppServerRunProcess } from "../src/codex-app-server-run.js";
import { createOpenCodeEventNormalizer } from "../src/opencode-events.js";
import { startOpenCodeServeRun } from "../src/opencode-serve-run.js";

/*
 * EVERY OPENCODE MODE THROUGH ITS SERVER (0.677). Through `run` a reply reached Locust only once finished; through
 * the server it streams (`message.part.delta`). A mode must mean on the server exactly what it meant on `run`: the
 * same permission config and environment, and what OpenCode asks answered as `run` answered it -- Auto approves,
 * the others refuse.
 */
const EXECUTABLE = { executablePath: "C:/tools/opencode.exe", prefixArgs: [] as readonly string[] };
const SESSION = "ses_1";

function fakeServer(events: readonly object[]) {
  const calls: { url: string; body: unknown }[] = [];
  let prompted!: () => void;
  const promptSent = new Promise<void>((resolve) => { prompted = resolve; });
  const spawn = (): AppServerRunProcess => ({
    write: () => undefined,
    kill: () => undefined,
    onData: (listener) => { setTimeout(() => listener("opencode server listening on http://127.0.0.1:4096\n"), 0); },
    onExit: () => undefined,
  });
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: init?.body === undefined ? undefined : JSON.parse(String(init.body)) });
    if (url.endsWith("/event")) {
      const encoder = new TextEncoder();
      return new Response(new ReadableStream<Uint8Array>({
        async start(controller) {
          await promptSent;
          // As a server's turn takes a moment: an idle before the prompt's answer is read would be ignored.
          await new Promise((resolve) => setTimeout(resolve, 30));
          for (const event of events) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        },
      }), { status: 200 });
    }
    if (url.endsWith("/session")) return Response.json({ id: SESSION });
    if (url.endsWith("/prompt_async")) { prompted(); return new Response(null, { status: 204 }); }
    if (url.includes("/permission/")) return Response.json(true);
    return new Response(null, { status: 404 });
  }) as typeof fetch;
  return { spawn, fetcher, calls };
}

const message = (id: string, role: string) => ({ type: "message.updated", properties: { sessionID: SESSION, info: { id, role, sessionID: SESSION } } });
const part = (fields: Record<string, unknown>) => ({ type: "message.part.updated", properties: { sessionID: SESSION, part: { sessionID: SESSION, ...fields } } });
const delta = (partID: string, text: string) => ({ type: "message.part.delta", properties: { sessionID: SESSION, messageID: "msg_a", partID, field: "text", delta: text } });

describe("a reply through OpenCode's server", () => {
  it("streams from the server's deltas, and ends as exactly the finished text", async () => {
    const server = fakeServer([
      message("msg_a", "assistant"),
      part({ id: "s1", type: "step-start", messageID: "msg_a" }),
      // The model's reasoning streams the same way; it is not the reply.
      part({ id: "r1", type: "reasoning", messageID: "msg_a", text: "" }),
      delta("r1", "The user wants a story."),
      part({ id: "p1", type: "text", messageID: "msg_a", text: "" }),
      delta("p1", "The keeper"),
      delta("p1", " found a bottle"),
      part({ id: "p1", type: "text", messageID: "msg_a", text: "The keeper found a bottle.", time: { start: 1, end: 2 } }),
      part({ id: "s2", type: "step-finish", messageID: "msg_a", reason: "stop", tokens: { input: 1, output: 1 } }),
      { type: "session.idle", properties: { sessionID: SESSION } },
    ]);
    const run = startOpenCodeServeRun({ spawn: server.spawn, command: createOpenCodeServeCommand(EXECUTABLE, { workspacePath: "C:/work/pebble", sandbox: "read-only" }), prompt: "a story", fetch: server.fetcher });
    const normalizer = createOpenCodeEventNormalizer({ runId: "run_1", missionId: "mission_1", cliVersion: "1.18.27" });
    const said: string[] = [];
    let partials = 0;
    for await (const record of run.records) {
      if ((JSON.parse(record.raw) as { type: string }).type === "text_partial") partials += 1;
      for (const event of normalizer.accept(record)) {
        if (event.type !== "message.delta") continue;
        const payload = event.payload as { operation: string; text: string; final: boolean };
        said.push(`${payload.operation}${payload.final ? "!" : ""}:${payload.text}`);
      }
    }
    await run.completion;
    // At least one partial (the server's deltas come faster than PARTIAL_EVERY_MS here); never the reasoning.
    expect(partials).toBeGreaterThanOrEqual(1);
    expect(said.some((one) => one.includes("The user wants"))).toBe(false);
    expect(said.at(-1)).toBe("replace!:The keeper found a bottle.");
    expect(said.slice(0, -1).every((one) => one.startsWith("append:"))).toBe(true);
  });

  it("a step that ends before its text's finished form closes it with every word, none held back by the pace", async () => {
    const server = fakeServer([
      message("msg_a", "assistant"),
      part({ id: "p1", type: "text", messageID: "msg_a", text: "" }),
      delta("p1", "The keeper"),
      delta("p1", " found a bottle."),
      // The step's end before the part's own (time.end): OpenCode sends them in either order.
      part({ id: "s2", type: "step-finish", messageID: "msg_a", reason: "stop", tokens: { input: 1, output: 1 } }),
      part({ id: "p1", type: "text", messageID: "msg_a", text: "The keeper found a bottle.", time: { start: 1, end: 2 } }),
      { type: "session.idle", properties: { sessionID: SESSION } },
    ]);
    const run = startOpenCodeServeRun({ spawn: server.spawn, command: createOpenCodeServeCommand(EXECUTABLE, { workspacePath: "C:/w", sandbox: "read-only" }), prompt: "a story", fetch: server.fetcher });
    const normalizer = createOpenCodeEventNormalizer({ runId: "run_1", missionId: "mission_1", cliVersion: "1.18.27" });
    const closed: string[] = [];
    for await (const record of run.records) {
      for (const event of normalizer.accept(record)) {
        const payload = event.payload as { operation?: string; text?: string; final?: boolean };
        if (event.type === "message.delta" && payload.final === true) closed.push(payload.text ?? "");
      }
    }
    await run.completion;
    // The first close is already the whole of it.
    expect(closed[0]).toBe("The keeper found a bottle.");
  });

  it("names its session, so OpenCode does not spend a model call naming it", async () => {
    const server = fakeServer([{ type: "session.idle", properties: { sessionID: SESSION } }]);
    const run = startOpenCodeServeRun({ spawn: server.spawn, command: createOpenCodeServeCommand(EXECUTABLE, { workspacePath: "C:/w", sandbox: "workspace-write" }), prompt: "hi", fetch: server.fetcher });
    for await (const record of run.records) void record;
    await run.completion;
    expect(server.calls.find((call) => call.url.endsWith("/session"))?.body).toEqual({ title: "Locust" });
  });
});

describe("a mode on the server means what it meant on run", () => {
  for (const sandbox of ["read-only", "workspace-write", "full-access"] as const) {
    it(`${sandbox}: the same permission config and environment as run`, () => {
      const served = createOpenCodeServeCommand(EXECUTABLE, { workspacePath: "C:/w", sandbox });
      const ran = createOpenCodeRunCommand(EXECUTABLE, { workspacePath: "C:/w", sandbox, prompt: "hi" });
      expect(served.env).toEqual(ran.env);
      expect(served.sandbox).toBe(ran.sandbox);
    });
  }

  it("read-only is read-only, loads no plugins; workspace-write stays in the folder; Auto may leave it", () => {
    expect(createOpenCodeServeCommand(EXECUTABLE, { workspacePath: "C:/w", sandbox: "read-only" }).env).toEqual({ OPENCODE_CONFIG_CONTENT: withoutOpenCodeQuestionTool(OPENCODE_READ_ONLY_CONFIG), OPENCODE_PURE: "1" });
    expect(createOpenCodeServeCommand(EXECUTABLE, { workspacePath: "C:/w", sandbox: "workspace-write" }).env).toEqual({ OPENCODE_CONFIG_CONTENT: withoutOpenCodeQuestionTool(OPENCODE_CONFINED_CONFIG) });
    expect(createOpenCodeServeCommand(EXECUTABLE, { workspacePath: "C:/w", sandbox: "full-access" }).env).toEqual({ OPENCODE_CONFIG_CONTENT: withoutOpenCodeQuestionTool(OPENCODE_AUTO_CONFIG) });
  });

  const asks = async (approveAll: boolean) => {
    const server = fakeServer([
      { type: "permission.asked", properties: { sessionID: SESSION, id: "per_1", permission: "bash", patterns: ["ls"], always: [], metadata: {} } },
      { type: "session.idle", properties: { sessionID: SESSION } },
    ]);
    const run = startOpenCodeServeRun({ spawn: server.spawn, command: createOpenCodeServeCommand(EXECUTABLE, { workspacePath: "C:/w", sandbox: approveAll ? "full-access" : "read-only" }), prompt: "hi", fetch: server.fetcher, ...(approveAll ? { approveAll: true } : {}) });
    for await (const record of run.records) void record;
    await run.completion;
    await new Promise((resolve) => setTimeout(resolve, 50));
    return (server.calls.find((call) => call.url.includes("/permission/"))?.body as { reply?: string } | undefined)?.reply;
  };

  it("what OpenCode asks: Auto approves it, as run --auto did; any other mode refuses it, as run did", async () => {
    expect(await asks(true)).toBe("once");
    expect(await asks(false)).toBe("reject");
  });
});
