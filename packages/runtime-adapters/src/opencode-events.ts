import {
  boundedMessageText,
  evidenceFor,
  identityValue,
  isObject,
  malformedEvidence,
  processEvidence,
  requireContextText,
  stringValue,
  toolPatchFrom,
} from "./codex-events.js";
import type {
  CodexEventEvidence,
  NormalizedRuntimeEvent,
  NormalizedRuntimeEventType,
  NormalizedRuntimePayloadMap,
  RedactedJsonValue,
  ToolPatch,
} from "./codex-events.js";
import type {
  RuntimeJsonlRecord,
  RuntimeProcessCompletion,
} from "./process-runner.js";
import { openCodeErrorFacts, openCodeErrorSentence } from "./opencode-error.js";
import type { OpenCodeErrorFacts } from "./opencode-error.js";

/**
 * OpenCode `run --format json` -> product events.
 *
 * Every shape here was measured against opencode-ai 1.18.27 on 2026-09-03,
 * under the argv `createOpenCodeRunCommand` produces. The captured streams are
 * the fixtures in `test/fixtures/opencode/`: a write-mode run that read a
 * directory and then created a file, the same session resumed, a read-only run
 * where the permission config left no write tool to offer, and a plan-agent
 * run that only talked.
 *
 * What was measured, and what it means here:
 *
 * - Every record carries `sessionID`, from the first line onward. That is what
 *   `-s` takes back, so it is the thread id, and it is known before the run
 *   ends rather than only at the end.
 * - The stream is a sequence of STEPS: `step_start` ... `step_finish`. A step
 *   is a model turn, and a run has as many as it needed tool calls. Each
 *   `step_finish` reports that step's own `tokens`, so the run's cost is the
 *   sum and not the last one.
 * - `text` parts are COMPLETE messages, not fragments. There is no partial
 *   output mode here, so each one arrives whole and replaces its own item --
 *   the same shape Cursor's complete message takes, without the fragments it
 *   has to avoid doubling.
 * - `tool_use` arrives ONCE per call, already finished, with a `state.status`
 *   of `completed` or `error`. Started and completed are both emitted from it
 *   so the ledger reads the way it does for every other runtime; a status this
 *   build has not seen, or none at all, is a FAILURE.
 * - A `write` call reports `metadata.exists`, and only when that is `false`
 *   can the change be reconstructed: the input holds the new content and the
 *   absent file supplies the empty before-text. When the file DID exist,
 *   OpenCode reports no before-text at all, so the path is recorded with no
 *   patch. Inventing a diff there would put a change in the ledger that
 *   nobody performed.
 * - `edit` calls were never captured. Their input shape is unknown, so an edit
 *   carries its path and nothing else rather than a guess at a diff.
 * - There is no terminal `result` record. What ends a run is a `step_finish`
 *   whose `reason` is `stop`; a stream that ends on `tool-calls` stopped in
 *   the middle of something, and a clean exit does not make that a success.
 */

export interface OpenCodeInvocationContext {
  /** Product-owned run identifier. Never the provider's session id. */
  readonly runId: string;
  readonly missionId?: string;
  readonly requestedRouteId?: string;
  readonly resolvedRouteId?: string;
  readonly cliVersion?: string;
  /** Test seam and host clock. */
  readonly now?: () => Date;
}

export interface OpenCodeEventNormalizer {
  readonly runtimeThreadId: string | undefined;
  readonly finalized: boolean;
  accept(record: RuntimeJsonlRecord): readonly NormalizedRuntimeEvent[];
  finish(completion: RuntimeProcessCompletion): readonly NormalizedRuntimeEvent[];
}

type JsonObject = Record<string, unknown>;

/**
 * A unified diff for a file OpenCode CREATED, built from the content it wrote.
 *
 * This is a reconstruction, and it is only sound because the runtime said the
 * file did not exist: the before-text is empty by fact, not by assumption. It
 * returns nothing for any other case, so an overwrite cannot slip through
 * looking like an addition.
 */
