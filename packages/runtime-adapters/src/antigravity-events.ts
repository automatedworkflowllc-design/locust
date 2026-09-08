import {
  evidenceFor,
  identityValue,
  isObject,
  malformedEvidence,
  processEvidence,
  redactText,
  requireContextText,
  stringValue,
} from "./codex-events.js";
import type {
  CodexEventEvidence,
  NormalizedRuntimeEvent,
  NormalizedRuntimeEventType,
  NormalizedRuntimePayloadMap,
  ToolPatch,
} from "./codex-events.js";
import { addedFilePatch } from "./opencode-events.js";
import type {
  RuntimeJsonlRecord,
  RuntimeProcessCompletion,
} from "./process-runner.js";

/**
 * Antigravity transcript lines -> product events. EXPERIMENTAL.
 *
 * Google's Antigravity IDE has no streaming CLI. Its `language_server.exe`
 * takes `agentapi new-conversation` / `send-message`, and everything the agent
 * then does appears in a file: one JSON object per line, appended as each step
 * completes, at
 * `~/.gemini/antigravity/brain/<conversationId>/.system_generated/logs/transcript.jsonl`.
 * The host tails that file and feeds this normalizer one line at a time; there
 * is no process whose stdout these arrive on, which is why `accept` is built to
 * survive being handed the same line again (see `seen`).
 *
 * Every shape below was measured on 2026-09-03 against TWO conversations, kept
 * verbatim in `test/fixtures/antigravity/`: a prompt answered in one word, and
 * a prompt that wrote a file and was then continued with `send-message`. Two
 * conversations is a thin basis, and the places that matter are called out.
 *
 * What was measured, and what it means here:
 *
 * - Each line carries `step_index`, `source`, `type`, `status` and `created_at`,
 *   then EITHER `content` (a string) OR `thinking` plus `tool_calls`.
 * - `USER_INPUT` (source `USER_EXPLICIT`) is the prompt the host already sent.
 *   `CHECKPOINT` (source `SYSTEM`) is Antigravity's own running summary of the
 *   conversation -- in the captures it names the objective, the user's requests
 *   and the path of the full log, and on a long conversation it would hold far
 *   more. Neither produces an event, and neither is ever copied into evidence:
 *   the checkpoint is the whole conversation in one field, and the ledger is
 *   not where it belongs.
 * - `PLANNER_RESPONSE` (source `MODEL`) is the model's turn. With `thinking` it
 *   is reasoning, and the reasoning TEXT never reaches the ledger -- the record
 *   is rebuilt without the field before evidence is taken, exactly as Cursor's
 *   thinking deltas and Codex's reasoning items are handled.
 * - `GENERIC` (source `MODEL`) carries a tool's result text. It does not name
 *   the tool it belongs to, so it is attached to the most recently opened call.
 *   With nothing open there is no honest attachment to make, and a diagnostic
 *   says so rather than a tool call being invented to hang it on.
 * - A `PLANNER_RESPONSE` with `content` and no `tool_calls` is the final answer,
 *   whether or not it also carries `thinking` -- a model that reasons and
 *   answers in one step is still answering (measured 2026-09-06; requiring no
 *   reasoning here is what left a live run's stop button on screen).
 *   That it also means the turn is OVER is a HEURISTIC: it held in both captured
 *   conversations and there is no terminal record of any kind in the file, so
 *   nothing better was available. It is exposed as `latestFinal` rather than
 *   acted on here, because the host is the one polling and only the host can
 *   decide it has waited long enough.
 * - `send-message` does NOT append a `USER_INPUT` line. Measured: the message
 *   arrives as source `SYSTEM`, type `SYSTEM_MESSAGE`, wrapped in a
 *   `<SYSTEM_MESSAGE>` envelope that tells the model it was "not actually sent
 *   by the user". It is the host's own send coming back, so it produces no
 *   event -- but it is recognised, so a follow-up is never reported as a line
 *   this adapter could not read.
 * - `status` was `DONE` on every line captured. Anything else is treated as a
 *   step still running: nothing is emitted and the index is NOT marked seen, so
 *   the host re-reads the same line once it settles and it is normalized then.
 *
 * Types not seen at all: the file only ever showed the four above. An unknown
 * type is preserved as a diagnostic rather than dropped.
 */

