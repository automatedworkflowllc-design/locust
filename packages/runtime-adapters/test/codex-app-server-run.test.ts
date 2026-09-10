import { describe, expect, it } from "vitest";

import {
  asProcessNormalizer,
  startCodexAppServerRun,
} from "../src/codex-app-server-run.js";
import type { AppServerRunProcess } from "../src/codex-app-server-run.js";
import { codexAppServerPolicy, createCodexAppServerCommand } from "../src/commands.js";
import { createAppServerEventNormalizer } from "../src/app-server-events.js";
import type { RuntimeJsonlRecord } from "../src/process-runner.js";

const EXECUTABLE = {
  executablePath: "/usr/bin/codex",
  prefixArgs: [] as readonly string[],
};

/** A fake `codex app-server`: it records what it was told and answers on cue. */
function fakeServer() {
  const written: Array<Record<string, unknown>> = [];
  let emit: (chunk: string) => void = () => undefined;
  let exited: () => void = () => undefined;
  let killed = false;
  const process: AppServerRunProcess = {
    write: (line) => {
      for (const part of line.split("\n")) {
        if (part.trim().length === 0) continue;
        written.push(JSON.parse(part) as Record<string, unknown>);
      }
    },
    kill: () => {
      killed = true;
    },
    onData: (listener) => {
      emit = listener;
    },
    onExit: (listener) => {
      exited = listener;
    },
  };
  return {
    process,
    written,
    get killed() {
      return killed;
    },
    /** Answer the request with this id, the way the real server does. */
    answer: (id: number, result: unknown) =>
      emit(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`),
    notify: (method: string, params: unknown) =>
      emit(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`),
    exit: () => exited(),
    /** The id of the first request with this method, or undefined. */
    idOf: (method: string) => {
      const found = written.find((message) => message.method === method);
      return typeof found?.id === "number" ? found.id : undefined;
    },
    paramsOf: (method: string) =>
      written.find((message) => message.method === method)?.params as
        | Record<string, unknown>
        | undefined,
  };
}

const settle = async (): Promise<void> => {
  for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
};

async function handshaken(overrides: Record<string, unknown> = {}) {
  const server = fakeServer();
  const run = startCodexAppServerRun({
    spawn: () => server.process,
    command: createCodexAppServerCommand(EXECUTABLE, {
      workspacePath: "/work",
      sandbox: "workspace-write",
    }),
    prompt: "count the files",
    sandbox: "workspace-write",
    approvalPolicy: "never",
    ...overrides,
  });
  await settle();
  server.answer(server.idOf("initialize")!, { userAgent: "codex" });
  await settle();
  server.answer(server.idOf("thread/start") ?? server.idOf("thread/resume")!, {
    thread: { id: "thread_9" },
  });
  await settle();
  server.answer(server.idOf("turn/start")!, { turn: { id: "turn_1" } });
  await settle();
  return { server, run };
}

describe("the policy a Codex thread is started with", () => {
  it("asks for danger-full-access only when the mission really has full access", () => {
    expect(codexAppServerPolicy("full-access")).toEqual({
      sandbox: "danger-full-access",
      approvalPolicy: "never",
    });
    expect(codexAppServerPolicy("workspace-write").sandbox).toBe("workspace-write");
    expect(codexAppServerPolicy("read-only").sandbox).toBe("read-only");
    // The dangerous value can only come from the one sandbox that means it.
    // A mission with no sandbox at all reads as read-only, never wider.
    expect(codexAppServerPolicy(undefined).sandbox).toBe("read-only");
  });

  it("never asks anything, because the exec transport it replaces never could", () => {
    for (const sandbox of ["read-only", "workspace-write", "full-access"] as const) {
      expect(codexAppServerPolicy(sandbox).approvalPolicy).toBe("never");
    }
  });
});

describe("the command that launches it", () => {
  it("is `codex app-server`, with the prompt in neither argv nor stdin", () => {
    const command = createCodexAppServerCommand(EXECUTABLE, {
      workspacePath: "/work",
      sandbox: "workspace-write",
    });
    expect(command.args).toEqual(["app-server"]);
    expect(command.stdin).toBe("protocol");
    expect(command.sandbox).toBe("workspace-write");
    expect(command.cwd).toBe("/work");
  });
});

