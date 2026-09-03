import {
  boundedMessageText,
  evidenceFor,
  identityValue,
  isObject,
  malformedEvidence,
  processEvidence,
  requireContextText,
  stringValue,
} from "./codex-events.js";
import type {
  CodexEventEvidence,
  NormalizedRuntimeEvent,
  NormalizedRuntimeEventType,
  NormalizedRuntimePayloadMap,
  RedactedJsonValue,
} from "./codex-events.js";
import type {
  RuntimeJsonlRecord,
  RuntimeProcessCompletion,
} from "./process-runner.js";

/**
 * Cursor Agent `stream-json` -> product events.
 *
 * Every shape here was measured against cursor-agent 2026.08.31 under the
 * exact argv `createCursorPrintCommand` produces, with the prompt on stdin.
 * The captured streams are the fixtures in `test/fixtures/cursor/`: a
 * read-only run with partial output, a write-mode run whose shell commands
 * were rejected, and a resumed turn.
 *
 * What was measured, and what it means here:
 *
 * - `system`/`init` carries the session id (which `--resume` takes back), the
 *   model Cursor resolved (`"Auto"`, `"Composer 2.5"`), the permission mode,
 *   the cwd and the auth source. It is allow-listed like Claude's.
 * - `thinking` deltas are the model's reasoning. Their text is REDACTED from
 *   the evidence, as Codex's reasoning items are, and they become a
 *   `reasoning` step so the step line can show that thinking is happening.
 * - `assistant` records come in two forms that look alike. With
 *   `--stream-partial-output` each fragment arrives as its own record carrying
 *   `timestamp_ms` and no `model_call_id`; then the COMPLETE message arrives
 *   as one more record, either with a `model_call_id` or with no timestamp at
 *   all. The complete one REPLACES the fragments -- appending it would double
 *   every answer. A run can hold several messages (one before a tool call,
 *   one after), so each complete message closes its own item rather than all
 *   of them sharing one.
 * - `tool_call` started/completed wrap one typed key (`readToolCall`,
 *   `editToolCall`, `shellToolCall`, `globToolCall`, ...) with `args` and, on
 *   completion, a `result` whose WRAPPER KEY is the outcome: `success` or
 *   `rejected` in the captures. In print mode without `--force`, every shell
 *   command was `rejected`: a tool that did not run, so it is `tool.failed`,
 *   never completed. Any other wrapper key is also a failure -- an outcome
 *   this build has never seen must not be recorded as if it went well.
 * - `success` means the tool was ALLOWED TO RUN, not that it worked. A shell
 *   result carries the command's own `exitCode` inside that wrapper, so a
 *   command that ran and exited non-zero is a failure with its code recorded,
 *   the way the Codex adapter reads `exit_code`.
 * - A rejected call's completion carries no `args`; the command it wanted to
 *   run is inside `result.rejected.command`. Reading only `args` dropped the
 *   one fact a rejection exists to record.
 *   One capture's call ids contained a literal newline; item ids are made
 *   single-line without losing either half.
 * - `result` closes the run: `is_error` and a non-success subtype mean a
 *   failure, and its absence on a clean exit is not a success.
 */

export interface CursorInvocationContext {
  /** Product-owned run identifier. Never the provider's session id. */
  readonly runId: string;
  readonly missionId?: string;
  readonly requestedRouteId?: string;
  readonly resolvedRouteId?: string;
  readonly cliVersion?: string;
  /** Test seam and host clock. */
  readonly now?: () => Date;
}

export interface CursorEventNormalizer {
  readonly runtimeThreadId: string | undefined;
  readonly finalized: boolean;
  accept(record: RuntimeJsonlRecord): readonly NormalizedRuntimeEvent[];
  finish(completion: RuntimeProcessCompletion): readonly NormalizedRuntimeEvent[];
}

type JsonObject = Record<string, unknown>;

const INIT_ALLOWED_KEYS = new Set(["session_id", "model", "permissionMode", "cwd", "apiKeySource"]);

export function summarizeCursorInit(value: unknown): JsonObject {
  if (!isObject(value)) return {};
  const summary: JsonObject = {};
  for (const key of INIT_ALLOWED_KEYS) {
    const held = value[key];
    if (typeof held === "string") summary[key] = boundedMessageText(held);
  }
  return summary;
}