export function addedFilePatch(
  filePath: string,
  content: string,
  existed: unknown,
): ToolPatch | undefined {
  if (existed !== false) return undefined;
  const lines = content.split("\n");
  // A trailing newline splits into a final empty piece that is not a line.
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  const body = lines.map((line) => `+${line}`).join("\n");
  return toolPatchFrom(`--- /dev/null\n+++ b/${filePath}\n@@ -0,0 +1,${String(lines.length)} @@\n${body}\n`);
}

/**
 * Whether a tool call went well. The status is the runtime's own word for it,
 * and anything but `completed` -- including nothing at all -- is a failure,
 * because a ledger that records an unrecognised outcome as success is wrong in
 * the direction that matters.
 */
export function openCodeToolOutcome(state: JsonObject): {
  readonly failed: boolean;
  readonly status?: string;
} {
  const status = stringValue(state.status);
  if (status === "completed") return { failed: false };
  return { failed: true, status: status ?? "unknown" };
}

/**
 * What the model SAID it was doing, for a shell call.
 *
 * UNVERIFIED, and say so: I have not seen OpenCode send one.
 *
 * I assumed OpenCode's bash tool carried a `description` beside the command
 * the way Claude Code's does, because `openCodeToolTarget` reaches for
 * `description` -- but the comment beside that line attributes it to the
 * TASK tool, which names its ask rather than a path, and a driven `ls -a`
 * on 2026-09-09 produced a command row with no description on it.
 *
 * So this reads a field that may never be populated. It is kept because it
 * costs nothing and is correct IF the field appears, and because removing it
 * would leave the same wrong assumption in a commit message with no code to
 * contradict it. What it is not is evidence that OpenCode has the field.
 *
 * Kept apart from the target rather than reordering it. The command is
 * evidence of what ran on this machine; the description is a claim about it
 * by the thing that ran it. Reordering would have replaced the evidence with
 * the claim; this puts the claim on top of it.
 *
 * Only for the shell tool: a file tool's row is already the path, which
 * reads better than any sentence about it, and `task` has used the
 * description as its own text since before this existed.
 */
export function openCodeToolTitle(tool: string, input: JsonObject): string | undefined {
  if (!/^(bash|shell)$/i.test(tool)) return undefined;
  return stringValue(input.description);
}

/** What a tool acted on, in the order OpenCode reports it. */
export function openCodeToolTarget(input: JsonObject, metadata: JsonObject): string | undefined {
  return stringValue(input.filePath)
    ?? stringValue(input.command)
    ?? stringValue(input.pattern)
    // OpenCode's task tool names its ask, not a path.
    ?? stringValue(input.description)
    ?? stringValue(input.prompt)
    ?? stringValue(metadata.filepath);
}

