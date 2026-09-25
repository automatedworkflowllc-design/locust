import { createAppServerClient } from "./app-server.js";
import type { AppServerNotification, AppServerRequest, JsonValue } from "./app-server.js";
import type { AppServerEventNormalizer } from "./app-server-events.js";
import type { CodexEventNormalizer, NormalizedRuntimeEvent } from "./codex-events.js";
import type { RuntimeCommandSpec } from "./types.js";
import type {
  RuntimeJsonlRecord,
  RuntimeProcessCompletion,
  RuntimeProcessRecordStream,
  RuntimeProcessRun,
} from "./process-runner.js";

/**
 * One Codex turn over `codex app-server`, shaped like a process run.
 *
 * WHY THIS EXISTS. `codex exec --json` never streams an agent message. Run
 * directly and measured on 2026-09-10, its JSONL carries the whole reply in a
 * single `item.completed` and nothing before it -- so a Codex teammate sat in
 * silence and then dropped four paragraphs in one paint. app-server sends the
 * same reply as dozens of `item/agentMessage/delta` notifications, and the
 * normalizer for them already exists because Approve-each has used this
 * transport all along.
 *
 * So this is a transport swap, not a second mission system. It presents the
 * same two things the ordinary runner does -- a stream of records and a
 * completion receipt -- and everything that owns a mission (the ledger, the
 * follow-up rules, the disk observation, the workroom share) is untouched.
 *
 * The handshake is: `initialize`, `initialized`, then either `thread/start`
 * with the folder and the policy or `thread/resume` with a prior thread id,
 * then `turn/start` with the prompt. MEASURED 2026-09-10: `thread/resume`
 * works in a LATER process and keeps the earlier turns -- a second process
 * asked for a word the first had been told, and answered with it -- which is
 * what makes a follow-up here as warm as `codex exec resume`.
 */

export interface AppServerRunProcess {
  /** Write one framed line to the server. */
  write(line: string): void;
  /** Kill the server and its children. */
  kill(): void;
  onData(listener: (chunk: string) => void): void;
  onExit(listener: () => void): void;
}

export interface CodexAppServerRunOptions {
  readonly spawn: (
    executablePath: string,
    args: readonly string[],
    /** H7: the launch's own environment, to merge over the host's. */
    env?: Readonly<Record<string, string>>,
  ) => AppServerRunProcess;
  readonly command: RuntimeCommandSpec;
  readonly prompt: string;
  /** The thread's sandbox, as app-server names it. See `codexAppServerPolicy`. */
  readonly sandbox: string;
  readonly approvalPolicy: string;
  readonly model?: string;
  readonly effort?: string;
  /** A prior thread to carry on, which keeps its turns. */
  readonly resumeThreadId?: string;
  /**
   * What answers the server when it ASKS -- the approval channel. Only a
   * policy that stops for approval (`untrusted`) ever produces a request;
   * without a handler every request is refused, which under `never` is the
   * same as never being asked.
   */
  readonly onRequest?: (request: AppServerRequest) => Promise<JsonValue>;
  readonly signal?: AbortSignal;
  readonly now?: () => Date;
  /** How long the handshake may take before the run is called lost. */
  readonly handshakeTimeoutMs?: number;
  readonly maxQueuedRecords?: number;
}

/**
 * The stream yields ORDINARY JSONL records -- a sequence and one raw line --
 * rather than parsed notifications, so this really is the same shape the
 * process runner produces and nothing downstream needs a cast to believe it.
 * The line is the notification re-serialized; `asProcessNormalizer` parses it
 * back. A JSON round-trip per notification costs nothing beside the fsync the
 * ledger pays for the same batch.
 */
export type CodexAppServerRun = RuntimeProcessRun & {
  /**
   * Add a message to the turn that is running, WITHOUT stopping it (A2.10):
   * `turn/steer`, which Codex's app-server takes at the turn's next step.
   * True once the server accepted it; false when there is no turn to steer
   * (not started yet, or ended) or the server refused.
   */
  steer(text: string): Promise<boolean>;
};

const DEFAULT_HANDSHAKE_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_QUEUED_RECORDS = 4096;

/**
 * A single-consumer queue of notifications, bounded the way the process
 * runner's is: a server that floods faster than the ledger can write must end
 * the run rather than grow without limit.
 */
class NotificationQueue implements RuntimeProcessRecordStream {
  private readonly queued: RuntimeJsonlRecord[] = [];
  private readonly waiting: Array<
    (result: IteratorResult<RuntimeJsonlRecord>) => void
  > = [];
  private ended = false;
  private overflowed = false;

  constructor(private readonly maximum: number) {}

  get droppedForOverflow(): boolean {
    return this.overflowed;
  }