/**
 * Whether an `assistant` record is one streamed fragment or the complete
 * message. Measured: fragments carry `timestamp_ms` and never `model_call_id`;
 * the complete message carries `model_call_id`, or no timestamp at all.
 */
export function isCursorMessageFragment(record: JsonObject): boolean {
  return typeof record.timestamp_ms === "number" && record.model_call_id === undefined;
}

/** `readToolCall` -> `read`; anything that does not follow the pattern is kept whole. */
export function cursorToolKind(key: string): string {
  const match = /^([a-z][A-Za-z0-9]*?)ToolCall$/.exec(key);
  return match?.[1] ?? key;
}

/** A glob call names a pattern and the directory it was run in. */
/** Token counts only, as numbers, so nothing else in the record rides along. */
function sanitizedUsage(value: JsonObject): RedactedJsonValue {
  const counts: Record<string, number> = {};
  for (const [key, held] of Object.entries(value)) {
    if (typeof held === "number" && Number.isFinite(held)) counts[key] = held;
  }
  return counts as RedactedJsonValue;
}

function globTarget(args: JsonObject): string | undefined {
  const pattern = stringValue(args.globPattern);
  if (pattern === undefined) return undefined;
  const directory = stringValue(args.targetDirectory);
  return directory === undefined ? pattern : `${pattern} in ${directory}`;
}

/**
 * What a completed tool call actually did.
 *
 * The wrapper key is the outcome, and `success` only means the tool was let
 * through: a shell result carries the command's own exit code inside it. An
 * outcome this build has never seen is treated as a failure, because a
 * ledger that records an unknown result as success is wrong in the direction
 * that matters.
 */
export function toolOutcome(result: JsonObject): {
  readonly failed: boolean
  readonly status?: string
  readonly exitCode?: number
} {
  const key = Object.keys(result)[0];
  if (key === undefined) return { failed: true, status: "unknown" };
  if (key !== "success") return { failed: true, status: key };
  const body = isObject(result.success) ? result.success : {};
  const exitCode = typeof body.exitCode === "number" && Number.isFinite(body.exitCode)
    ? body.exitCode
    : undefined;
  if (exitCode !== undefined && exitCode !== 0) {
    return { failed: true, status: "exit", exitCode };
  }
  return exitCode === undefined ? { failed: false } : { failed: false, exitCode };
}

function assistantText(parsed: JsonObject): string {
  const message = isObject(parsed.message) ? parsed.message : {};
  const content = Array.isArray(message.content) ? message.content : [];
  return content
    .map((block) => (isObject(block) ? stringValue(block.text) : undefined))
    .filter((value): value is string => value !== undefined)
    .join("");
}

