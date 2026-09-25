import { randomBytes } from "node:crypto";

import { NotificationQueue } from "./codex-app-server-run.js";
import type { AppServerRunProcess } from "./codex-app-server-run.js";
import type { RuntimeCommandSpec } from "./types.js";
import type { RuntimeProcessCompletion, RuntimeProcessRun } from "./process-runner.js";

/**
 * OpenCode through its own server, so a run can stop and ASK (A6.7).
 *
 * `opencode run` cannot ask anyone: a permission set to "ask" is rejected on
 * the spot. `opencode serve` raises it instead. MEASURED 2026-09-25 on
 * 1.18.27 with the free Ling: a shell call under `bash: "ask"` raised
 * `permission.asked` on `/event` -- the command, its patterns, a suggested
 * "always" pattern and the tool call -- `POST /permission/{id}/reply
 * {reply:"once"}` ran it, and `{reply:"reject", message}` failed the call
 * while the model read the reason and still answered.
 *
 * The run's records are the ones `opencode run --format json` prints --
 * `step_start`, `text`, `tool_use`, `step_finish`, `error` -- rebuilt from the
 * server's part events, so the OpenCode normalizer every other OpenCode run
 * goes through reads this one unchanged. The part shapes are the server's
 * own; `run` prints the same parts once they settle (captured the same day).
 *
 * The server listens on localhost and, left to its defaults, answers anyone
 * on the machine -- including a request that approves a shell command. So
 * every server this starts gets a random password (OPENCODE_SERVER_PASSWORD;
 * measured: 401 without it, 200 with it), passed in the child's environment
 * only, never in argv or the record.
 */
export interface OpenCodePermission {
  readonly id: string;
  /** What kind of thing: `bash`, `edit`, `external_directory`, `webfetch`... */
  readonly permission: string;
  readonly patterns: readonly string[];
  /** What OpenCode would remember on "always". */
  readonly always: readonly string[];
  readonly metadata: Readonly<Record<string, unknown>>;
}

export type OpenCodePermissionReply = "once" | "always" | "reject";

export interface OpenCodeServeRunOptions {
  readonly spawn: (executablePath: string, args: readonly string[], env?: Readonly<Record<string, string>>) => AppServerRunProcess;
  readonly command: RuntimeCommandSpec;
  readonly prompt: string;
  /** `provider/model`, as every other OpenCode route names it. */
  readonly model?: string;
  readonly variant?: string;
  readonly resumeSessionId?: string;
  /** Who answers. Absent: every request is refused, never approved. */
  readonly onPermission?: (request: OpenCodePermission) => Promise<OpenCodePermissionReply>;
  readonly signal?: AbortSignal;
  readonly now?: () => Date;
  /** Test seam. */
  readonly fetch?: typeof fetch;
  readonly startupTimeoutMs?: number;
}

const LISTENING = /listening on (http:\/\/127\.0\.0\.1:\d+)/;

type JsonObject = Record<string, unknown>;
const isObject = (value: unknown): value is JsonObject => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): string | undefined => (typeof value === "string" && value.length > 0 ? value : undefined);

/**
 * The `run --format json` record for one settled part, or undefined.
 *
 * Exported for the tests, which hold it to the captured shapes: a step's
 * start and finish once each, a tool once it has completed or failed, and a
 * text part once it has ended -- the person's own prompt never (it has no
 * end), and OpenCode's synthetic parts always, because the compaction note
 * the normalizer reads arrives on a message of its own.
 */
export function runRecordFor(
  part: JsonObject,
  role: string | undefined,
): { readonly type: string; readonly part: JsonObject } | undefined {
  const type = text(part.type);
  if (type === "step-start") return role === "assistant" ? { type: "step_start", part } : undefined;
  if (type === "step-finish") return role === "assistant" ? { type: "step_finish", part } : undefined;
  if (type === "tool") {
    const status = isObject(part.state) ? text(part.state.status) : undefined;
    return role === "assistant" && (status === "completed" || status === "error") ? { type: "tool_use", part } : undefined;
  }
  if (type === "text") {
    const ended = isObject(part.time) && typeof part.time.end === "number";
    if (!ended) return undefined;
    return role === "assistant" || part.synthetic === true ? { type: "text", part } : undefined;
  }
  return undefined;
}

