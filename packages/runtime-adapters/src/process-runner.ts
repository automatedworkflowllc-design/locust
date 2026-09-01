import { spawn } from "node:child_process";
import { isAbsolute } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { assertSafeRuntimeCommand } from "./commands.js";
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
  const maxQueuedRecords = positiveInteger(
    options.maxQueuedRecords,
    64,
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
      if (spec.stdin !== "prompt" || spec.stdout !== "jsonl") {
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
      let forceTimer: ReturnType<typeof setTimeout> | undefined;
      let confirmationTimer: ReturnType<typeof setTimeout> | undefined;
      let removeAbortListener = (): void => {};
      let completionResolve!: (completion: RuntimeProcessCompletion) => void;
      let completionReject!: (error: Error) => void;
      const completion = new Promise<RuntimeProcessCompletion>((resolve, reject) => {
        completionResolve = resolve;
        completionReject = reject;
      });

      let child: SpawnedRuntimeProcess;
      try {
        child = spawnProcess(spec.executablePath, spec.args, {
          cwd: spec.cwd,
          env: { ...environment },
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
          exceedOutputLimit();
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
          emitRecord(line);
          if (outputLimitExceeded) {
            stdoutRemainder = "";
            return;
          }
          lineEnd = stdoutRemainder.indexOf("\n");
        }
        if (Buffer.byteLength(stdoutRemainder, "utf8") > maxRecordBytes) {
          stdoutRemainder = "";
          exceedOutputLimit();
        }
      };

      const cleanup = (): void => {
        if (forceTimer !== undefined) clearTimeout(forceTimer);
        if (confirmationTimer !== undefined) clearTimeout(confirmationTimer);
        removeAbortListener();
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

      if (terminationRequested) {
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