  push(record: RuntimeJsonlRecord): void {
    if (this.ended) return;
    const waiter = this.waiting.shift();
    if (waiter !== undefined) {
      waiter({ value: record, done: false });
      return;
    }
    if (this.queued.length >= this.maximum) {
      this.overflowed = true;
      return;
    }
    this.queued.push(record);
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    while (this.waiting.length > 0) {
      this.waiting.shift()?.({ value: undefined, done: true });
    }
  }

  drainAvailable(): readonly RuntimeJsonlRecord[] {
    const drained = [...this.queued];
    this.queued.length = 0;
    return drained;
  }

  [Symbol.asyncIterator](): AsyncIterator<RuntimeJsonlRecord> {
    return {
      next: (): Promise<IteratorResult<RuntimeJsonlRecord>> => {
        const queued = this.queued.shift();
        if (queued !== undefined) {
          return Promise.resolve({ value: queued, done: false });
        }
        if (this.ended) {
          return Promise.resolve({ value: undefined, done: true });
        }
        return new Promise((resolve) => {
          this.waiting.push(resolve);
        });
      },
    };
  }
}

/**
 * A turn's own ending, as the server reports it. `turn/completed` and
 * `turn/failed` both end the run; anything else that stops it -- the process
 * dying, the person cancelling -- is reported through the completion receipt
 * instead, which is what the normalizer's `finish` is for.
 */
const ENDING_METHODS = new Set(["turn/completed", "turn/failed"]);

export function startCodexAppServerRun(
  options: CodexAppServerRunOptions,
): CodexAppServerRun {
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const records = new NotificationQueue(
    options.maxQueuedRecords ?? DEFAULT_MAX_QUEUED_RECORDS,
  );

  let recordCount = 0;
  let cancelled = false;
  let transportFailed = false;
  let stderr = "";
  let settleCompletion!: (completion: RuntimeProcessCompletion) => void;
  const completion = new Promise<RuntimeProcessCompletion>((resolve) => {
    settleCompletion = resolve;
  });
  let settled = false;
  /** The thread and the turn running on it, once the server has said them. */
  let threadId: string | undefined;
  let turnId: string | undefined;
  const turnIdOf = (value: unknown): string | undefined => {
    const turn = typeof value === "object" && value !== null ? (value as Record<string, unknown>).turn : undefined;
    const id = typeof turn === "object" && turn !== null ? (turn as Record<string, unknown>).id : undefined;
    return typeof id === "string" && id.length > 0 ? id : undefined;
  };

  const child = options.spawn(options.command.executablePath, options.command.args, options.command.env);

  const finish = (): void => {
    if (settled) return;
    settled = true;
    records.end();
    try {
      child.kill();
    } catch {
      // Already gone; the receipt below is what the mission reads.
    }
    settleCompletion({
      // A protocol run has no exit code of its own to report: the turn ended
      // or it did not, and saying `0` for a lost transport would read as a
      // clean finish. Null with `cancelled`/`stderr` is the honest shape.
      exitCode: transportFailed || cancelled ? null : 0,
      signal: null,
      stderr,
      stderrTruncated: false,
      recordCount,
      cancelled,
      forcedTerminationAttempted: false,
      terminationUnconfirmed: false,
      inputDeliveryFailed: false,
      outputLimitExceeded: records.droppedForOverflow,
      oversizedRecordsDropped: 0,
      startedAt,
      finishedAt: now().toISOString(),
    });
  };

  const lose = (why: string): void => {
    if (settled) return;
    transportFailed = true;
    stderr = stderr.length > 0 ? stderr : why;
    finish();
  };

  const client = createAppServerClient({
    transport: {
      send: (line: string) => child.write(line),
      close: () => child.kill(),
    },
    onNotification: (notification) => {
      recordCount += 1;
      records.push({
        sequence: recordCount,
        raw: JSON.stringify({ method: notification.method, params: notification.params ?? null }),
      });
      if (notification.method === "turn/started") turnId = turnIdOf(notification.params) ?? turnId;
      if (ENDING_METHODS.has(notification.method)) finish();
    },
    // The approval channel, when the mode has one. Under `never` nothing
    // asks -- measured to raise no request at all -- and a server that asks
    // anyway is answered with a refusal rather than left waiting, because an
    // unanswered request stalls the turn forever and the person would see a
    // run that never ends.
    onRequest: options.onRequest ?? (async () => ({ decision: "reject" }) as JsonValue),
    onDiagnostic: (diagnostic) => {
      if (diagnostic.code === "buffer-overflow" || diagnostic.code === "line-too-long") {
        lose(diagnostic.message);
      }
    },
  });

  child.onData((chunk) => client.accept(chunk));
  child.onExit(() => {
    // A server that exits before its turn ends took the turn with it.
    lose("The runtime exited before the turn finished.");
  });

  if (options.signal !== undefined) {
    if (options.signal.aborted) {
      cancelled = true;
      finish();
    } else {
      options.signal.addEventListener(
        "abort",
        () => {
          cancelled = true;
          finish();
        },
        { once: true },
      );
    }
  }

  const handshake = async (): Promise<void> => {
    await client.request("initialize", {
      clientInfo: { name: "locust", version: "0.1.0" },
    });
    client.notify("initialized");
    const thread = await client.request(
      options.resumeThreadId === undefined ? "thread/start" : "thread/resume",
      {
        ...(options.resumeThreadId === undefined
          ? {}
          : { threadId: options.resumeThreadId }),
        cwd: options.command.cwd,
        sandbox: options.sandbox,
        approvalPolicy: options.approvalPolicy,
      },
    );
    const record = (typeof thread === "object" && thread !== null ? thread : {}) as Record<
      string,
      unknown
    >;
    const inner = (typeof record.thread === "object" && record.thread !== null
      ? record.thread
      : {}) as Record<string, unknown>;
    const startedThread = typeof inner.id === "string" ? inner.id : undefined;
    if (startedThread === undefined) throw new Error("The runtime did not start a thread.");
    threadId = startedThread;
    // Route and effort are per-TURN parameters here rather than flags. Only a
    // plain word is passed as either: a malformed one is refused by the server
    // and takes the whole turn with it, which the person would read as the
    // runtime failing for no stated reason.
    const model =
      typeof options.model === "string" && options.model.trim().length > 0
        ? options.model
        : undefined;
    const effort =
      typeof options.effort === "string" && /^[a-z]{1,16}$/.test(options.effort)
        ? options.effort
        : undefined;
    const started = await client.request("turn/start", {
      threadId: startedThread,
      approvalPolicy: options.approvalPolicy,
      input: [{ type: "text", text: options.prompt }],
      ...(model === undefined ? {} : { model }),
      ...(effort === undefined ? {} : { effort }),
    });
    turnId = turnIdOf(started) ?? turnId;
  };

  const timeout = setTimeout(() => {
    lose("The runtime did not answer in time.");
  }, options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS);

  void handshake().then(
    () => clearTimeout(timeout),
    (error: unknown) => {
      clearTimeout(timeout);
      lose(
        error instanceof Error && error.message.length > 0
          ? error.message
          : "The runtime did not start a turn.",
      );
    },
  );

  void completion.finally(() => {
    clearTimeout(timeout);
    client.dispose("The turn ended.");
  });

  const steer = async (text: string): Promise<boolean> => {
    if (settled || threadId === undefined || turnId === undefined || text.trim().length === 0) return false;
    try {
      await client.request("turn/steer", {
        threadId,
        expectedTurnId: turnId,
        input: [{ type: "text", text }],
      });
      return true;
    } catch {
      return false;
    }
  };

  return { records, completion, steer };
}

