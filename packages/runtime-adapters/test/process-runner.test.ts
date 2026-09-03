import { EventEmitter } from "node:events";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createNodeRuntimeProcessRunner,
} from "../src/index.js";
import type {
  RuntimeJsonlRecord,
  RuntimeSpawn,
  RuntimeSpawnOptions,
  SpawnedRuntimeProcess,
} from "../src/index.js";

const prompt = "private mission prompt";
const spec = {
  runtime: "codex",
  executablePath: resolve("fake-runtime"),
  args: ["exec", "--json", "--sandbox", "read-only", "-"],
  cwd: resolve("fake-workspace"),
  stdin: "prompt",
  stdout: "jsonl",
} as const;

interface FakeChild {
  readonly process: SpawnedRuntimeProcess;
  readonly stdout: EventEmitter;
  readonly stderr: EventEmitter;
  readonly stdin: EventEmitter & {
    readonly writes: string[];
    ended: boolean;
  };
  readonly signals: NodeJS.Signals[];
  close(exitCode: number | null, signal?: NodeJS.Signals | null): void;
  fail(error: Error): void;
}

function fakeChild(options: {
  readonly writeError?: Error;
  readonly killResult?: boolean;
  readonly onKill?: (signal: NodeJS.Signals, child: FakeChild) => void;
} = {}): FakeChild {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const stdin = new EventEmitter() as FakeChild["stdin"];
  Object.assign(stdin, { writes: [] as string[], ended: false });
  const process = new EventEmitter() as EventEmitter & SpawnedRuntimeProcess;
  const signals: NodeJS.Signals[] = [];
  const child = {
    process,
    stdout,
    stderr,
    stdin,
    signals,
    close(exitCode: number | null, signal: NodeJS.Signals | null = null) {
      process.emit("close", exitCode, signal);
    },
    fail(error: Error) {
      process.emit("error", error);
    },
  } satisfies FakeChild;

  Object.assign(stdin, {
    write(value: string, callback?: (error?: Error | null) => void) {
      stdin.writes.push(value);
      callback?.(options.writeError);
      return true;
    },
    end() {
      stdin.ended = true;
    },
  });
  Object.assign(process, {
    stdin,
    stdout,
    stderr,
    kill(signal: NodeJS.Signals = "SIGTERM") {
      signals.push(signal);
      options.onKill?.(signal, child);
      return options.killResult ?? true;
    },
  });
  return child;
}

async function collect(records: AsyncIterable<RuntimeJsonlRecord>) {
  const collected: RuntimeJsonlRecord[] = [];
  for await (const record of records) collected.push(record);
  return collected;
}