export interface AntigravityInvocationContext {
  /** Product-owned run identifier. Never the conversation id. */
  readonly runId: string;
  readonly missionId?: string;
  readonly requestedRouteId?: string;
  readonly resolvedRouteId?: string;
  readonly cliVersion?: string;
  /**
   * The id `new-conversation` printed. The transcript never repeats it -- it is
   * only in the DIRECTORY NAME the file sits under -- so the host, which owns
   * the conversation, is the only thing that can supply it.
   */
  readonly conversationId?: string;
  /** Test seam and host clock. */
  readonly now?: () => Date;
}

export interface AntigravityEventNormalizer {
  readonly runtimeThreadId: string | undefined;
  readonly finalized: boolean;
  /**
   * Whether the last line accepted was a planner answer with no tool calls.
   * The host's completion signal; see the heuristic note above.
   */
  readonly latestFinal: boolean;
  /**
   * The name of a tool that started and never reported back, if any.
   *
   * Exists for one reason: when a run goes quiet, the host has to say WHY, and
   * "the agent wrote nothing for ten minutes" blames the model for a silence
   * the app caused. Antigravity's native `ask_question` shows up here as a
   * tool that is still running -- it is waiting for an answer through a
   * channel Locust does not collect -- and a timeout that can name it can say
   * so instead (see `docs/FINDING-antigravity-ask-question.md`).
   */
  readonly pendingToolName: string | undefined;
  accept(record: RuntimeJsonlRecord): readonly NormalizedRuntimeEvent[];
  finish(completion: RuntimeProcessCompletion): readonly NormalizedRuntimeEvent[];
}

type JsonObject = Record<string, unknown>;

/** Lines that are the host's own words coming back, or Antigravity's private summary. */
const SILENT_TYPES = new Set(["USER_INPUT", "CHECKPOINT", "SYSTEM_MESSAGE"]);

/**
 * One tool argument, decoded.
 *
 * Measured: every value in `tool_calls[].args` is a JSON-ENCODED string, not
 * the value itself -- `"Overwrite":"true"` is the four characters `true`, and
 * `"TargetFile":"\"c:/…/hello.txt\""` is a quoted string inside a string. So a
 * caller comparing `args.Overwrite` to `true` would never match, and one using
 * `args.TargetFile` as a path would carry the quotes into the ledger. A value
 * that does not parse is returned as it arrived rather than discarded.
 */
