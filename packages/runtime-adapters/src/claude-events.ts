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
} from "./codex-events.js";
import type {
  RuntimeJsonlRecord,
  RuntimeProcessCompletion,
} from "./process-runner.js";

/**
 * Claude Code JSONL -> product events.
 *
 * Mirrors the Codex normalizer and reuses its sanitizers rather than copying
 * them. Every shape here was measured against claude-code 2.1.252 under the
 * exact argv `createClaudePrintCommand` produces -- see
 * `docs/HANDOFF-claude-adapter.md` for the captured stream.
 */

export interface ClaudeInvocationContext {
  /** Product-owned run identifier. Never the provider's session id. */
  readonly runId: string;
  readonly missionId?: string;
  readonly requestedRouteId?: string;
  readonly resolvedRouteId?: string;
  readonly cliVersion?: string;
  /** Test seam and host clock. */
  readonly now?: () => Date;
}

export interface ClaudeEventNormalizer {
  readonly runtimeThreadId: string | undefined;
  readonly finalized: boolean;
  accept(record: RuntimeJsonlRecord): readonly NormalizedRuntimeEvent[];
  finish(completion: RuntimeProcessCompletion): readonly NormalizedRuntimeEvent[];
}

type JsonObject = Record<string, unknown>;

/**
 * `system`/`init` is an environment dump: on the machine this was measured on
 * it listed every connected MCP server by name with auth status, every slash
 * command, every skill and agent, a local named-pipe path and the PowerShell
 * path. None of those keys look sensitive to a pattern matcher, and the ledger
 * is durable on disk -- so this record is allow-listed rather than redacted,
 * and counts replace the name lists.
 */
const INIT_ALLOWED_KEYS = new Set([
  "session_id",
  "model",
  "permissionMode",
  "cwd",
  "claude_code_version",
  "output_style",
  "apiKeySource",
]);

export function summarizeInit(value: unknown): JsonObject {
  if (!isObject(value)) return {};
  const summary: JsonObject = {};
  for (const key of INIT_ALLOWED_KEYS) {
    const held = value[key];
    if (typeof held === "string" || typeof held === "number" || typeof held === "boolean") {
      summary[key] = typeof held === "string" ? identityValue(held) ?? "" : held;
    }
  }
  // Counts, never the names.
  for (const [key, label] of [
    ["tools", "toolCount"],
    ["mcp_servers", "mcpServerCount"],
    ["slash_commands", "slashCommandCount"],
    ["agents", "agentCount"],
    ["skills", "skillCount"],
  ] as const) {
    const held = value[key];
    if (Array.isArray(held)) summary[label] = held.length;
  }
  return summary;
}

/**
 * A rate-limit record. `allowed_warning` is a WARNING, not exhaustion --
 * treating it as exhaustion would fall back to a worse model on every long
 * session while the good one still works.
 */
export function limitKindFor(status: unknown): "quota-exhausted" | "temporary-rate-limit" {
  const text = typeof status === "string" ? status.toLowerCase() : "";
  if (text.includes("allowed")) return "temporary-rate-limit";
  if (text.length === 0) return "temporary-rate-limit";
  return "quota-exhausted";
}

