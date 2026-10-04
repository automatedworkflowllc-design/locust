import { describe, expect, it } from "vitest";

import { startCodexAppServerRun } from "../src/codex-app-server-run.js";
import type { AppServerRunProcess } from "../src/codex-app-server-run.js";
import { createCodexAppServerCommand } from "../src/commands.js";

/**
 * A2.10: SAFE-POINT DELIVERY, ON CODEX. A message that must not wait for the
 * end of a teammate's run used to be delivered only by stopping the run,
 * which discards the work in flight. Codex's app-server (0.156.1, measured
 * off `codex app-server generate-json-schema`) takes `turn/steer`: input
 * added to the turn that is running, with the running turn's id as a
 * precondition. `steer` sends it, and says whether it was taken.
 */
function fakeServer() {
  const written: Array<Record<string, unknown>> = [];
  let emit: (chunk: string) => void = () => undefined;
  const process: AppServerRunProcess = {
    write: (line) => {
      for (const part of line.split("\n")) if (part.trim().length > 0) written.push(JSON.parse(part) as Record<string, unknown>);
    },
    kill: () => undefined,
    onData: (listener) => {
      emit = listener;
    },
    onExit: () => undefined,
  };
  const last = (method: string) => [...written].reverse().find((message) => message.method === method);
  return {
    process,
    written,
    answer: (id: number, result: unknown) => emit(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`),
    fail: (id: number) => emit(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32600, message: "no active turn" } })}\n`),
    notify: (method: string, params: unknown) => emit(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`),
    idOf: (method: string) => last(method)?.id as number | undefined,
    paramsOf: (method: string) => last(method)?.params as Record<string, unknown> | undefined,
  };
}
const settle = async (): Promise<void> => {
  for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
};

async function running() {
  const server = fakeServer();
  const run = startCodexAppServerRun({
    spawn: () => server.process,
    command: createCodexAppServerCommand({ executablePath: "/usr/bin/codex", prefixArgs: [] }, { workspacePath: "/work", sandbox: "workspace-write" }),
    prompt: "count the files",
    sandbox: "workspace-write",
    approvalPolicy: "never",
  });
  await settle();
  server.answer(server.idOf("initialize")!, { userAgent: "codex" });
  await settle();
  server.answer(server.idOf("thread/start")!, { thread: { id: "thread_9" } });
  await settle();
  return { server, run };
}

describe("steering a running Codex turn", () => {
  it("sends turn/steer on the thread, with the running turn's id, and says it was taken", async () => {
    const { server, run } = await running();
    server.answer(server.idOf("turn/start")!, { turn: { id: "turn_1" } });
    await settle();
    const steered = run.steer("Stop editing app.ts: Wren is changing it.");
    await settle();
    expect(server.paramsOf("turn/steer")).toEqual({
      threadId: "thread_9",
      expectedTurnId: "turn_1",
      input: [{ type: "text", text: "Stop editing app.ts: Wren is changing it." }],
    });
    server.answer(server.idOf("turn/steer")!, { turnId: "turn_1" });
    expect(await steered).toBe(true);
  });

  it("learns the turn from turn/started as well", async () => {
    const { server, run } = await running();
    server.notify("turn/started", { threadId: "thread_9", turn: { id: "turn_7" } });
    await settle();
    void run.steer("heads up");
    await settle();
    expect(server.paramsOf("turn/steer")?.expectedTurnId).toBe("turn_7");
  });

  it("says no, without asking, before a turn has started", async () => {
    const { server, run } = await running();
    expect(await run.steer("too early")).toBe(false);
    expect(server.idOf("turn/steer")).toBeUndefined();
  });

  it("says no when the server refuses it -- the turn has just ended, say", async () => {
    const { server, run } = await running();
    server.answer(server.idOf("turn/start")!, { turn: { id: "turn_1" } });
    await settle();
    const steered = run.steer("late");
    await settle();
    server.fail(server.idOf("turn/steer")!);
    expect(await steered).toBe(false);
  });

  it("says no, without asking, once the turn is over", async () => {
    const { server, run } = await running();
    server.answer(server.idOf("turn/start")!, { turn: { id: "turn_1" } });
    await settle();
    server.notify("turn/completed", { threadId: "thread_9", turn: { id: "turn_1", status: "completed" } });
    await settle();
    expect(await run.steer("after")).toBe(false);
    expect(server.idOf("turn/steer")).toBeUndefined();
  });
});