describe("a turn over app-server", () => {
  it("hands the folder, the policy, the model and the prompt to the right calls", async () => {
    const { server } = await handshaken({ model: "gpt-5.6-luna", effort: "low" });
    expect(server.paramsOf("thread/start")).toMatchObject({
      cwd: "/work",
      sandbox: "workspace-write",
      approvalPolicy: "never",
    });
    expect(server.paramsOf("turn/start")).toMatchObject({
      threadId: "thread_9",
      model: "gpt-5.6-luna",
      effort: "low",
      input: [{ type: "text", text: "count the files" }],
    });
  });

  it("resumes a prior thread rather than starting one, which is what keeps a follow-up warm", async () => {
    const { server } = await handshaken({ resumeThreadId: "thread_earlier" });
    expect(server.idOf("thread/start")).toBeUndefined();
    expect(server.paramsOf("thread/resume")).toMatchObject({
      threadId: "thread_earlier",
      cwd: "/work",
    });
  });

  it("streams every notification as a record and ends when the turn does", async () => {
    const { server, run } = await handshaken();
    server.notify("item/agentMessage/delta", { itemId: "m1", delta: "Cach" });
    server.notify("item/agentMessage/delta", { itemId: "m1", delta: "ing" });
    server.notify("turn/completed", { threadId: "thread_9" });

    const seen: RuntimeJsonlRecord[] = [];
    for await (const record of run.records) seen.push(record);
    expect(seen).toHaveLength(3);
    expect(JSON.parse(seen[0]!.raw)).toMatchObject({
      method: "item/agentMessage/delta",
      params: { delta: "Cach" },
    });

    const completion = await run.completion;
    expect(completion.exitCode).toBe(0);
    expect(completion.cancelled).toBe(false);
    expect(completion.recordCount).toBe(3);
    // The server is not left running once its turn is over.
    expect(server.killed).toBe(true);
  });

  it("reports a server that dies mid-turn as a lost transport, not a clean finish", async () => {
    const { server, run } = await handshaken();
    server.notify("item/agentMessage/delta", { itemId: "m1", delta: "half a th" });
    server.exit();
    const completion = await run.completion;
    expect(completion.exitCode).toBeNull();
    expect(completion.cancelled).toBe(false);
    expect(completion.stderr).toContain("exited");
  });

  it("ends the run when the mission is cancelled", async () => {
    const controller = new AbortController();
    const { run } = await handshaken({ signal: controller.signal });
    controller.abort();
    const completion = await run.completion;
    expect(completion.cancelled).toBe(true);
    expect(completion.exitCode).toBeNull();
  });

  it("gives up rather than hanging when the server never answers the handshake", async () => {
    const server = fakeServer();
    const run = startCodexAppServerRun({
      spawn: () => server.process,
      command: createCodexAppServerCommand(EXECUTABLE, {
        workspacePath: "/work",
        sandbox: "read-only",
      }),
      prompt: "hello",
      sandbox: "read-only",
      approvalPolicy: "never",
      handshakeTimeoutMs: 1,
    });
    const completion = await run.completion;
    expect(completion.exitCode).toBeNull();
    expect(completion.stderr).toContain("did not answer");
  });
});

describe("the app-server normalizer, worn as a process normalizer", () => {
  const normalizerFor = () =>
    asProcessNormalizer(
      createAppServerEventNormalizer({ runId: "run_1", missionId: "mission_1", runtime: "codex" }),
    );

  it("turns a record back into the notification it was written from", () => {
    const normalizer = normalizerFor();
    const events = normalizer.accept({
      sequence: 1,
      raw: JSON.stringify({
        method: "item/agentMessage/delta",
        params: { itemId: "m1", delta: "Caching" },
      }),
    });
    expect(events.some((event) => event.type === "message.delta")).toBe(true);
  });

  it("drops a line that is not a notification instead of guessing at it", () => {
    const normalizer = normalizerFor();
    expect(normalizer.accept({ sequence: 1, raw: "not json" })).toEqual([]);
    expect(normalizer.accept({ sequence: 2, raw: JSON.stringify({ id: 4 }) })).toEqual([]);
  });

  it("reads a cancelled completion as cancelled and anything else as a lost transport", () => {
    const receipt = {
      exitCode: null,
      signal: null,
      stderr: "",
      stderrTruncated: false,
      recordCount: 0,
      forcedTerminationAttempted: false,
      terminationUnconfirmed: false,
      inputDeliveryFailed: false,
      outputLimitExceeded: false,
      oversizedRecordsDropped: 0,
      startedAt: "2026-09-10T00:00:00.000Z",
      finishedAt: "2026-09-10T00:00:01.000Z",
    };
    expect(
      normalizerFor().finish({ ...receipt, cancelled: true })[0]?.type,
    ).toBe("run.cancelled");
    expect(
      normalizerFor().finish({ ...receipt, cancelled: false })[0]?.type,
    ).toBe("run.failed");
  });
});

describe("what a run over this transport cost", () => {
  it("reports the tokens the thread counted, in the vocabulary every receipt uses", () => {
    const normalizer = asProcessNormalizer(
      createAppServerEventNormalizer({ runId: "run_1", missionId: "mission_1", runtime: "codex" }),
    );
    const line = (method: string, params: unknown): RuntimeJsonlRecord => ({
      sequence: 1,
      raw: JSON.stringify({ method, params }),
    });
    normalizer.accept(
      line("thread/tokenUsage/updated", {
        threadId: "t1",
        tokenUsage: {
          // `last` is one turn; `total` is the run, and the run is what the
          // receipt is for.
          last: { inputTokens: 5, outputTokens: 1 },
          total: {
            totalTokens: 19_394,
            inputTokens: 19_389,
            cachedInputTokens: 11_008,
            cacheWriteInputTokens: 0,
            outputTokens: 5,
          },
        },
      }),
    );
    const [completed] = normalizer.accept(line("turn/completed", { threadId: "t1" }));
    expect(completed?.type).toBe("run.completed");
    expect((completed?.payload as { usage?: unknown }).usage).toMatchObject({
      inputTokens: 19_389,
      outputTokens: 5,
      cacheReadTokens: 11_008,
    });
  });

  it("says nothing about cost when the thread never counted, rather than claiming zero", () => {
    const normalizer = asProcessNormalizer(
      createAppServerEventNormalizer({ runId: "run_2", missionId: "mission_2", runtime: "codex" }),
    );
    const [completed] = normalizer.accept({
      sequence: 1,
      raw: JSON.stringify({ method: "turn/completed", params: { threadId: "t1" } }),
    });
    expect((completed?.payload as { usage?: unknown }).usage).toBeUndefined();
  });
});