export function createOpenCodeEventNormalizer(
  context: OpenCodeInvocationContext,
): OpenCodeEventNormalizer {
  const runId = requireContextText(context.runId, "runId");
  const cliVersion = context.cliVersion === undefined
    ? undefined
    : requireContextText(context.cliVersion, "cliVersion");
  const now = context.now ?? (() => new Date());

  let runtimeThreadId: string | undefined;
  let normalizedSequence = 0;
  let finalized = false;
  let stepOpen = false;
  /** A `step_finish` whose reason is `stop`: the run said it was done. */
  let sawStop = false;
  let messageIndex = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let sawTokens = false;
  // The last provider error the runtime reported, kept so the run that follows
  // it can say what happened instead of shrugging.
  let providerError: OpenCodeErrorFacts | undefined;

  const emit = <TType extends NormalizedRuntimeEventType>(
    type: TType,
    payload: NormalizedRuntimePayloadMap[TType],
  ): NormalizedRuntimeEvent => {
    normalizedSequence += 1;
    return {
      id: `${runId}:opencode:${normalizedSequence}`,
      runId,
      ...(context.missionId === undefined ? {} : { missionId: context.missionId }),
      sequence: normalizedSequence,
      occurredAt: now().toISOString(),
      sourceAdapter: "opencode",
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
    // The session id is on every record, so it is picked up from whichever
    // one arrives first rather than from a header record that may never come.
    runtimeThreadId = runtimeThreadId ?? identityValue(parsed.sessionID);
    const part = isObject(parsed.part) ? parsed.part : {};
    const evidence = evidenceFor(record, parsed, type);

    if (type === "step_start") {
      // A second start without a finish would leave the first step open
      // forever, so only the first one opens anything.
      if (stepOpen) return [];
      stepOpen = true;
      return [emit("step.started", { stepKind: "turn", evidence })];
    }

    if (type === "step_finish") {
      const tokens = isObject(part.tokens) ? part.tokens : {};
      if (typeof tokens.input === "number" && Number.isFinite(tokens.input)) {
        inputTokens += tokens.input;
        sawTokens = true;
      }
      if (typeof tokens.output === "number" && Number.isFinite(tokens.output)) {
        outputTokens += tokens.output;
        sawTokens = true;
      }
      // Each step reports its own counts, so a run's cost is their sum. Taking
      // the last step's numbers would report the cheapest step as the total.
      if (stringValue(part.reason) === "stop") sawStop = true;
      if (!stepOpen) return [];
      stepOpen = false;
      return [emit("step.completed", { stepKind: "turn", evidence })];
    }

    if (type === "text") {
      const text = stringValue(part.text);
      if (text === undefined) return [];
      const itemId = `msg_${String(messageIndex)}`;
      messageIndex += 1;
      // Complete on arrival: there is no partial output mode to reconcile
      // with, so the message replaces its item and closes it in one event.
      return [
        emit("message.delta", {
          itemId,
          operation: "replace",
          text: boundedMessageText(text),
          final: true,
          evidence,
        }),
      ];
    }

    if (type === "tool_use") {
      const state = isObject(part.state) ? part.state : {};
      const input = isObject(state.input) ? state.input : {};
      const metadata = isObject(state.metadata) ? state.metadata : {};
      const kind = identityValue(part.tool) ?? "tool";
      const itemId = identityValue(part.callID) ?? `tool_${String(record.sequence)}`;
      const target = openCodeToolTarget(input, metadata);
      const verdict = openCodeToolOutcome(state);
      const filePath = stringValue(input.filePath) ?? stringValue(metadata.filepath);
      const content = stringValue(input.content);
      // An `edit` reports the unified diff it applied in `metadata.diff`
      // (measured 2026-09-03: `--- path` / `+++ path` and a real hunk), so
      // that is the change, verbatim. A `write` of a file that did not exist
      // can be turned into a diff from its content. An overwrite reports no
      // before-text, so it is recorded as a change to that path with no
      // patch, exactly as a Codex file_change row is.
      const reportedDiff = stringValue(metadata.diff);
      const patch = reportedDiff !== undefined
        ? toolPatchFrom(reportedDiff)
        : kind === "write" && filePath !== undefined && content !== undefined
          ? addedFilePatch(filePath, content, metadata.exists)
          : undefined;
      const title = openCodeToolTitle(kind, input);
      const common = {
        itemId,
        toolKind: kind,
        name: kind,
        ...(target === undefined ? {} : { command: boundedMessageText(target) }),
        ...(title === undefined ? {} : { title: boundedMessageText(title) }),
      };
      return [
        emit("tool.started", { ...common, phase: "started", evidence }),
        emit(verdict.failed ? "tool.failed" : "tool.completed", {
          ...common,
          ...(verdict.status === undefined ? {} : { status: verdict.status }),
          ...(patch === undefined ? {} : { patch }),
          phase: "completed",
          evidence,
        }),
      ];
    }

    // OpenCode says why it is about to die. Until 2026-09-07 this fell through
    // to `unknown_event` at level `info`, and the run then reported itself as
    // having "ended without a step that reported it had stopped" -- the vaguest
    // sentence available, about the one thing we actually knew. See
    // `opencode-error.ts` for the record that was measured.
    if (type === "error") {
      const facts = openCodeErrorFacts(parsed);
      if (facts !== undefined) {
        // Kept for the completion path, which is where a run's failure is
        // reported. Emitting `run.failed` from here would race the process
        // exit and could finalize a run the runtime has not finished writing.
        providerError = facts;
        return [diagnostic("error", "opencode.provider_error", openCodeErrorSentence(facts), evidence)];
      }
    }

    return [
      diagnostic("info", "opencode.unknown_event", `Unhandled OpenCode record: ${type}`, evidence),
    ];
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
          diagnostic("warning", "opencode.malformed_record", "An OpenCode record could not be parsed.", malformedEvidence(record)),
        ];
      }
      if (!isObject(parsed)) {
        return [
          diagnostic("warning", "opencode.malformed_record", "An OpenCode record was not an object.", malformedEvidence(record)),
        ];
      }
      return acceptParsed(record, parsed);
    },

    finish(completion: RuntimeProcessCompletion): readonly NormalizedRuntimeEvent[] {
      // The one line that names why a run stopped, which nothing read.
      //
      // When OpenCode is asked for a directory outside the one it may use, it
      // prints `permission requested: external_directory (<path>);
      // auto-rejecting` on stderr and the process ENDS -- with no step saying
      // it stopped. The person was then told "OpenCode ended without a step
      // that reported it had stopped", which describes the stream rather than
      // the cause, and is the exact sentence 0.36.4 set out to stop people
      // seeing. Measured against opencode-ai 1.18.29 in a real worktree, five
      // runs (QA, 2026-09-06); the run ends this way whenever the model lists
      // the parent folder before writing.
      //
      // 0.36.5 makes the refusal survivable in the ordinary case by stating
      // `external_directory: "deny"`. This is for when a run ends on one
      // anyway: say which folder, and that it was outside what the run may
      // use.
      const refused = /permission requested:\s*external_directory\s*\(([^)]*)\)/i.exec(
        completion.stderr ?? "",
      );
      const refusedPath = refused?.[1]?.trim().replace(/[\\/]\*$/, "");
      if (finalized) return [];
      finalized = true;
      const process = processEvidence(completion);
      const thread = runtimeThreadId === undefined ? {} : { runtimeThreadId };
      const usage: RedactedJsonValue | undefined = sawTokens
        ? { inputTokens, outputTokens }
        : undefined;
      if (completion.cancelled) {
        return [emit("run.cancelled", { ...thread, process })];
      }
      if (!sawStop || completion.exitCode !== 0) {
        return [
          emit("run.failed", {
            kind: "process-failed",
            // Order matters. The confined-workspace refusal stays first: it
            // names the path the run wanted and could not have, which tells a
            // person more about their own mission than the cap does. The cap
            // comes next, because past that point the HOST ended the run and
            // nothing the runtime said afterwards describes it better --
            // saying "ended without a step that reported it had stopped" for
            // a kill we performed is the vaguest possible account of the one
            // thing we know for certain.
            message: refusedPath !== undefined && refusedPath.length > 0
              ? `OpenCode asked for ${refusedPath}, which is outside the folder this run may use, and stopped.`
              : completion.outputLimitExceeded
                ? "OpenCode sent a single piece of output larger than Locust accepts, so the run was stopped. Asking for a narrower slice -- one file, or a summary rather than the whole contents -- usually avoids it."
                // The runtime's own account of why, when it gave one. Sits
                // below the two cases above because those describe something
                // the HOST did, which the runtime could not know about, and
                // above the exit code because a number is not a reason.
                : providerError !== undefined
                  ? openCodeErrorSentence(providerError)
                  : sawStop
                    ? `OpenCode exited with code ${String(completion.exitCode)}.`
                    : "OpenCode ended without a step that reported it had stopped.",
            ...thread,
            runtimeTerminal: sawStop ? "completed" : "missing",
            process,
          }),
        ];
      }
      return [emit("run.completed", { ...thread, ...(usage === undefined ? {} : { usage }), process })];
    },
  };
}
