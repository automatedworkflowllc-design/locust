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
import type { RuntimeJsonlRecord, RuntimeProcessCompletion } from "./process-runner.js";

/**
 * Antigravity CLI's `--output-format stream-json` -> product events (0.540).
 *
 * MEASURED 2026-10-02, agy 1.2.14 on Windows, Gemini 3.8 Flash (Low), in a
 * scratch folder; the captures are the fixtures in
 * `test/agy-events.test.ts`. What was seen:
 *
 * - `{"event":"init","conversation_id",...,"init":{"model","cwd","tools",
 *   "permission_mode"}}` first. The conversation id is what `--conversation`
 *   takes back, known from the first record.
 * - `{"event":"step_update","step_update":{"step_index","state","step_type",...}}`
 *   for everything after. `step_type` is `user_input` (the prompt read back),
 *   `agent_response` (the model; `text_delta` while ACTIVE and on the DONE
 *   record, and `usage` on DONE; a DONE with no text is a planning step), or
 *   `tool` (`tool_name`, `tool_info.parameters`, and `tool_info.output` on
 *   DONE). A tool goes ACTIVE, then DONE or ERROR.
 * - A tool the mode does not allow is ERROR, and the run's `result` names it
 *   in `denied_actions` -- `write_file` under the default mode, `command`
 *   under `--mode accept-edits`. The run itself still says SUCCESS.
 * - `{"event":"result","result":{"status","response","usage",...}}` ends the
 *   turn: `SUCCESS` with the whole answer in `response`, or `ERROR` with an
 *   `error` (an unknown model, an empty prompt).
 * - The reasoning TEXT never appears; only `thinking_tokens` in `usage`. So
 *   nothing here could persist hidden chain-of-thought even by mistake.
 */

export interface AgyInvocationContext {
  readonly runId: string;
  readonly missionId?: string;
  readonly requestedRouteId?: string;
  readonly resolvedRouteId?: string;
  readonly cliVersion?: string;
  readonly now?: () => Date;
}

export interface AgyEventNormalizer {
  readonly runtimeThreadId: string | undefined;
  readonly finalized: boolean;
  accept(record: RuntimeJsonlRecord): readonly NormalizedRuntimeEvent[];
  finish(completion: RuntimeProcessCompletion): readonly NormalizedRuntimeEvent[];
}

type JsonObject = Record<string, unknown>;

/** What a tool was pointed at, in the parameter names agy prints. */
export function agyToolTarget(parameters: unknown): string | undefined {
  if (!isObject(parameters)) return undefined;
  for (const key of ["CommandLine", "AbsolutePath", "TargetFile", "Url", "Query", "SearchPath", "DirectoryPath"]) {
    const value = stringValue(parameters[key]);
    if (value !== undefined && value.trim().length > 0) return value;
  }
  return undefined;
}

/** A denied action, said for a person: what Antigravity was stopped from doing, and how to let it. */
export function agyDeniedSentence(actions: readonly string[]): string | undefined {
  if (actions.length === 0) return undefined;
  const writes = actions.some((action) => /write|edit|file/i.test(action));
  const commands = actions.some((action) => /command/i.test(action));
  if (commands && !writes) return "Antigravity was not allowed to run a command in this mode. Edit lets it change files but not run commands; Auto lets it do both.";
  if (writes && !commands) return "Antigravity was not allowed to change files in this mode. Choose Edit or Auto to let it.";
  return `Antigravity was not allowed to do everything it tried in this mode (${actions.join(", ")}). Choose Auto to let it.`;
}