export function createCursorEventNormalizer(
  context: CursorInvocationContext,
): CursorEventNormalizer {
  const runId = requireContextText(context.runId, "runId");
  const cliVersion = context.cliVersion === undefined
    ? undefined
    : requireContextText(context.cliVersion, "cliVersion");
  const now = context.now ?? (() => new Date());

  const openTools = new Map<string, { kind: string }>();
  let runtimeThreadId: string | undefined;
  let normalizedSequence = 0;
  let finalized = false;
  let sawResult = false;
  let terminalFailure: string | undefined;
  let usage: RedactedJsonValue | undefined;
  /** Which message the next fragment belongs to; closed by a complete message. */
  let messageIndex = 0;
  let thinking = false;
  /** How much of each message the fragments have already put in the ledger. */
  const deliveredLength = new Map<string, number>();

  const emit = <TType extends NormalizedRuntimeEventType>(
    type: TType,
    payload: NormalizedRuntimePayloadMap[TType],
  ): NormalizedRuntimeEvent => {
    normalizedSequence += 1;
    return {
      id: `${runId}:cursor:${normalizedSequence}`,
      runId,
      ...(context.missionId === undefined ? {} : { missionId: context.missionId }),
      sequence: normalizedSequence,
      occurredAt: now().toISOString(),
      sourceAdapter: "cursor",
      ...(cliVersion === undefined ? {} : { cliVersion }),
      ...(context.requestedRouteId === undefined ? {} : { requestedRouteId: context.requestedRouteId }),
      ...(context.resolvedRouteId === undefined ? {} : { resolvedRouteId: context.resolvedRouteId }),
      ...(runtimeThreadId === undefined ? {} : { runtimeThreadId }),
      type,
      payload,
    } as NormalizedRuntimeEvent;
  };

  const diagnostic = (
    level: "info" | "warning" | "error",
    code: string,
    message: string,
    evidence: CodexEventEvidence,
  ): NormalizedRuntimeEvent =>
    emit("adapter.diagnostic", { level, code, message, terminal: false, evidence });

  function acceptParsed(
    record: RuntimeJsonlRecord,
    parsed: JsonObject,
  ): readonly NormalizedRuntimeEvent[] {
    const type = stringValue(parsed.type);
    if (type === undefined) return [];

    if (type === "thinking") {
      // The reasoning text never reaches the ledger. The record is rebuilt
      // without it, and the evidence is marked redacted for having been.
      const scrubbed = { type, subtype: parsed.subtype, text: "[redacted]" };
      const evidence = { ...evidenceFor(record, scrubbed, type), redacted: true };
      if (stringValue(parsed.subtype) === "completed") {
        if (!thinking) return [];
        thinking = false;
        return [emit("step.completed", { stepKind: "reasoning", evidence })];
      }
      if (thinking) return [];
      thinking = true;
      return [emit("step.started", { stepKind: "reasoning", evidence })];
    }

    const evidence = evidenceFor(record, parsed, type);

    if (type === "system") {
      if (stringValue(parsed.subtype) !== "init") {
        // Opened AND closed. A step that only ever starts leaves the thread
        // showing work in progress that nothing ever finishes.
        return [
          emit("step.started", { stepKind: "turn", evidence }),
          emit("step.completed", { stepKind: "turn", evidence }),
        ];
      }
      runtimeThreadId = identityValue(parsed.session_id);
      return [
        emit("run.started", {
          runtimeThreadId: runtimeThreadId ?? "",
          evidence: { ...evidence, raw: summarizeCursorInit(parsed) as never, redacted: true },
        }),
      ];
    }

    if (type === "user") {
      // The prompt, echoed back. The ledger already holds the prompt.
      return [];
    }

    if (type === "assistant") {
      const text = assistantText(parsed);
      if (text.length === 0) return [];
      const itemId = `msg_${String(messageIndex)}`;
      if (isCursorMessageFragment(parsed)) {
        deliveredLength.set(itemId, (deliveredLength.get(itemId) ?? 0) + text.length);
        return [
          emit("message.delta", {
            itemId,
            operation: "append",
            text: boundedMessageText(text),
            final: false,
            evidence,
          }),
        ];
      }
      // TRAP: the complete message. Its text has already arrived as fragments
      // when partial output is on, so it REPLACES the item -- and closes it,
      // so the next message does not overwrite this one.
      messageIndex += 1;
      const bounded = boundedMessageText(text);
      // A REPLACE that is shorter than what the fragments already delivered
      // would take text back out of the ledger. Each fragment is bounded on
      // its own and so is never truncated, but the whole message can be: a
      // long answer ended up SHORTER on disk than it had been a moment
      // earlier. When that happens the fragments stand, and the item is
      // closed without rewriting it.
      const alreadyDelivered = deliveredLength.get(itemId) ?? 0;
      if (bounded.length < alreadyDelivered) return [];
      return [
        emit("message.delta", {
          itemId,
          operation: "replace",
          text: bounded,
          final: true,
          evidence,
        }),
      ];
    }

    if (type === "tool_call") {
      const wrapper = isObject(parsed.tool_call) ? parsed.tool_call : {};
      const key = Object.keys(wrapper).find((name) => name.endsWith("ToolCall"));
      const call = key !== undefined && isObject(wrapper[key]) ? (wrapper[key] as JsonObject) : {};
      const args = isObject(call.args) ? call.args : {};
      const outcome = isObject(call.result) ? call.result : {};
      // A rejected call reports no `args`; what it wanted to run is inside
      // the rejection itself.
      const refused = isObject(outcome.rejected) ? outcome.rejected : undefined;
      // Measured: one capture's ids held a literal newline between two
      // halves ("call-…-0\nfc_…_0"), in both the top-level `call_id` and the
      // typed call's `toolCallId`. An item id is one line; the halves are
      // joined with a separator that keeps them distinct.
      const rawId = identityValue(wrapper.toolCallId) ?? identityValue(parsed.call_id);
      const itemId = rawId === undefined ? `tool_${String(record.sequence)}` : rawId.replace(/\s+/g, "|");
      const kind = key === undefined ? "tool" : cursorToolKind(key);
      const target = stringValue(args.command)
        ?? stringValue(args.path)
        ?? stringValue(refused?.command)
        ?? stringValue(refused?.path)
        ?? globTarget(args);
      const subtype = stringValue(parsed.subtype);
      if (subtype === "started") {
        openTools.set(itemId, { kind });
        return [
          emit("tool.started", {
            itemId,
            toolKind: kind,
            name: kind,
            ...(target === undefined ? {} : { command: boundedMessageText(target) }),
            phase: "started",
            evidence,
          }),
        ];
      }
      if (subtype === "completed") {
        const open = openTools.get(itemId);
        openTools.delete(itemId);
        const verdict = toolOutcome(outcome);
        return [
          emit(verdict.failed ? "tool.failed" : "tool.completed", {
            itemId,
            toolKind: open?.kind ?? kind,
            name: open?.kind ?? kind,
            ...(target === undefined ? {} : { command: boundedMessageText(target) }),
            ...(verdict.status === undefined ? {} : { status: verdict.status }),
            ...(verdict.exitCode === undefined ? {} : { exitCode: verdict.exitCode }),
            phase: "completed",
            evidence,
          }),
        ];
      }
      return [];
    }

    if (type === "result") {
      sawResult = true;
      if (isObject(parsed.usage)) usage = sanitizedUsage(parsed.usage);
      const isError = parsed.is_error === true;
      const subtype = stringValue(parsed.subtype) ?? "";
      if (isError || (subtype.length > 0 && subtype !== "success")) {
        terminalFailure = boundedMessageText(
          stringValue(parsed.result) ?? `Cursor Agent ended with ${subtype || "an error"}.`,
        );
      }
      return [];
    }

    return [diagnostic("info", "cursor.unknown_event", `Unhandled Cursor record: ${type}`, evidence)];
  }

  return {
    get runtimeThreadId() {
      return runtimeThreadId;
    },
    get finalized() {
      return finalized;
    },

    accept(record: RuntimeJsonlRecord): readonly NormalizedRuntimeEvent[] {
      if (finalized) return [];
      let parsed: unknown;
      try {
        parsed = JSON.parse(record.raw) as unknown;
      } catch {
        return [
          diagnostic("warning", "cursor.malformed_record", "A Cursor record could not be parsed.", malformedEvidence(record)),
        ];
      }
      if (!isObject(parsed)) {
        return [
          diagnostic("warning", "cursor.malformed_record", "A Cursor record was not an object.", malformedEvidence(record)),
        ];
      }
      return acceptParsed(record, parsed);
    },

    finish(completion: RuntimeProcessCompletion): readonly NormalizedRuntimeEvent[] {
      if (finalized) return [];
      finalized = true;
      const process = processEvidence(completion);
      const thread = runtimeThreadId === undefined ? {} : { runtimeThreadId };
      if (completion.cancelled) {
        return [emit("run.cancelled", { ...thread, process })];
      }
      if (terminalFailure !== undefined) {
        return [
          emit("run.failed", {
            kind: "unknown",
            message: terminalFailure,
            ...thread,
            runtimeTerminal: "failed",
            process,
          }),
        ];
      }
      if (!sawResult || completion.exitCode !== 0) {
        return [
          emit("run.failed", {
            kind: "process-failed",
            message: sawResult
              ? `Cursor Agent exited with code ${String(completion.exitCode)}.`
              : "Cursor Agent ended without a terminal result record.",
            ...thread,
            runtimeTerminal: sawResult ? "completed" : "missing",
            process,
          }),
        ];
      }
      return [emit("run.completed", { ...thread, ...(usage === undefined ? {} : { usage }), process })];
    },
  };
}