/** `resetsAt` is epoch SECONDS, not milliseconds. */
export function resetsAtIso(value: unknown): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const milliseconds = value * 1000;
  if (!Number.isFinite(milliseconds)) return undefined;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function createClaudeEventNormalizer(
  context: ClaudeInvocationContext,
): ClaudeEventNormalizer {
  const runId = requireContextText(context.runId, "runId");
  const cliVersion = context.cliVersion === undefined
    ? undefined
    : requireContextText(context.cliVersion, "cliVersion");
  const now = context.now ?? (() => new Date());

  /** Text buffers per content block index, so a replace can be recognised. */
  const openTools = new Map<string, { name: string }>();
  let runtimeThreadId: string | undefined;
  let normalizedSequence = 0;
  let finalized = false;
  let sawResult = false;
  let terminalFailure: string | undefined;

  const emit = <TType extends NormalizedRuntimeEventType>(
    type: TType,
    payload: NormalizedRuntimePayloadMap[TType],
  ): NormalizedRuntimeEvent => {
    normalizedSequence += 1;
    return {
      id: `${runId}:claude:${normalizedSequence}`,
      runId,
      ...(context.missionId === undefined ? {} : { missionId: context.missionId }),
      sequence: normalizedSequence,
      occurredAt: now().toISOString(),
      sourceAdapter: "claude",
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
    const evidence = evidenceFor(record, parsed, type);

    if (type === "rate_limit_event") {
      const info = isObject(parsed.rate_limit_info) ? parsed.rate_limit_info : {};
      const kind = limitKindFor(info.status);
      const resets = resetsAtIso(info.resetsAt);
      const window = stringValue(info.rateLimitType) ?? "window";
      const status = stringValue(info.status) ?? "unknown";
      return [
        emit("route.limit_detected", {
          kind,
          message: boundedMessageText(
            `${window} limit ${status}${resets === undefined ? "" : ` · resets ${resets}`}`,
          ),
          evidence,
        }),
      ];
    }

    if (type === "system") {
      const subtype = stringValue(parsed.subtype);
      if (subtype === "init") {
        runtimeThreadId = identityValue(parsed.session_id);
        const summary = summarizeInit(parsed);
        return [
          emit("run.started", {
            runtimeThreadId: runtimeThreadId ?? "",
            // The allow-listed summary REPLACES the raw record: the untouched
            // one describes the user's machine and this ledger is durable.
            evidence: { ...evidence, raw: summary as never, redacted: true },
          }),
        ];
      }
      return [
        emit("step.started", {
          stepKind: "turn",
          ...(subtype === undefined ? {} : { status: subtype }),
          ...(stringValue(parsed.status) === undefined ? {} : { message: stringValue(parsed.status)! }),
          evidence,
        }),
      ];
    }

    if (type === "stream_event") {
      const inner = isObject(parsed.event) ? parsed.event : {};
      const innerType = stringValue(inner.type);
      if (innerType === "message_start") {
        return [emit("step.started", { stepKind: "turn", evidence })];
      }
      if (innerType === "content_block_start") {
        const block = isObject(inner.content_block) ? inner.content_block : {};
        if (stringValue(block.type) === "tool_use") {
          const itemId = identityValue(block.id) ?? `block_${String(inner.index ?? 0)}`;
          const name = identityValue(block.name) ?? "tool";
          openTools.set(itemId, { name });
          return [
            emit("tool.started", {
              itemId,
              toolKind: "tool_use",
              name,
              phase: "started",
              evidence,
            }),
          ];
        }
        return [];
      }
      if (innerType === "content_block_delta") {
        const delta = isObject(inner.delta) ? inner.delta : {};
        const text = stringValue(delta.text);
        if (text === undefined) return [];
        return [
          emit("message.delta", {
            itemId: `block_${String(inner.index ?? 0)}`,
            operation: "append",
            text: boundedMessageText(text),
            final: false,
            evidence,
          }),
        ];
      }
      if (innerType === "message_stop") {
        return [emit("step.completed", { stepKind: "turn", evidence })];
      }
      return [];
    }

    if (type === "assistant") {
      // TRAP: the text has already arrived as deltas. This record is the
      // complete message, so it REPLACES the buffer -- appending it would
      // double every answer, and the checkpoint's assistantSummary rebuilds
      // the buffer exactly this way, so the bug would reach the resume summary.
      const message = isObject(parsed.message) ? parsed.message : {};
      const content = Array.isArray(message.content) ? message.content : [];
      const text = content
        .map((block) => (isObject(block) ? stringValue(block.text) : undefined))
        .filter((value): value is string => value !== undefined)
        .join("");
      if (text.length === 0) return [];
      return [
        emit("message.delta", {
          itemId: "block_0",
          operation: "replace",
          text: boundedMessageText(text),
          final: true,
          evidence,
        }),
      ];
    }

    if (type === "user") {
      const message = isObject(parsed.message) ? parsed.message : {};
      const content = Array.isArray(message.content) ? message.content : [];
      const events: NormalizedRuntimeEvent[] = [];
      for (const block of content) {
        if (!isObject(block) || stringValue(block.type) !== "tool_result") continue;
        const itemId = identityValue(block.tool_use_id);
        if (itemId === undefined) continue;
        const open = openTools.get(itemId);
        openTools.delete(itemId);
        const failed = block.is_error === true;
        events.push(
          emit(failed ? "tool.failed" : "tool.completed", {
            itemId,
            toolKind: "tool_use",
            name: open?.name ?? "tool",
            phase: "completed",
            ...(failed ? { status: "error" } : {}),
            evidence,
          }),
        );
      }
      return events;
    }

    if (type === "result") {
      sawResult = true;
      const isError = parsed.is_error === true;
      const subtype = stringValue(parsed.subtype) ?? "";
      const reason = stringValue(parsed.terminal_reason) ?? subtype;
      if (isError || (subtype.length > 0 && subtype !== "success")) {
        terminalFailure = boundedMessageText(
          stringValue(parsed.result) ?? `Claude Code ended with ${reason || "an error"}.`,
        );
      }
      return [];
    }

    return [diagnostic("info", "claude.unknown_event", `Unhandled Claude record: ${type}`, evidence)];
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
          diagnostic(
            "warning",
            "claude.malformed_record",
            "A Claude record could not be parsed.",
            malformedEvidence(record),
          ),
        ];
      }
      if (!isObject(parsed)) {
        return [
          diagnostic(
            "warning",
            "claude.malformed_record",
            "A Claude record was not an object.",
            malformedEvidence(record),
          ),
        ];
      }
      return acceptParsed(record, parsed);
    },

    finish(completion: RuntimeProcessCompletion): readonly NormalizedRuntimeEvent[] {
      if (finalized) return [];
      finalized = true;
      const process = processEvidence(completion);
      if (completion.cancelled) {
        return [emit("run.cancelled", { ...(runtimeThreadId === undefined ? {} : { runtimeThreadId }), process })];
      }
      if (terminalFailure !== undefined) {
        return [
          emit("run.failed", {
            kind: "unknown",
            message: terminalFailure,
            ...(runtimeThreadId === undefined ? {} : { runtimeThreadId }),
            runtimeTerminal: "failed",
            process,
          }),
        ];
      }
      // A clean exit that never produced a `result` record is not a success:
      // the provider never said it finished, so the run is reported as failed
      // with that stated, rather than completed on the strength of exit 0.
      if (!sawResult || completion.exitCode !== 0) {
        return [
          emit("run.failed", {
            kind: "process-failed",
            message:
              sawResult
                ? `Claude Code exited with code ${String(completion.exitCode)}.`
                : "Claude Code ended without a terminal result record.",
            ...(runtimeThreadId === undefined ? {} : { runtimeThreadId }),
            runtimeTerminal: sawResult ? "completed" : "missing",
            process,
          }),
        ];
      }
      return [emit("run.completed", { ...(runtimeThreadId === undefined ? {} : { runtimeThreadId }), process })];
    },
  };
}