export function antigravityToolArg(args: unknown, key: string): unknown {
  if (!isObject(args)) return undefined;
  const raw = args[key];
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function decodedString(args: unknown, key: string): string | undefined {
  const value = antigravityToolArg(args, key);
  return typeof value === "string" ? stringValue(value) : undefined;
}

/** Collapse to a single line: the ledger renders `command` on one row. */
function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * A bounded one-line summary of what a call acted on.
 *
 * `TargetFile` first because it is the fact; `toolAction` and `toolSummary` are
 * the model's own phrasing of it, which is better than nothing when a tool this
 * build has never seen carries no path.
 */
export function antigravityToolCommand(args: unknown): string | undefined {
  const target = decodedString(args, "TargetFile")
    ?? decodedString(args, "toolAction")
    ?? decodedString(args, "toolSummary")
    ?? decodedString(args, "Description");
  if (target === undefined) return undefined;
  const line = oneLine(target);
  return line.length === 0 ? undefined : redactText(line);
}

/**
 * The change a `write_to_file` call made, when it can be reconstructed.
 *
 * `Overwrite: true` is the only case captured, and in it Antigravity reports NO
 * before-text anywhere -- not in the call, not in the `GENERIC` result. So an
 * overwrite records the path and no patch, the way a Codex `file_change` does;
 * a diff built from `CodeContent` alone would claim every line was added when
 * most of them may not have changed at all.
 *
 * Without `Overwrite`, the file is treated as new and `CodeContent` becomes the
 * added-file diff. That branch was NOT measured -- no captured call omitted the
 * flag -- and it is the one place here that rests on the flag meaning what it
 * is named rather than on something observed.
 */
export function antigravityWritePatch(args: unknown): ToolPatch | undefined {
  const overwrite = antigravityToolArg(args, "Overwrite") === true;
  if (overwrite) return undefined;
  const target = decodedString(args, "TargetFile");
  const content = decodedString(args, "CodeContent");
  if (target === undefined || content === undefined) return undefined;
  // `false` is the literal claim "the file did not exist", which is what
  // `addedFilePatch` refuses to build a diff without.
  return addedFilePatch(target, content, false);
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Evidence for a planner line, with the model's reasoning removed.
 *
 * The field is DELETED rather than blanked, so the ledger does not even record
 * that a `thinking` key was there. `sanitizeJson` would blank it anyway; that
 * is a backstop, and a backstop is not a reason to hand it the text.
 */
function plannerEvidence(
  record: RuntimeJsonlRecord,
  parsed: JsonObject,
  type: string,
): CodexEventEvidence {
  if (parsed.thinking === undefined) return evidenceFor(record, parsed, type);
  const { thinking: _reasoning, ...rest } = parsed;
  return { ...evidenceFor(record, rest, type), redacted: true };
}

interface OpenTool {
  readonly itemId: string;
  readonly toolKind: string;
  readonly name: string;
  readonly command?: string;
}

export function createAntigravityEventNormalizer(
  context: AntigravityInvocationContext,
): AntigravityEventNormalizer {
  const runId = requireContextText(context.runId, "runId");
  const cliVersion = context.cliVersion === undefined
    ? undefined
    : requireContextText(context.cliVersion, "cliVersion");
  const runtimeThreadId = context.conversationId === undefined
    ? undefined
    : identityValue(requireContextText(context.conversationId, "conversationId"));
  const now = context.now ?? (() => new Date());

  let normalizedSequence = 0;
  let finalized = false;
  let latestFinal = false;
  /**
   * Step indexes already turned into events. The host re-reads the transcript
   * from the top on every poll, so without this every poll would replay the
   * whole conversation into the ledger.
   */
  const seen = new Set<number>();
  /** Calls opened by a planner line and not yet closed by a `GENERIC` result. */
  const openTools: OpenTool[] = [];

  const emit = <TType extends NormalizedRuntimeEventType>(
    type: TType,
    payload: NormalizedRuntimePayloadMap[TType],
  ): NormalizedRuntimeEvent => {
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

  const diagnostic = (
    level: "info" | "warning" | "error",
    code: string,
    message: string,
    evidence: CodexEventEvidence,
  ): NormalizedRuntimeEvent =>
    emit("adapter.diagnostic", { level, code, message, terminal: false, evidence });

  function plannerEvents(
    record: RuntimeJsonlRecord,
    parsed: JsonObject,
    stepIndex: number,
  ): readonly NormalizedRuntimeEvent[] {
    const evidence = plannerEvidence(record, parsed, "PLANNER_RESPONSE");
    const thinking = stringValue(parsed.thinking);
    const calls = Array.isArray(parsed.tool_calls) ? parsed.tool_calls : [];
    const content = stringValue(parsed.content);

    if (calls.length === 0 && content === undefined && thinking === undefined) {
      return [
        diagnostic(
          "info",
          "antigravity.empty_planner_response",
          "An Antigravity planner line carried neither content, reasoning nor tool calls.",
          evidence,
        ),
      ];
    }

    if (calls.length === 0 && content !== undefined) {
      // The completion signal. See the heuristic note at the top of the file.
      //
      // MEASURED 2026-09-06, on a stuck run of Colin's: this used to require
      // `thinking === undefined` as well, and a `flash` model that reasons and
      // answers in the SAME step therefore never looked final. The transcript
      // ended on a planner answer, the run stayed live until the idle timeout,
      // and the composer kept its stop button ("antigravity models with stop
      // button stuck after its done with output"). Both captured conversations
      // ended on an answer with no reasoning beside it, so no fixture could
      // have shown this. Reasoning in the same step is still drawn as its own
      // step; what it is not is a reason to keep waiting.
      latestFinal = true;
      const events: NormalizedRuntimeEvent[] = [];
      if (thinking !== undefined) {
        events.push(emit("step.started", { stepKind: "reasoning", evidence }));
        events.push(emit("step.completed", { stepKind: "reasoning", evidence }));
      }
      events.push(
        emit("message.delta", {
          itemId: `msg_${String(stepIndex)}`,
          operation: "replace",
          text: redactText(content),
          final: true,
          evidence,
        }),
      );
      return events;
    }

    latestFinal = false;
    const events: NormalizedRuntimeEvent[] = [];
    if (thinking !== undefined) {
      // Opened AND closed here: the transcript has no separate line saying the
      // model stopped thinking, so a step left open would never be closed.
      events.push(emit("step.started", { stepKind: "reasoning", evidence }));
      events.push(emit("step.completed", { stepKind: "reasoning", evidence }));
    }
    calls.forEach((call, index) => {
      if (!isObject(call)) return;
      const name = identityValue(call.name) ?? "tool";
      const args = call.args;
      // No captured call carried an id of any kind, so the position in the file
      // is the only stable handle: the same line re-read yields the same id.
      const itemId = identityValue(call.id)
        ?? identityValue(call.call_id)
        ?? identityValue(call.toolCallId)
        ?? `tool_${String(stepIndex)}_${String(index)}`;
      /*
       * `ask_question` says what it is asking, on the row.
       *
       * It used to read "Prompting user with options · ask_question · still
       * running" while the run sat blocked for the full idle timeout, and the
       * question and its four options were in the record the whole time
       * (`docs/FINDING-antigravity-ask-question.md`, Colin's screenshot).
       *
       * Locust cannot ANSWER it -- measured 2026-09-08: an answer is a tool
       * completion the IDE writes as `A1: <text>`, while the only channel
       * Locust has, `agentapi send-message`, arrives as a SYSTEM_MESSAGE
       * labelled "not actually sent by the user". So this row does the one
       * honest thing available: it shows what is being asked, and says where
       * the answer has to go. A person who can read the question in Locust can
       * go and answer it; a person reading a spinner cannot.
       */
      const asked = name === "ask_question" ? antigravityQuestion(args) : undefined;
      const command = asked === undefined
        ? antigravityToolCommand(args)
        : oneLine(
            asked.options.length === 0
              ? `${asked.question} — answer in Antigravity`
              : `${asked.question} — ${asked.options.join(" / ")} — answer in Antigravity`,
          );
      const open: OpenTool = {
        itemId,
        toolKind: name,
        name,
        ...(command === undefined ? {} : { command }),
      };
      openTools.push(open);
      const patch = name === "write_to_file" ? antigravityWritePatch(args) : undefined;
      events.push(
        emit("tool.started", {
          ...open,
          ...(patch === undefined ? {} : { patch }),
          phase: "started",
          evidence,
        }),
      );
    });
    if (content !== undefined) {
      // Content beside tool calls was never captured. It is delivered, but not
      // as a final answer: the turn plainly is not over if a tool just started.
      events.push(
        emit("message.delta", {
          itemId: `msg_${String(stepIndex)}`,
          operation: "replace",
          text: redactText(content),
          final: false,
          evidence,
        }),
      );
    }
    return events;
  }

  function acceptParsed(
    record: RuntimeJsonlRecord,
    parsed: JsonObject,
  ): readonly NormalizedRuntimeEvent[] {
    const type = stringValue(parsed.type);
    const stepIndex = numberValue(parsed.step_index);
    if (type === undefined || stepIndex === undefined) {
      return [
        diagnostic(
          "warning",
          "antigravity.malformed_record",
          "An Antigravity transcript line had no step_index or no type.",
          malformedEvidence(record),
        ),
      ];
    }
    if (seen.has(stepIndex)) return [];
    // A step that has not finished will be appended again with its result; the
    // index stays unseen so the settled version is the one that is normalized.
    if (stringValue(parsed.status) !== "DONE") return [];
    seen.add(stepIndex);

    if (SILENT_TYPES.has(type)) {
      // A new user or system turn means the previous final answer no longer
      // ends the conversation.
      latestFinal = false;
      return [];
    }

    if (type === "PLANNER_RESPONSE") return plannerEvents(record, parsed, stepIndex);

    if (type === "GENERIC" && stringValue(parsed.source) === "MODEL") {
      latestFinal = false;
      const evidence = evidenceFor(record, parsed, type);
      const open = openTools.pop();
      if (open === undefined) {
        return [
          diagnostic(
            "info",
            "antigravity.unattached_result",
            "An Antigravity tool result arrived with no tool call open to attach it to.",
            evidence,
          ),
        ];
      }
      const content = stringValue(parsed.content);
      return [
        emit("tool.completed", {
          ...open,
          ...(content === undefined ? {} : { output: redactText(content) }),
          phase: "completed",
          evidence,
        }),
      ];
    }

    latestFinal = false;
    return [
      diagnostic(
        "info",
        "antigravity.unknown_step",
        `Unhandled Antigravity transcript line: ${redactText(type)}`,
        evidenceFor(record, parsed, type),
      ),
    ];
  }

  return {
    get runtimeThreadId() {
      return runtimeThreadId;
    },
    get finalized() {
      return finalized;
    },
    get latestFinal() {
      return latestFinal;
    },
    get pendingToolName() {
      return openTools[openTools.length - 1]?.name;
    },

    accept(record: RuntimeJsonlRecord): readonly NormalizedRuntimeEvent[] {
      if (finalized) return [];
      let parsed: unknown;
      try {
        parsed = JSON.parse(record.raw) as unknown;
      } catch {
        return [
          diagnostic("warning", "antigravity.malformed_record", "An Antigravity transcript line could not be parsed.", malformedEvidence(record)),
        ];
      }
      if (!isObject(parsed)) {
        return [
          diagnostic("warning", "antigravity.malformed_record", "An Antigravity transcript line was not an object.", malformedEvidence(record)),
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
      // A host that only tails the file owns no process and reports no exit
      // code; a number that is not zero is the host saying its own driver died,
      // and that outranks whatever the transcript got to.
      if (typeof completion.exitCode === "number" && completion.exitCode !== 0) {
        return [
          emit("run.failed", {
            kind: "process-failed",
            message: `The Antigravity language server exited with code ${String(completion.exitCode)}.`,
            ...thread,
            runtimeTerminal: latestFinal ? "completed" : "missing",
            process,
          }),
        ];
      }
      if (!latestFinal) {
        return [
          emit("run.failed", {
            kind: "process-failed",
            message: "The Antigravity transcript never ended on a planner answer with no tool calls, so the host stopped waiting for one.",
            ...thread,
            runtimeTerminal: "missing",
            process,
          }),
        ];
      }
      return [emit("run.completed", { ...thread, process })];
    },
  };
}

/** One question Antigravity's `ask_question` put to the person. */
export interface AntigravityQuestion {
  readonly question: string;
  readonly options: readonly string[];
  readonly multiSelect: boolean;
}

/**
 * The question inside an `ask_question` call, or undefined when there is none.
 *
 * Locust drew this tool as a bare row -- "Prompting user with options ·
 * ask_question · still running" -- while the run sat blocked for the full idle
 * timeout (`docs/FINDING-antigravity-ask-question.md`). The question and its
 * options were in the record the whole time; nothing read them.
 *
 * Reading them is worth doing even though Locust CANNOT answer. Measured
 * 2026-09-08 against real transcripts: an answer arrives as a MODEL/GENERIC
 * record whose content is `A1: <text>` -- a tool COMPLETION, written when the
 * IDE resolves the card -- while `agentapi send-message`, the only channel
 * Locust has, arrives as a SYSTEM_MESSAGE explicitly labelled "not actually
 * sent by the user". Those are two different transports, and only the first
 * one ends the tool.
 *
 * So the honest thing is to show the person exactly what is being asked and
 * where to answer it, instead of a row that names a tool and a spinner.
 *
 * `args.questions` is a JSON-encoded ARRAY, and every value in an Antigravity
 * `args` is JSON-encoded (see `antigravityToolArg`). Only the first question is
 * returned: both measured payloads carry exactly one, and inventing a
 * multi-question UI for a shape never observed would be building for a guess.
 */
export function antigravityQuestion(args: unknown): AntigravityQuestion | undefined {
  const decoded = antigravityToolArg(args, "questions");
  const first = Array.isArray(decoded) ? decoded[0] : undefined;
  if (!isObject(first)) return undefined;
  const question = stringValue(first.question);
  if (question === undefined || question.length === 0) return undefined;
  // A question with no options is still a question. It is the OPTIONS that are
  // optional, not the asking -- so an empty list draws a question and no
  // buttons rather than nothing at all.
  const options = Array.isArray(first.options)
    ? first.options.filter((option): option is string => typeof option === "string" && option.length > 0)
    : [];
  return { question, options, multiSelect: first.is_multi_select === true };
}
