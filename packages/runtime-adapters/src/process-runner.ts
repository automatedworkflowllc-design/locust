import { spawnShape } from "./cmd-line.js";
import { execFile, execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { assertSafeRuntimeCommand, PROMPT_FILE_PLACEHOLDER } from "./commands.js";

/**
 * The transports this runner knows how to honour. `protocol` is absent on
 * purpose: that spec is a server to be spoken to, and running it as an
 * ordinary process would start something nobody is listening to.
 */
const ACCEPTED_TRANSPORTS: ReadonlySet<string> = new Set(["prompt", "none", "prompt-file"]);

/**
 * Remove the prompt file, whatever happened to the run.
 *
 * Never throws: a temp file that cannot be deleted is a housekeeping problem,
 * and letting it take down a run that has already produced an answer would
 * turn a small leak into a lost mission.
 */
function discardPromptFile(directory: string | undefined): void {
  if (directory === undefined) return;
  try {
    rmSync(directory, { recursive: true, force: true });
  } catch {
    // Left for the OS to sweep with the rest of its temp directory.
  }
}
import type { RuntimeCommandSpec } from "./types.js";

interface RuntimeReadable {
  on(event: "data", listener: (chunk: Uint8Array | string) => void): unknown;
}

interface RuntimeWritable {
  write(
    chunk: string,
    callback?: (error?: Error | null) => void,
  ): boolean;
  end(callback?: () => void): unknown;
  once(event: "error", listener: (error: Error) => void): unknown;
}

export interface SpawnedRuntimeProcess {
  /**
   * The OS process id, when there is one. A test's fake process has none, so
   * the tree kill below is a no-op for it rather than something a fake has to
   * remember to opt out of.
   */
  readonly pid?: number;
  readonly stdin: RuntimeWritable;
  readonly stdout: RuntimeReadable;
  readonly stderr: RuntimeReadable;
  once(event: "error", listener: (error: Error) => void): unknown;
  once(
    event: "close",
    listener: (exitCode: number | null, signal: NodeJS.Signals | null) => void,
  ): unknown;
  kill(signal?: NodeJS.Signals): boolean;
}

export interface RuntimeSpawnOptions {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly shell: false;
  readonly windowsHide: true;
  readonly stdio: ["pipe", "pipe", "pipe"];
}

export type RuntimeSpawn = (
  executablePath: string,
  args: readonly string[],
  options: RuntimeSpawnOptions,
) => SpawnedRuntimeProcess;

export interface RuntimeJsonlRecord {
  /** Transport sequence only; normalized mission-event sequencing happens later. */
  readonly sequence: number;
  /** One raw, non-empty JSONL record without its line terminator. */
  readonly raw: string;
}

export interface RuntimeProcessCompletion {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stderr: string;
  readonly stderrTruncated: boolean;
  readonly recordCount: number;
  readonly cancelled: boolean;
  /** True when the runner sent SIGKILL after the graceful window elapsed. */
  readonly forcedTerminationAttempted: boolean;
  /** True only when the final watchdog elapsed without a child `close` event. */
  readonly terminationUnconfirmed: boolean;
  readonly inputDeliveryFailed: boolean;
  readonly outputLimitExceeded: boolean;
  /**
   * How many single records were too large to carry, and were skipped.
   *
   * Skipping one is survivable and killing the run for it is not, so these are
   * counted rather than fatal. See `exceedOutputLimit` for the whole argument.
   */
  readonly oversizedRecordsDropped: number;
  readonly startedAt: string;
  readonly finishedAt: string;
}

/**
 * A single-consumer stream of raw JSONL records that can also be drained
 * without awaiting, so a consumer doing slow per-batch work does not back the
 * queue up into an output-limit breach.
 */
export interface RuntimeProcessRecordStream extends AsyncIterable<RuntimeJsonlRecord> {
  drainAvailable(): readonly RuntimeJsonlRecord[];
}

export interface RuntimeProcessRun {
  readonly records: RuntimeProcessRecordStream;
  /** Settles on confirmed close or with `terminationUnconfirmed` after the watchdog. */
  readonly completion: Promise<RuntimeProcessCompletion>;
}

export interface RuntimeProcessStartOptions {
  readonly signal?: AbortSignal;
}

export interface NodeRuntimeProcessRunnerOptions {
  readonly maxStderrBytes?: number;
  readonly maxRecordBytes?: number;
  readonly maxQueuedRecords?: number;
  readonly cancellationGraceMs?: number;
  readonly terminationConfirmationMs?: number;
  /** Source values are filtered through the documented allowlist below. */
  readonly environment?: Readonly<NodeJS.ProcessEnv>;
  /** Test seam; production callers should leave this undefined. */
  readonly spawnProcess?: RuntimeSpawn;
  /** Test seam for deterministic completion timestamps. */
  readonly now?: () => Date;
}

export interface RuntimeProcessRunner {
  start(
    spec: RuntimeCommandSpec,
    prompt: string,
    options?: RuntimeProcessStartOptions,
  ): RuntimeProcessRun;
}

/**
 * Child processes inherit only values required for executable resolution,
 * account-home discovery, temporary files, locale, proxies, and TLS roots.
 * Provider keys, arbitrary app variables, Electron state, and product secrets
 * are deliberately not inherited. Runtime-specific credentials remain in the
 * installed CLI's own credential store and are never read by this package.
 */
export const RUNTIME_ENVIRONMENT_ALLOWLIST = [
  "APPDATA",
  "CLAUDE_CONFIG_DIR",
  "COMSPEC",
  "CODEX_HOME",
  "HOME",
  "HOMEDRIVE",
  "HOMEPATH",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "LANG",
  "LC_ALL",
  "LOCALAPPDATA",
  "LOGNAME",
  "NODE_EXTRA_CA_CERTS",
  "NO_COLOR",
  // H1: no bare name is found in a run's working folder (no-planted-executables.ts).
  "NODEFAULTCURRENTDIRECTORYINEXEPATH",
  "NO_PROXY",
  "PATH",
  "PATHEXT",
  "SHELL",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  "SYSTEMROOT",
  "TEMP",
  "TMP",
  "TMPDIR",
  "USER",
  "USERNAME",
  "USERPROFILE",
  "WINDIR",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
] as const;

const ALLOWED_ENVIRONMENT_KEYS = new Set<string>(RUNTIME_ENVIRONMENT_ALLOWLIST);

class AsyncRecordQueue implements RuntimeProcessRecordStream, AsyncIterableIterator<RuntimeJsonlRecord> {
  private readonly queued: RuntimeJsonlRecord[] = [];
  private readonly waiting: Array<{
    readonly resolve: (result: IteratorResult<RuntimeJsonlRecord>) => void;
    readonly reject: (error: Error) => void;
  }> = [];
  private ended = false;
  private failure: Error | undefined;

  constructor(private readonly maximumQueuedRecords: number) {}

  [Symbol.asyncIterator](): AsyncIterableIterator<RuntimeJsonlRecord> {
    return this;
  }

  next(): Promise<IteratorResult<RuntimeJsonlRecord>> {
    const record = this.queued.shift();
    if (record !== undefined) {
      return Promise.resolve({ done: false, value: record });
    }
    if (this.failure !== undefined) return Promise.reject(this.failure);
    if (this.ended) return Promise.resolve({ done: true, value: undefined });
    return new Promise((resolve, reject) => this.waiting.push({ resolve, reject }));
  }

  push(record: RuntimeJsonlRecord): boolean {
    if (this.ended || this.failure !== undefined) return false;
    const waiter = this.waiting.shift();
    if (waiter !== undefined) {
      waiter.resolve({ done: false, value: record });
      return true;
    }
    if (this.queued.length >= this.maximumQueuedRecords) return false;
    this.queued.push(record);
    return true;
  }

  /**
   * Records already buffered, taken without awaiting more.
   *
   * This exists so a consumer that must do slow work per batch -- an fsync,
   * say -- can collapse a burst into one unit instead of one per record.
   * Without it the queue fills at its cap while the consumer is awaiting,
   * and a full queue ends the run as an output-limit breach: a verbose
   * mission would be killed for being verbose.
   */
  drainAvailable(): readonly RuntimeJsonlRecord[] {
    return this.queued.splice(0);
  }

  close(): void {
    if (this.ended || this.failure !== undefined) return;
    this.ended = true;
    for (const waiter of this.waiting.splice(0)) {
      waiter.resolve({ done: true, value: undefined });
    }
  }

  fail(error: Error): void {
    if (this.ended || this.failure !== undefined) return;
    this.failure = error;
    for (const waiter of this.waiting.splice(0)) waiter.reject(error);
  }
}

interface BoundedStderr {
  readonly chunks: Uint8Array[];
  keptBytes: number;
  totalBytes: number;
}

function positiveInteger(value: number | undefined, fallback: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return resolved;
}

function appendBounded(
  output: BoundedStderr,
  chunk: Uint8Array | string,
  limit: number,
): void {
  const bytes = typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk);
  output.totalBytes += bytes.byteLength;
  const remaining = limit - output.keptBytes;
  if (remaining <= 0) return;
  const kept = bytes.subarray(0, remaining);
  output.chunks.push(kept);
  output.keptBytes += kept.byteLength;
}