describe("controlled runtime JSONL process runner", () => {
  it("uses the validated argv and cwd, sends the prompt only to stdin, and streams raw records", async () => {
    const child = fakeChild();
    let launched:
      | {
        readonly executablePath: string;
        readonly args: readonly string[];
        readonly options: RuntimeSpawnOptions;
      }
      | undefined;
    const spawnProcess: RuntimeSpawn = (executablePath, args, options) => {
      launched = { executablePath, args, options };
      return child.process;
    };
    const runner = createNodeRuntimeProcessRunner({
      environment: {
        PATH: "C:\\tools",
        USERPROFILE: "C:\\Users\\tester",
        CODEX_HOME: "C:\\runtime-state\\codex",
        ANTHROPIC_API_KEY: "must-not-leak",
        CUSTOM_SECRET: "must-not-leak",
      },
      spawnProcess,
      now: () => new Date("2026-08-31T12:00:00.000Z"),
    });

    const run = runner.start(spec, prompt);
    const emoji = Buffer.from("🙂");
    child.stdout.emit("data", Buffer.concat([Buffer.from('{"one":"'), emoji.subarray(0, 2)]));
    child.stdout.emit("data", Buffer.concat([emoji.subarray(2), Buffer.from('"}\r\n\n{"two":2}') ]));
    child.close(0);

    await expect(collect(run.records)).resolves.toEqual([
      { sequence: 1, raw: '{"one":"🙂"}' },
      { sequence: 2, raw: '{"two":2}' },
    ]);
    await expect(run.completion).resolves.toMatchObject({
      exitCode: 0,
      signal: null,
      recordCount: 2,
      cancelled: false,
      forcedTerminationAttempted: false,
      terminationUnconfirmed: false,
      inputDeliveryFailed: false,
      outputLimitExceeded: false,
      startedAt: "2026-08-31T12:00:00.000Z",
      finishedAt: "2026-08-31T12:00:00.000Z",
    });
    expect(child.stdin.writes).toEqual([prompt]);
    expect(child.stdin.ended).toBe(true);
    expect(launched).toMatchObject({
      executablePath: spec.executablePath,
      args: spec.args,
      options: {
        cwd: spec.cwd,
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          PATH: "C:\\tools",
          USERPROFILE: "C:\\Users\\tester",
          CODEX_HOME: "C:\\runtime-state\\codex",
        },
      },
    });
    expect(launched?.args).not.toContain(prompt);
    expect(launched?.options.env).not.toHaveProperty("ANTHROPIC_API_KEY");
    expect(launched?.options.env).not.toHaveProperty("CUSTOM_SECRET");
  });

  it("bounds captured stderr and reports truncation", async () => {
    const child = fakeChild();
    const runner = createNodeRuntimeProcessRunner({
      maxStderrBytes: 5,
      spawnProcess: () => child.process,
    });
    const run = runner.start(spec, prompt);
    child.stderr.emit("data", "abcdefgh");
    child.close(2);

    await expect(run.completion).resolves.toMatchObject({
      exitCode: 2,
      stderr: "abcde",
      stderrTruncated: true,
    });
  });

  it("redacts the prompt from captured stderr", async () => {
    const child = fakeChild();
    const runner = createNodeRuntimeProcessRunner({ spawnProcess: () => child.process });
    const run = runner.start(spec, prompt);
    child.stderr.emit("data", `provider echoed: ${prompt}`);
    child.close(1);

    const completion = await run.completion;
    expect(completion.stderr).toBe("provider echoed: [prompt redacted]");
    expect(completion.stderr).not.toContain(prompt);
  });

  it("cancels gracefully with SIGINT when the child acknowledges it", async () => {
    const controller = new AbortController();
    const child = fakeChild({
      onKill: (signal, target) => {
        if (signal === "SIGINT") queueMicrotask(() => target.close(null, "SIGINT"));
      },
    });
    const runner = createNodeRuntimeProcessRunner({
      cancellationGraceMs: 5,
      spawnProcess: () => child.process,
    });
    const run = runner.start(spec, prompt, { signal: controller.signal });
    controller.abort();

    await expect(run.completion).resolves.toMatchObject({
      signal: "SIGINT",
      cancelled: true,
      forcedTerminationAttempted: false,
    });
    expect(child.signals).toEqual(["SIGINT"]);
  });

  it("forces termination after the cancellation grace period and never retries", async () => {
    const controller = new AbortController();
    const child = fakeChild();
    let spawnCount = 0;
    const runner = createNodeRuntimeProcessRunner({
      cancellationGraceMs: 5,
      terminationConfirmationMs: 5,
      spawnProcess: () => {
        spawnCount += 1;
        return child.process;
      },
    });
    const run = runner.start(spec, prompt, { signal: controller.signal });
    controller.abort();

    await expect(run.completion).resolves.toMatchObject({
      exitCode: null,
      signal: null,
      cancelled: true,
      forcedTerminationAttempted: true,
      terminationUnconfirmed: true,
    });
    expect(child.signals).toEqual(["SIGINT", "SIGKILL"]);
    expect(spawnCount).toBe(1);
  });

  it("waits for close after a forced signal even when kill returns false", async () => {
    const controller = new AbortController();
    const child = fakeChild({ killResult: false });
    const runner = createNodeRuntimeProcessRunner({
      cancellationGraceMs: 5,
      terminationConfirmationMs: 100,
      spawnProcess: () => child.process,
    });
    const run = runner.start(spec, prompt, { signal: controller.signal });
    let completed = false;
    void run.completion.then(() => {
      completed = true;
    });
    controller.abort();
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 15));

    expect(child.signals).toEqual(["SIGINT", "SIGKILL"]);
    expect(completed).toBe(false);
    child.close(null, "SIGKILL");
    await expect(run.completion).resolves.toMatchObject({
      signal: "SIGKILL",
      forcedTerminationAttempted: true,
      terminationUnconfirmed: false,
    });
  });

  it("rejects an oversized JSONL record and terminates without exposing its content", async () => {
    const child = fakeChild({
      onKill: (signal, target) => {
        if (signal === "SIGINT") queueMicrotask(() => target.close(null, "SIGINT"));
      },
    });
    const runner = createNodeRuntimeProcessRunner({
      maxRecordBytes: 8,
      spawnProcess: () => child.process,
    });
    const run = runner.start(spec, prompt);
    const firstRecord = run.records[Symbol.asyncIterator]().next();
    child.stdout.emit("data", `${prompt}\n`);

    await expect(firstRecord).rejects.toThrow(
      "Runtime JSONL output exceeded its safety limit",
    );
    await expect(run.completion).resolves.toMatchObject({
      outputLimitExceeded: true,
      recordCount: 0,
      cancelled: false,
    });
    await firstRecord.catch((error: unknown) => {
      expect(String(error)).not.toContain(prompt);
    });
    expect(child.signals).toEqual(["SIGINT"]);
  });

  it("bounds queued records when a consumer falls behind", async () => {
    const child = fakeChild({
      onKill: (signal, target) => {
        if (signal === "SIGINT") queueMicrotask(() => target.close(null, "SIGINT"));
      },
    });
    const runner = createNodeRuntimeProcessRunner({
      maxQueuedRecords: 1,
      spawnProcess: () => child.process,
    });
    const run = runner.start(spec, prompt);
    child.stdout.emit("data", '{"one":1}\n{"two":2}\n');
    const iterator = run.records[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { sequence: 1, raw: '{"one":1}' },
    });
    await expect(iterator.next()).rejects.toThrow(
      "Runtime JSONL output exceeded its safety limit",
    );
    await expect(run.completion).resolves.toMatchObject({
      outputLimitExceeded: true,
      recordCount: 1,
    });
  });

  it("does not launch when the AbortSignal is already aborted", () => {
    const controller = new AbortController();
    controller.abort();
    const spawnProcess = vi.fn<RuntimeSpawn>();
    const runner = createNodeRuntimeProcessRunner({ spawnProcess });

    expect(() => runner.start(spec, prompt, { signal: controller.signal })).toThrow(
      "Runtime process was cancelled before launch",
    );
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it("sanitizes command-validation errors even when the prompt matches an unsafe argument", () => {
    const unsafePrompt = "--full-auto";
    const spawnProcess = vi.fn<RuntimeSpawn>();
    const runner = createNodeRuntimeProcessRunner({ spawnProcess });

    expect(() => runner.start({ ...spec, args: [unsafePrompt] }, unsafePrompt)).toThrow(
      "Runtime command failed safety validation",
    );
    try {
      runner.start({ ...spec, args: [unsafePrompt] }, unsafePrompt);
    } catch (error) {
      expect(String(error)).not.toContain(unsafePrompt);
    }
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it("sanitizes asynchronous launch errors and does not retry", async () => {
    const child = fakeChild();
    let spawnCount = 0;
    const runner = createNodeRuntimeProcessRunner({
      spawnProcess: () => {
        spawnCount += 1;
        return child.process;
      },
    });
    const run = runner.start(spec, prompt);
    const firstRecord = run.records[Symbol.asyncIterator]().next();
    child.fail(new Error(`launch failed while handling ${prompt}`));

    await expect(run.completion).rejects.toThrow("Runtime process failed to start");
    await expect(firstRecord).rejects.toThrow("Runtime process failed to start");
    await run.completion.catch((error: unknown) => {
      expect(String(error)).not.toContain(prompt);
    });
    expect(spawnCount).toBe(1);
  });

  it("sanitizes synchronous spawn errors", () => {
    const runner = createNodeRuntimeProcessRunner({
      spawnProcess: () => {
        throw new Error(`cannot launch ${prompt}`);
      },
    });

    expect(() => runner.start(spec, prompt)).toThrow("Runtime process failed to start");
    try {
      runner.start(spec, prompt);
    } catch (error) {
      expect(String(error)).not.toContain(prompt);
    }
  });

  it("marks stdin delivery failure without treating it as user cancellation", async () => {
    const child = fakeChild({ writeError: new Error(`write failed: ${prompt}`) });
    const runner = createNodeRuntimeProcessRunner({
      cancellationGraceMs: 5,
      terminationConfirmationMs: 5,
      spawnProcess: () => child.process,
    });
    const run = runner.start(spec, prompt);

    await expect(run.completion).resolves.toMatchObject({
      cancelled: false,
      forcedTerminationAttempted: true,
      terminationUnconfirmed: true,
      inputDeliveryFailed: true,
    });
    expect(child.signals).toEqual(["SIGINT", "SIGKILL"]);
  });

  it("writes nothing to stdin for a runtime whose prompt is already in its argv", async () => {
    // OpenCode and Copilot CLI take the prompt as a positional. Writing it a
    // second time would put it where the CLI is not reading, and some CLIs
    // treat anything on stdin as further input.
    const child = fakeChild();
    const runner = createNodeRuntimeProcessRunner({
      environment: { PATH: "C:\\tools" },
      spawnProcess: () => child.process,
    });

    const run = runner.start(
      { ...spec, runtime: "opencode", args: ["run", "--format", "json", prompt], stdin: "none" },
      prompt,
    );
    child.close(0);
    await run.completion;

    expect(child.stdin.writes).toEqual([]);
    expect(child.stdin.ended).toBe(true);
  });

  it("puts a spec's own variables on top of the allowlist, where nothing on the machine can undo them", async () => {
    // OpenCode's read-only permission config arrives this way and is the only
    // thing holding that runtime back. Two things have to hold: a machine that
    // exported the same name does not get a say (it is not on the allowlist,
    // so it never reaches the child), and where a name IS on the allowlist the
    // spec's value still wins.
    const child = fakeChild();
    let launched: RuntimeSpawnOptions | undefined;
    const runner = createNodeRuntimeProcessRunner({
      environment: { PATH: "C:\\tools", NO_COLOR: "0", OPENCODE_CONFIG_CONTENT: "{}" },
      spawnProcess: (_executablePath, _args, options) => {
        launched = options;
        return child.process;
      },
    });

    const run = runner.start(
      {
        ...spec,
        runtime: "opencode",
        args: ["run", "--format", "json", prompt],
        stdin: "none",
        env: { OPENCODE_CONFIG_CONTENT: '{"permission":{"write":"deny"}}', NO_COLOR: "1" },
      },
      prompt,
    );
    child.close(0);
    await run.completion;

    expect(launched?.env).toMatchObject({
      PATH: "C:\\tools",
      NO_COLOR: "1",
      OPENCODE_CONFIG_CONTENT: '{"permission":{"write":"deny"}}',
    });
  });
});