export function createAgyEventNormalizer(context: AgyInvocationContext): AgyEventNormalizer {
  const runId = requireContextText(context.runId, "runId");
  const cliVersion = context.cliVersion === undefined ? undefined : requireContextText(context.cliVersion, "cliVersion");
  const now = context.now ?? (() => new Date());

  let runtimeThreadId: string | undefined;
  let normalizedSequence = 0;
  let finalized = false;
  let turnOpen = false;
  /** The `result` record, once it arrives. */
  let status: string | undefined;
  let resultError: string | undefined;
  let usage: { readonly inputTokens: number; readonly outputTokens: number } | undefined;
  /** The message item each agent_response step writes into, newest last. */
  let lastMessageItem: string | undefined;
  const openTools = new Set<number>();

  const emit = <TType extends NormalizedRuntimeEventType>(type: TType, payload: NormalizedRuntimePayloadMap[TType]): NormalizedRuntimeEvent => {
    normalizedSequence += 1;
    return {
      id: `${runId}:antigravity:${normalizedSequence}`,
      runId,
      ...(context.missionId === undefined ? {} : { missionId: context.missionId }),
      sequence: normalizedSequence,
      occurredAt: now().toISOString(),
      sourceAdapter: "antigravity",
      ...(cliVersion === undefined ? {} : { cliVersion }),
      ...(context.requestedRouteId === undefined ? {} : { requestedRouteId: context.requestedRouteId }),
      ...(context.resolvedRouteId === undefined ? {} : { resolvedRouteId: context.resolvedRouteId }),
      ...(runtimeThreadId === undefined ? {} : { runtimeThreadId }),
      type,
      payload,
    } as NormalizedRuntimeEvent;
  };
  const diagnostic = (level: "info" | "warning" | "error", code: string, message: string, evidence: CodexEventEvidence): NormalizedRuntimeEvent =>
    emit("adapter.diagnostic", { level, code, message, terminal: false, evidence });

  const toolRow = (index: number, step: JsonObject) => {
    const name = stringValue(step.tool_name) ?? "tool";
    const info = isObject(step.tool_info) ? step.tool_info : {};
    const target = agyToolTarget(info.parameters);
    return { itemId: `tool_${String(index)}`, toolKind: name, name, ...(target === undefined ? {} : { command: boundedMessageText(target) }) };
  };

  function acceptStep(step: JsonObject, evidence: CodexEventEvidence): readonly NormalizedRuntimeEvent[] {
    const index = typeof step.step_index === "number" ? step.step_index : undefined;
    const type = stringValue(step.step_type);
    const state = stringValue(step.state);
    if (index === undefined || type === undefined) return [];
    // The prompt, read back: the ledger already has the person's own words.
    if (type === "user_input") return [];

    if (type === "agent_response") {
      const text = stringValue(step.text_delta);
      if (text === undefined || text.length === 0) return [];
      lastMessageItem = `msg_${String(index)}`;
      return [emit("message.delta", { itemId: lastMessageItem, operation: "append", text: boundedMessageText(text), final: false, evidence })];
    }

    if (type === "tool") {
      const row = toolRow(index, step);
      const events: NormalizedRuntimeEvent[] = [];
      if (state === "ACTIVE") {
        if (!openTools.has(index)) {
          openTools.add(index);
          events.push(emit("tool.started", { ...row, phase: "started", evidence }));
        }
        return events;
      }
      // A step seen only when it ended still opens before it closes, so every row reads the same.
      if (!openTools.has(index)) events.push(emit("tool.started", { ...row, phase: "started", evidence }));
      openTools.delete(index);
      const info = isObject(step.tool_info) ? step.tool_info : {};
      const output = stringValue(info.output);
      const seconds = typeof step.duration_seconds === "number" ? step.duration_seconds : undefined;
      const ended = {
        ...row,
        ...(output === undefined ? {} : { output: boundedMessageText(output) }),
        ...(seconds === undefined ? {} : { durationMs: Math.round(seconds * 1000) }),
        phase: "completed" as const,
        evidence,
      };
      events.push(state === "DONE" ? emit("tool.completed", ended) : emit("tool.failed", { ...ended, status: state === "ERROR" ? "refused or failed" : (state ?? "unknown") }));
      return events;
    }
    return [];
  }

  function acceptParsed(record: RuntimeJsonlRecord, parsed: JsonObject): readonly NormalizedRuntimeEvent[] {
    const kind = stringValue(parsed.event);
    if (kind === undefined) return [];
    const evidence = evidenceFor(record, parsed, kind);

    if (kind === "init") {
      runtimeThreadId = runtimeThreadId ?? identityValue(parsed.conversation_id);
      if (turnOpen) return [];
      turnOpen = true;
      return [emit("step.started", { stepKind: "turn", evidence })];
    }

    if (kind === "step_update") {
      const step = isObject(parsed.step_update) ? parsed.step_update : undefined;
      if (step === undefined) return [];
      runtimeThreadId = runtimeThreadId ?? identityValue(step.conversation_id);
      return acceptStep(step, evidence);
    }

    if (kind === "result") {
      const result = isObject(parsed.result) ? parsed.result : {};
      runtimeThreadId = runtimeThreadId ?? identityValue(result.conversation_id);
      status = stringValue(result.status) ?? "UNKNOWN";
      resultError = stringValue(result.error);
      const counted = isObject(result.usage) ? result.usage : undefined;
      if (counted !== undefined && typeof counted.input_tokens === "number" && typeof counted.output_tokens === "number") {
        usage = { inputTokens: counted.input_tokens, outputTokens: counted.output_tokens };
      }
      const events: NormalizedRuntimeEvent[] = [];
      // The whole answer, from agy's own last word, replaces what the deltas built.
      const response = stringValue(result.response);
      if (response !== undefined && response.trim().length > 0) {
        events.push(emit("message.delta", { itemId: lastMessageItem ?? "msg_final", operation: "replace", text: boundedMessageText(response), final: true, evidence }));
      }
      const denied = Array.isArray(result.denied_actions)
        ? result.denied_actions.flatMap((entry) => (isObject(entry) && typeof entry.action === "string" ? [entry.action] : []))
        : [];
      const said = agyDeniedSentence(denied);
      if (said !== undefined) events.push(diagnostic("warning", "antigravity.denied_actions", said, evidence));
      if (turnOpen) {
        turnOpen = false;
        events.push(emit("step.completed", { stepKind: "turn", evidence }));
      }
      return events;
    }
    return [diagnostic("info", "antigravity.unknown_event", `Unhandled Antigravity CLI record: ${kind}`, evidence)];
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
        parsed = JSON.parse(record.raw.replace(/^﻿/, "")) as unknown;
      } catch {
        return [diagnostic("warning", "antigravity.malformed_record", "An Antigravity CLI record could not be parsed.", malformedEvidence(record))];
      }
      if (!isObject(parsed)) return [diagnostic("warning", "antigravity.malformed_record", "An Antigravity CLI record was not an object.", malformedEvidence(record))];
      return acceptParsed(record, parsed);
    },
    finish(completion: RuntimeProcessCompletion): readonly NormalizedRuntimeEvent[] {
      if (finalized) return [];
      finalized = true;
      const process = processEvidence(completion);
      const thread = runtimeThreadId === undefined ? {} : { runtimeThreadId };
      if (completion.cancelled) return [emit("run.cancelled", { ...thread, process })];
      if (status === "SUCCESS" && completion.exitCode === 0) {
        return [emit("run.completed", { ...thread, ...(usage === undefined ? {} : { usage }), process })];
      }
      return [
        emit("run.failed", {
          kind: "process-failed",
          message: completion.outputLimitExceeded
            ? "Antigravity sent output faster than Locust could record it, so the run was stopped rather than leave a gap in its record. Sending it again usually works."
            : status === undefined
              ? "Antigravity ended without a record saying the run had finished."
              : resultError !== undefined
                ? `Antigravity could not run it: ${resultError.split(/\r?\n/)[0]}`
                : `Antigravity ended ${status.toLowerCase()}${completion.exitCode === 0 ? "" : ` (exit code ${String(completion.exitCode)})`}.`,
          ...thread,
          runtimeTerminal: status === undefined ? "missing" : status === "SUCCESS" ? "completed" : "failed",
          process,
        }),
      ];
    },
  };
}