function redactPrompt(value: string, prompt: string): string {
  if (!prompt || !value.includes(prompt)) return value;
  return value.split(prompt).join("[prompt redacted]");
}

function safeTransportError(message: string): Error {
  return new Error(message);
}

function abortBeforeLaunchError(): Error {
  const error = new Error("Runtime process was cancelled before launch");
  error.name = "AbortError";
  return error;
}

function minimalEnvironment(source: Readonly<NodeJS.ProcessEnv>): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && ALLOWED_ENVIRONMENT_KEYS.has(key.toUpperCase())) {
      environment[key] = value;
    }
  }
  return environment;
}

const defaultSpawn: RuntimeSpawn = (executablePath, args, options) =>
  spawn(executablePath, args, options) as unknown as SpawnedRuntimeProcess;

/**
 * Starts one already-validated command specification exactly once. The prompt
 * is sent through stdin and is never appended to argv or included in runner
 * errors. This transport splits stdout into raw JSONL records only; provider
 * schema parsing belongs in the Codex/Claude adapters above this boundary.
 */
/**
 * Where Windows keeps `taskkill`. Resolved absolutely: a bare command name is
 * searched for in the application directory and the working directory first,
 * so a planted `taskkill.exe` would run in this process's own context.
 */
export function windowsTaskkillPath(): string {
  const root = process.env.SystemRoot ?? process.env.SYSTEMROOT ?? "C:\\Windows";
  return `${root}\\System32\\taskkill.exe`;
}