/**
 * The app-server normalizer, wearing the shape the mission loop consumes.
 *
 * The two normalizers differ in exactly two ways: what a record is (a
 * notification rather than a JSONL line) and what ends a run (a reason rather
 * than a completion receipt). This closes both gaps so one mission loop can
 * drive either transport, rather than a second loop being written for the one
 * that streams.
 *
 * `finish` is only reached for a run that ended WITHOUT the server saying so.
 * A turn that completed normally already emitted its terminal event from
 * `turn/completed`, and the normalizer's own `finalized` flag makes the second
 * call empty.
 */
/**
 * The notification a record on this transport was written from, or nothing.
 *
 * Shared by the normalizer below and by anyone else reading the stream -- the
 * mission loop reads file changes off the same records, so the parse lives in
 * one place rather than being done twice with two chances to differ.
 */
export function notificationOfRecord(record: RuntimeJsonlRecord): AppServerNotification | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(record.raw);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const notification = parsed as { method?: unknown; params?: unknown };
  if (typeof notification.method !== "string") return undefined;
  return {
    method: notification.method,
    params: (notification.params ?? undefined) as AppServerNotification["params"],
  };
}

export function asProcessNormalizer(
  normalizer: AppServerEventNormalizer,
): CodexEventNormalizer {
  return {
    get runtimeThreadId(): string | undefined {
      return normalizer.runtimeThreadId;
    },
    get finalized(): boolean {
      return normalizer.finalized;
    },
    accept(record: RuntimeJsonlRecord): readonly NormalizedRuntimeEvent[] {
      // Every record on this transport is a notification the runner wrote out
      // as a line. A line that is not one -- which nothing here produces --
      // is dropped rather than guessed at.
      const notification = notificationOfRecord(record);
      return notification === undefined ? [] : normalizer.accept(notification);
    },
    finish(completion: RuntimeProcessCompletion): readonly NormalizedRuntimeEvent[] {
      // With the reason the run recorded for the failure, when it has one (L1).
      return normalizer.finish(completion.cancelled ? "cancelled" : "transport-lost", completion.stderr);
    },
  };
}