export function startOpenCodeServeRun(options: OpenCodeServeRunOptions): RuntimeProcessRun {
  const now = options.now ?? (() => new Date());
  const request = options.fetch ?? fetch;
  const startedAt = now().toISOString();
  const records = new NotificationQueue(20_000);
  const password = randomBytes(24).toString("base64url");
  const auth = { authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}` };
  const events = new AbortController();

  let recordCount = 0;
  let settled = false;
  let cancelled = false;
  let errored = false;
  let why = "";
  let base: string | undefined;
  let sessionId: string | undefined;
  let prompted = false;
  let settleCompletion!: (completion: RuntimeProcessCompletion) => void;
  const completion = new Promise<RuntimeProcessCompletion>((resolve) => {
    settleCompletion = resolve;
  });
  const roles = new Map<string, string>();
  const emitted = new Set<string>();

  const child = options.spawn(options.command.executablePath, options.command.args, {
    ...(options.command.env ?? {}),
    OPENCODE_SERVER_PASSWORD: password,
  });

  const finish = (): void => {
    if (settled) return;
    settled = true;
    events.abort();
    records.end();
    try {
      child.kill();
    } catch {
      // Already gone.
    }
    settleCompletion({
      exitCode: cancelled ? null : errored || why.length > 0 ? 1 : 0,
      signal: null,
      stderr: why,
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
  const lose = (reason: string): void => {
    if (settled) return;
    why = why.length > 0 ? why : reason;
    finish();
  };
  const push = (record: JsonObject): void => {
    if (settled) return;
    recordCount += 1;
    records.push({ sequence: recordCount, raw: JSON.stringify({ ...record, timestamp: Date.now(), sessionID: sessionId }) });
    if (records.droppedForOverflow) lose("OpenCode sent output faster than Locust could record it, so the run was stopped rather than leave a gap in its record. Sending it again usually works.");
  };
  const call = async (path: string, body?: unknown): Promise<Response> =>
    request(`${base!}${path}`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });

  const answer = async (asked: JsonObject): Promise<void> => {
    const id = text(asked.id);
    if (id === undefined) return;
    const permission: OpenCodePermission = {
      id,
      permission: text(asked.permission) ?? "unknown",
      patterns: Array.isArray(asked.patterns) ? asked.patterns.filter((entry): entry is string => typeof entry === "string") : [],
      always: Array.isArray(asked.always) ? asked.always.filter((entry): entry is string => typeof entry === "string") : [],
      metadata: isObject(asked.metadata) ? asked.metadata : {},
    };
    let reply: OpenCodePermissionReply = "reject";
    try {
      reply = options.onPermission === undefined ? "reject" : await options.onPermission(permission);
    } catch {
      reply = "reject";
    }
    if (settled) return;
    await call(`/permission/${encodeURIComponent(id)}/reply`, reply === "reject"
      ? { reply, message: "The person declined this in Locust." }
      : { reply }).catch(() => undefined);
  };

  const accept = (event: JsonObject): void => {
    const type = text(event.type);
    const props = isObject(event.properties) ? event.properties : {};
    const about = text(props.sessionID) ?? (isObject(props.info) ? text(props.info.sessionID) : undefined)
      ?? (isObject(props.part) ? text(props.part.sessionID) : undefined);
    if (sessionId === undefined || about !== sessionId) return;
    if (type === "message.updated" && isObject(props.info)) {
      const id = text(props.info.id);
      const role = text(props.info.role);
      if (id !== undefined && role !== undefined) roles.set(id, role);
      return;
    }
    if (type === "message.part.updated" && isObject(props.part)) {
      const part = props.part;
      const record = runRecordFor(part, roles.get(text(part.messageID) ?? ""));
      if (record === undefined) return;
      const key = `${record.type}:${text(part.id) ?? JSON.stringify(part).slice(0, 80)}`;
      if (emitted.has(key)) return;
      emitted.add(key);
      push(record);
      return;
    }
    if (type === "permission.asked") {
      void answer(props);
      return;
    }
    if (type === "session.error") {
      errored = true;
      push({ type: "error", error: isObject(props.error) ? props.error : { name: "UnknownError", data: { message: "OpenCode reported an error." } } });
      return;
    }
    if (type === "session.idle" && prompted) finish();
  };

  const readEvents = async (): Promise<void> => {
    const response = await request(`${base!}/event`, { headers: auth, signal: events.signal });
    if (!response.ok || response.body === null) throw new Error(`OpenCode's event stream answered ${String(response.status)}`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let at: number;
      while ((at = buffer.indexOf("\n\n")) >= 0) {
        const chunk = buffer.slice(0, at);
        buffer = buffer.slice(at + 2);
        const data = chunk.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("");
        if (data.length === 0) continue;
        let event: unknown;
        try {
          event = JSON.parse(data);
        } catch {
          continue;
        }
        if (isObject(event)) accept(event);
      }
    }
  };

  const begin = async (): Promise<void> => {
    const stream = readEvents().catch((error: unknown) => {
      if (!settled && !cancelled) lose(error instanceof Error ? error.message : "OpenCode's event stream ended.");
    });
    if (options.resumeSessionId !== undefined) {
      sessionId = options.resumeSessionId;
    } else {
      const created = await call("/session");
      const body: unknown = await created.json().catch(() => undefined);
      sessionId = isObject(body) ? text(body.id) : undefined;
      if (!created.ok || sessionId === undefined) throw new Error("OpenCode's server would not start a session.");
    }
    const slash = options.model?.indexOf("/") ?? -1;
    const sent = await call(`/session/${encodeURIComponent(sessionId)}/prompt_async`, {
      parts: [{ type: "text", text: options.prompt }],
      ...(options.model !== undefined && slash > 0
        ? { model: { providerID: options.model.slice(0, slash), modelID: options.model.slice(slash + 1) } }
        : {}),
      ...(options.variant === undefined ? {} : { variant: options.variant }),
    });
    if (!sent.ok) throw new Error(`OpenCode's server refused the message (${String(sent.status)}).`);
    prompted = true;
    await stream;
  };

  let stdout = "";
  const startup = setTimeout(() => lose("OpenCode's server did not say where it was listening."), options.startupTimeoutMs ?? 30_000);
  child.onData((chunk) => {
    if (base !== undefined) return;
    stdout = `${stdout}${chunk}`.slice(-4_000);
    const found = LISTENING.exec(stdout);
    if (found === null) return;
    clearTimeout(startup);
    base = found[1];
    void begin().catch((error: unknown) => lose(error instanceof Error ? error.message : "OpenCode's server could not be reached."));
  });
  child.onExit(() => {
    clearTimeout(startup);
    lose("OpenCode's server exited before the turn finished.");
  });

  const stop = (): void => {
    if (settled) return;
    cancelled = true;
    if (base === undefined || sessionId === undefined) {
      finish();
      return;
    }
    // Asked to stop first, so the session is left settled for a later turn;
    // the server goes either way.
    void call(`/session/${encodeURIComponent(sessionId)}/abort`).catch(() => undefined).finally(() => {
      setTimeout(finish, 1_500);
    });
  };
  if (options.signal !== undefined) {
    if (options.signal.aborted) stop();
    else options.signal.addEventListener("abort", stop, { once: true });
  }

  return { records, completion };
}