/** Kill a process and everything it started. Windows needs help with this. */
export function killProcessTree(pid: number | undefined): void {
  if (process.platform !== "win32" || pid === undefined) return;
  try {
    // Hidden, or a console window flashes on every Stop (L2).
    execFileSync(windowsTaskkillPath(), ["/F", "/T", "/PID", String(pid)], { stdio: "ignore", windowsHide: true });
  } catch {
    // Best effort. `child.kill` still runs, and the completion path does not
    // depend on either of them succeeding.
  }
}

/**
 * The same tree kill, without holding the caller while taskkill walks it.
 *
 * MEASURED 2026-09-22 on this machine: a synchronous `taskkill /F /T` holds
 * the calling thread about 79 ms for a two-process tree, and still 75 ms when
 * the tree is already gone. The app-server kill ran it twice at the end of
 * every Codex turn and every model probe -- about 155 ms with the main
 * process answering nothing.
 *
 * Only for a caller that sends NO other signal afterwards. `killProcessTree`
 * stays synchronous for the stop path, where `child.kill` follows at once and
 * a parent that dies first leaves `/T` no tree to walk (measured 2026-09-14).
 * Resolves `true` when taskkill reported success, so a caller can fall back
 * to its own kill when it did not.
 */
export function releaseProcessTree(pid: number | undefined): Promise<boolean> {
  if (process.platform !== "win32" || pid === undefined) return Promise.resolve(false);
  return new Promise((resolve) => {
    try {
      execFile(windowsTaskkillPath(), ["/F", "/T", "/PID", String(pid)], { windowsHide: true }, (error) => resolve(error === null));
    } catch {
      resolve(false);
    }
  });
}

export function createNodeRuntimeProcessRunner(
  options: NodeRuntimeProcessRunnerOptions = {},
): RuntimeProcessRunner {
  const maxStderrBytes = positiveInteger(
    options.maxStderrBytes,
    64 * 1024,
    "maxStderrBytes",
  );
  const maxRecordBytes = positiveInteger(
    options.maxRecordBytes,
    256 * 1024,
    "maxRecordBytes",
  );
  /*
   * How many records may sit unread before the run is stopped.
   *
   * This was 64, and 64 is not enough. The consumer already batches -- it
   * drains everything available and writes it in one go, precisely so a
   * verbose mission is not killed for being verbose (see the comment at that
   * drain in `codex-mission.ts`) -- but the pile-up happens DURING the await
   * that writes the batch, and a fast runtime pushes more than 64 lines in the
   * time one fsync takes.
   *
   * MEASURED 2026-09-08: a Cursor teammate on grok-4.6 writing a long report
   * died with "Cursor Agent sent more output than Locust could take in" at
   * 373k in / 15k out. One earlier run of the same shape carried 1,596
   * records. So the ceiling was being hit by ordinary, productive work.
   *
   * 2048 instead. A record is one JSONL line, individually capped at 16 KiB
   * and in practice a few hundred bytes, so the realistic cost of the deeper
   * queue is well under a megabyte of memory held briefly.
   *
   * Overflow stays FATAL, deliberately, and that is unchanged: it means an
   * unknown number of unknown records were lost, and a ledger with an unknown
   * hole in it is worse than a run that stopped and said so. The point of the
   * larger number is that overflow now means something is actually wrong,
   * rather than that a model wrote a lot.
   */
  const maxQueuedRecords = positiveInteger(
    options.maxQueuedRecords,
    2_048,
    "maxQueuedRecords",
  );
  const cancellationGraceMs = positiveInteger(
    options.cancellationGraceMs,
    1_500,
    "cancellationGraceMs",
  );
  const terminationConfirmationMs = positiveInteger(
    options.terminationConfirmationMs,
    2_000,
    "terminationConfirmationMs",
  );
  const environment = minimalEnvironment(options.environment ?? process.env);
  const spawnProcess = options.spawnProcess ?? defaultSpawn;
  const now = options.now ?? (() => new Date());

  return {
    start(
      spec: RuntimeCommandSpec,
      prompt: string,
      startOptions: RuntimeProcessStartOptions = {},
    ): RuntimeProcessRun {
      if (startOptions.signal?.aborted === true) throw abortBeforeLaunchError();
      if (!isAbsolute(spec.executablePath)) {
        throw safeTransportError("Runtime executable path must be absolute");
      }
      if (!isAbsolute(spec.cwd)) {
        throw safeTransportError("Runtime workspace path must be absolute");
      }
      if (!ACCEPTED_TRANSPORTS.has(spec.stdin) || spec.stdout !== "jsonl") {
        throw safeTransportError("Runtime command does not satisfy the JSONL transport contract");
      }
      if (spec.args.some((argument) => argument.includes("\0"))) {
        throw safeTransportError("Runtime arguments cannot contain NUL bytes");
      }
      try {
        assertSafeRuntimeCommand(spec);
      } catch {
        throw safeTransportError("Runtime command failed safety validation");
      }

      const records = new AsyncRecordQueue(maxQueuedRecords);
      const stderr: BoundedStderr = { chunks: [], keptBytes: 0, totalBytes: 0 };
      const stdoutDecoder = new StringDecoder("utf8");
      const startedAt = now().toISOString();
      let stdoutRemainder = "";
      let recordCount = 0;
      let settled = false;
      let cancelled = false;
      let terminationRequested = false;
      let forcedTerminationAttempted = false;
      let terminationUnconfirmed = false;
      let inputDeliveryFailed = false;
      let outputLimitExceeded = false;
      let oversizedRecordsDropped = 0;
      /** Discarding the tail of a line already given up on, until its newline. */
      let skippingOversizedLine = false;
      let forceTimer: ReturnType<typeof setTimeout> | undefined;
      let confirmationTimer: ReturnType<typeof setTimeout> | undefined;
      let removeAbortListener = (): void => {};
      let completionResolve!: (completion: RuntimeProcessCompletion) => void;
      let completionReject!: (error: Error) => void;
      const completion = new Promise<RuntimeProcessCompletion>((resolve, reject) => {
        completionResolve = resolve;
        completionReject = reject;
      });

      /*
       * THE PROMPT, IN A FILE, for a runtime that reads neither stdin nor a
       * command line long enough to hold it. See the `prompt-file` note on
       * `RuntimeCommandSpec["stdin"]`.
       *
       * Written before the spawn and removed in `finally` below whatever
       * happens, including a failed launch. It holds the person's own words,
       * so it goes in a directory only they can read -- `mkdtemp` under the
       * OS temp root, which on every platform we ship is per-user -- and it
       * is deleted rather than left for the next person to find.
       */
      let promptDirectory: string | undefined;
      let args = spec.args;
      if (spec.stdin === "prompt-file") {
        try {
          promptDirectory = mkdtempSync(join(tmpdir(), "locust-prompt-"));
          const promptPath = join(promptDirectory, "prompt.txt");
          writeFileSync(promptPath, prompt, "utf8");
          args = spec.args.map((argument) =>
            argument === PROMPT_FILE_PLACEHOLDER ? promptPath : argument,
          );
          if (args.includes(PROMPT_FILE_PLACEHOLDER) || !args.includes(promptPath)) {
            // A spec that asked for this transport and never named where the
            // path goes would launch a run with no prompt at all, which reads
            // as the model ignoring you.
            throw new Error("placeholder");
          }
        } catch {
          discardPromptFile(promptDirectory);
          throw safeTransportError("Runtime prompt could not be prepared");
        }
      }

      let child: SpawnedRuntimeProcess;
      // H8: a .cmd launcher gets the command line cmd.exe reads correctly.
      let shape: ReturnType<typeof spawnShape>;
      try {
        shape = spawnShape(spec.executablePath, args);
      } catch (error) {
        discardPromptFile(promptDirectory);
        throw safeTransportError(error instanceof Error ? error.message : "Runtime process failed to start");
      }
      try {
        child = spawnProcess(spec.executablePath, shape.args, {
          cwd: spec.cwd,
          ...(shape.windowsVerbatimArguments === true ? { windowsVerbatimArguments: true } : {}),
          // The spec's own variables sit ON TOP of the allowlist, not beside
          // it: OpenCode's read-only permission config is the only thing
          // holding that runtime back, and a machine that happened to export
          // the same name must not be able to loosen it.
          env: { ...environment, ...(spec.env ?? {}) },
          shell: false,
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
        });
      } catch {
        throw safeTransportError("Runtime process failed to start");
      }

      const emitRecord = (raw: string): void => {
        if (!raw || outputLimitExceeded) return;
        if (Buffer.byteLength(raw, "utf8") > maxRecordBytes) {
          dropOversizedRecord();
          return;
        }
        const nextSequence = recordCount + 1;
        if (!records.push({ sequence: nextSequence, raw })) {
          exceedOutputLimit();
          return;
        }
        recordCount = nextSequence;
      };

      const acceptStdout = (text: string): void => {
        if (outputLimitExceeded) return;
        stdoutRemainder += text;
        let lineEnd = stdoutRemainder.indexOf("\n");
        while (lineEnd !== -1) {
          let line = stdoutRemainder.slice(0, lineEnd);
          stdoutRemainder = stdoutRemainder.slice(lineEnd + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (skippingOversizedLine) {
            // The tail of a line already given up on. Its newline is the
            // resynchronisation point: without this the remainder would be
            // read as a record of its own, and a half-line of JSON is worse
            // than no line -- it parses as malformed and is reported as the
            // runtime having sent nonsense, which it did not.
            skippingOversizedLine = false;
          } else {
            emitRecord(line);
          }
          if (outputLimitExceeded) {
            stdoutRemainder = "";
            return;
          }
          lineEnd = stdoutRemainder.indexOf("\n");
        }
        // A tail with no newline yet that is already past the cap: the line
        // being assembled can never be carried, so what is held is thrown away
        // and the rest of it is skipped as it arrives. Counted once, at the
        // moment the decision is made, not once per chunk that follows.
        if (Buffer.byteLength(stdoutRemainder, "utf8") > maxRecordBytes) {
          stdoutRemainder = "";
          if (!skippingOversizedLine) {
            skippingOversizedLine = true;
            dropOversizedRecord();
          }
        }
      };

      const cleanup = (): void => {
        if (forceTimer !== undefined) clearTimeout(forceTimer);
        if (confirmationTimer !== undefined) clearTimeout(confirmationTimer);
        removeAbortListener();
        // Both `finish` and `fail` come through here, so the prompt file is
        // removed on a clean exit, a crash, and a cancellation alike.
        discardPromptFile(promptDirectory);
        promptDirectory = undefined;
      };

      const finish = (exitCode: number | null, signal: NodeJS.Signals | null): void => {
        if (settled) return;
        settled = true;
        cleanup();
        acceptStdout(stdoutDecoder.end());
        if (stdoutRemainder.endsWith("\r")) {
          stdoutRemainder = stdoutRemainder.slice(0, -1);
        }
        emitRecord(stdoutRemainder);
        stdoutRemainder = "";
        records.close();
        const capturedStderr = Buffer.concat(stderr.chunks, stderr.keptBytes).toString("utf8");
        completionResolve({
          exitCode,
          signal,
          stderr: redactPrompt(capturedStderr, prompt),
          stderrTruncated: stderr.totalBytes > stderr.keptBytes,
          recordCount,
          cancelled,
          forcedTerminationAttempted,
          terminationUnconfirmed,
          inputDeliveryFailed,
          outputLimitExceeded,
          oversizedRecordsDropped,
          startedAt,
          finishedAt: now().toISOString(),
        });
      };

      const fail = (message: string): void => {
        if (settled) return;
        settled = true;
        cleanup();
        const error = safeTransportError(message);
        records.fail(error);
        completionReject(error);
      };

      const requestTermination = (userCancellation: boolean): void => {
        if (userCancellation) cancelled = true;
        if (settled || terminationRequested) return;
        terminationRequested = true;
        /*
         * Take the TREE down FIRST, and not only if the grace period elapses.
         *
         * MEASURED 2026-09-14 (Astra, on the installed app; reproduced with
         * real processes in `stop-reaches-the-tree.test.ts`): a run was asked
         * for a Node command that writes a file, waits ninety seconds, then
         * writes another, and was stopped at eighteen. Both files were there
         * afterwards. The command ran to completion and wrote into the
         * person's workspace a minute and a half after they stopped it.
         *
         * The reason is the ORDER. A well-behaved CLI obeys SIGINT and exits
         * immediately; the run settles, the forced timer below is cancelled,
         * and the grandchild it spawned is never anybody's problem again --
         * on Windows it is not even reachable afterwards, because the tree it
         * belonged to is gone the moment its parent is.
         *
         * ORDER IS THE WHOLE FIX, and the first attempt at it failed:
         * sweeping AFTER `child.kill` changed nothing, because on Windows
         * `kill` is not a signal -- it terminates the process outright. The
         * parent was already gone, so `taskkill /T` had no tree left to walk.
         * Measured both ways; this is the order that works.
         *
         * Nothing is lost by going first. `killProcessTree` is a no-op off
         * Windows, so POSIX still gets its SIGINT and its grace period, and
         * on Windows there was never a graceful stop to give up.
         */
        killProcessTree(child.pid);
        try {
          child.kill("SIGINT");
        } catch {
          // The forced path below is still attempted; raw child errors stay private.
        }
        if (settled) return;
        forceTimer = setTimeout(() => {
          if (settled) return;
          forcedTerminationAttempted = true;
          try {
            // The TREE, not the process. On Windows `kill` terminates one pid,
            // and the pid here is often a shim -- Claude Code is launched
            // through a PowerShell script, so killing the host leaves the
            // agent running. A stop that leaves a write-capable agent editing
            // the workspace, while the ledger records the run as cancelled,
            // is worse than no stop at all.
            killProcessTree(child.pid);
            child.kill("SIGKILL");
          } catch {
            // Completion remains deterministic even if the platform rejects the signal.
          }
          confirmationTimer = setTimeout(() => {
            if (settled) return;
            terminationUnconfirmed = true;
            finish(null, null);
          }, terminationConfirmationMs);
        }, cancellationGraceMs);
      };

      /**
       * One record was too big to carry. Skip it; do not kill the run.
       *
       * MEASURED 2026-09-07, Cursor Agent on grok-4.6, mission ef164de4:
       * 1,596 records arrived, the answer was streaming normally in fragments,
       * and record 1,597 was over the cap. The run was killed with SIGINT and
       * everything already on screen was thrown away -- for a mission whose
       * whole output was 871 tokens. The person was told to ask for "a
       * narrower slice", which was not the problem and would not have helped.
       *
       * A cap is still right: an unbounded record is a memory hole, and the
       * one that arrives is usually a whole file's contents or a tool result
       * nobody will read inline. But losing THAT record and losing THE RUN are
       * different sizes of loss, and only one of them is a reason to stop.
       * Cursor's own complete-message record REPLACES the fragments it already
       * sent, so dropping it costs nothing that is not already on screen.
       *
       * The count rides on the completion so a run that then ends badly can
       * say a piece was skipped, rather than blaming the runtime for a silence
       * the host created.
       */
      function dropOversizedRecord(): void {
        if (outputLimitExceeded) return;
        oversizedRecordsDropped += 1;
      }

      /**
       * The queue backed up: the consumer is not draining fast enough and
       * records would be lost silently from here on.
       *
       * This one stays fatal. Skipping an oversized record loses a piece the
       * host can name; a full queue loses an unknown number of unknown
       * records, and a ledger with an unknown hole in it is worse than a run
       * that stopped and said so.
       */
      function exceedOutputLimit(): void {
        if (outputLimitExceeded) return;
        outputLimitExceeded = true;
        stdoutRemainder = "";
        records.fail(safeTransportError("Runtime JSONL output exceeded its safety limit"));
        if (!settled) requestTermination(false);
      }

      child.stdout.on("data", (chunk) => {
        if (!settled) acceptStdout(stdoutDecoder.write(Buffer.from(chunk)));
      });
      child.stderr.on("data", (chunk) => {
        if (!settled) appendBounded(stderr, chunk, maxStderrBytes);
      });
      child.once("error", () => fail("Runtime process failed to start"));
      child.once("close", finish);
      child.stdin.once("error", () => {
        if (settled) return;
        inputDeliveryFailed = true;
        requestTermination(false);
      });

      const abortListener = (): void => requestTermination(true);
      if (startOptions.signal !== undefined) {
        startOptions.signal.addEventListener("abort", abortListener, { once: true });
        removeAbortListener = () =>
          startOptions.signal?.removeEventListener("abort", abortListener);
        if (startOptions.signal.aborted) requestTermination(true);
      }

      // A spec whose prompt is already in argv gets an empty, closed stdin.
      // Writing the prompt a second time would put it where the CLI is not
      // reading, and some CLIs treat anything on stdin as extra input.
      if (terminationRequested || spec.stdin === "none" || spec.stdin === "prompt-file") {
        child.stdin.end();
      } else {
        try {
          child.stdin.write(prompt, (error) => {
            if (error === undefined || error === null || settled) return;
            inputDeliveryFailed = true;
            requestTermination(false);
          });
          child.stdin.end();
        } catch {
          inputDeliveryFailed = true;
          requestTermination(false);
        }
      }

      return { records, completion };
    },
  };
}
