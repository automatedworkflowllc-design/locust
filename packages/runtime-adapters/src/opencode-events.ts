import {
  boundedMessageText,
  evidenceFor,
  identityValue,
  isObject,
  malformedEvidence,
  processEvidence,
  requireContextText,
  sanitizeJson,
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
import {
  isContextOverflow,
  OPENCODE_OVERFLOW_RECOVERING,
  openCodeErrorFacts,
  openCodeErrorSentence,
  sessionCannotContinue,
} from "./opencode-error.js";
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
  // A call the person declined, or a mode refused, never ran: OpenCode fails
  // it with "The user rejected permission to use this specific tool call"
  // (measured, `run` and `serve` alike). As a plain error the fold said it
  // "ran ... exited non-zero" (drive opencode-approve-each, 2026-09-25).
  if (status === "error" && /rejected permission/i.test(stringValue(state.error) ?? "")) {
    // The person said no on a card: Locust's own reply says so, and it is
    // not the mode refusing (the beta report asked for the two to differ).
    return { failed: true, status: /declined this in Locust/i.test(stringValue(state.error) ?? "") ? "declined" : "refused" };
  }
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

/**
 * The tool OpenCode keeps its plan in. `todowrite` is the measured name;
 * `todo_write` is spelled that way elsewhere in the family, so both are read.
 */
const OPENCODE_PLAN_TOOL = /^todo_?write$/i;

/**
 * Words OpenCode wrote to the MODEL, which `run` prints as if the model had
 * said them (A6.9).
 *
 * `run --format json` prints every finished text part in the session, and
 * OpenCode writes some text parts itself: when a conversation outgrows the
 * model's context it summarizes it, then adds "Continue if you have next
 * steps, or stop and ask for clarification if you are unsure how to proceed."
 * as a user message to carry on. That part is `synthetic` and carries
 * `metadata.compaction_continue`, and it has a finished time, so `run` prints
 * it -- read in OpenCode's session/compaction.ts and cli/cmd/run.ts
 * (2026-09-24), and the same code is in the installed 1.18.27 binary. Locust
 * took it as the teammate's message, and as the last one it would have been
 * the reply.
 *
 * `synthetic` is OpenCode's own mark for text it wrote, so no synthetic part
 * is a teammate's words. Returns `compaction` for the one that says the
 * conversation was just summarized, `other` for any other, and undefined for
 * text the model wrote.
 */
export function openCodeOwnText(part: JsonObject): "compaction" | "other" | undefined {
  if (part.synthetic !== true) return undefined;
  const metadata = isObject(part.metadata) ? part.metadata : {};
  return metadata.compaction_continue === true ? "compaction" : "other";
}

/**
 * What the person is told when OpenCode summarizes the conversation. Claude
 * Code shows a line when it compacts, not the summary, and this does the same.
 */
export const OPENCODE_COMPACTED =
  "The conversation outgrew the model's context, so OpenCode summarized it and carried on from the summary.";

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
  /*
   * A6.4: the rest of what a step reports. MEASURED in the captured streams
   * (test/fixtures/opencode): reasoning is often larger than the visible
   * output -- 420 against 78 on one step -- and a later step reads nearly
   * its whole prompt from cache (15,217 cached against 261 new). Reasoning
   * is generated and is counted as output, the way Claude Code's
   * `output_tokens` already includes its thinking; the cache is carried as
   * its own counts, as Claude Code's receipt does; the cost only when there
   * is one -- a free model's explicit 0 would read as "$0.00 ... priced",
   * which is the wording the free routes were rid of (Sol, 0.225.0).
   */
  let reasoningTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let costUsd = 0;
  let sawTokens = false;
  // The last provider error the runtime reported, kept so the run that follows
  // it can say what happened instead of shrugging.
  let providerError: OpenCodeErrorFacts | undefined;
  // A context overflow is followed by a compaction and a retry (A6.10). It is
  // recovered once a compaction came after it AND the run then stopped on its
  // own; the exit code, which says 1 for any error seen, cannot tell.
  let overflow: "none" | "waiting" | "compacted" | "recovered" = "none";
  // The messages of the step now open and whether it called a tool, and the
  // same for the step that last finished. A compaction's summary is the text
  // of the step just before OpenCode's continue note, and that step has no
  // tools (compaction.ts gives it none), so this is how the summary is found
  // once the note says what it was.
  let stepMessages: string[] = [];
  let stepUsedTools = false;
  let finishedStep: { readonly messages: readonly string[]; readonly usedTools: boolean } | undefined;

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
      stepMessages = [];
      stepUsedTools = false;
      // A note that arrives after another step began is not taken as
      // describing the step before it: nothing is taken back on a guess.
      finishedStep = undefined;
      // A second start without a finish would leave the first step open
      // forever, so only the first one opens anything.
      if (stepOpen) return [];
      stepOpen = true;
      return [emit("step.started", { stepKind: "turn", evidence })];
    }

    if (type === "step_finish") {
      const tokens = isObject(part.tokens) ? part.tokens : {};
      const cache = isObject(tokens.cache) ? tokens.cache : {};
      const counted = (value: unknown): number | undefined =>
        typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
      if (counted(tokens.input) !== undefined) {
        inputTokens += counted(tokens.input)!;
        sawTokens = true;
      }
      if (counted(tokens.output) !== undefined) {
        outputTokens += counted(tokens.output)!;
        sawTokens = true;
      }
      reasoningTokens += counted(tokens.reasoning) ?? 0;
      cacheReadTokens += counted(cache.read) ?? 0;
      cacheWriteTokens += counted(cache.write) ?? 0;
      costUsd += counted(part.cost) ?? 0;
      // Each step reports its own counts, so a run's cost is their sum. Taking
      // the last step's numbers would report the cheapest step as the total.
      if (stringValue(part.reason) === "stop") {
        sawStop = true;
        if (overflow === "compacted") overflow = "recovered";
      }
      finishedStep = { messages: stepMessages, usedTools: stepUsedTools };
      stepMessages = [];
      stepUsedTools = false;
      if (!stepOpen) return [];
      stepOpen = false;
      return [emit("step.completed", { stepKind: "turn", evidence })];
    }

    if (type === "text") {
      const text = stringValue(part.text);
      if (text === undefined) return [];
      const own = openCodeOwnText(part);
      if (own === "other") return [];
      if (own === "compaction") {
        // The summary goes (Claude Code shows that it compacted, not what it
        // kept), only when the step before the note is one that called no
        // tool, as the compaction step never does. An empty message is one
        // the thread does not draw and a reply that says nothing, so a
        // summary cannot become the answer or carry blocks it quoted.
        const summary = finishedStep !== undefined && !finishedStep.usedTools ? finishedStep.messages : [];
        finishedStep = undefined;
        // The summary step's own stop is not the run's: what OpenCode does
        // after it has to finish too before the run counts as done.
        sawStop = false;
        if (overflow === "waiting") overflow = "compacted";
        return [
          ...summary.map((itemId) => emit("message.delta", { itemId, operation: "replace", text: "", final: true, evidence })),
          diagnostic("info", "opencode.context_compacted", OPENCODE_COMPACTED, evidence),
        ];
      }
      const itemId = `msg_${String(messageIndex)}`;
      messageIndex += 1;
      stepMessages.push(itemId);
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
      stepUsedTools = true;
      const state = isObject(part.state) ? part.state : {};
      const input = isObject(state.input) ? state.input : {};
      const metadata = isObject(state.metadata) ? state.metadata : {};
      const kind = identityValue(part.tool) ?? "tool";
      const itemId = identityValue(part.callID) ?? `tool_${String(record.sequence)}`;
      // OpenCode keeps a plan, and until 2026-09-13 no surface showed it.
      //
      // Astra measured a single run: `todowrite` arrived FOUR times carrying
      // real three-step state (`payload.evidence.raw.part.state.input.todos`),
      // each update advancing one step, and both the room and the thread drew
      // one row -- `todowrite done` -- four times over. The plan moved and
      // nothing said so. Codex's `todo_list` has always become `plan.updated`;
      // this is the same fact under another runtime's name, so it becomes the
      // same event and NOT a tool row, exactly as Codex's does.
      //
      // No todos, no plan: a run without todo data must not have one invented
      // for it, so anything unrecognisable falls through to the ordinary rows.
      if (OPENCODE_PLAN_TOOL.test(kind)) {
        const todos = Array.isArray(input.todos) ? input.todos : undefined;
        if (todos !== undefined && todos.length > 0) {
          const planState = { redacted: false };
          return [
            emit("plan.updated", {
              itemId,
              plan: sanitizeJson(todos, planState),
              // OpenCode never says which update is the last one, and guessing
              // from "everything is complete" would close a plan the model may
              // still add to.
              final: false,
              evidence,
            }),
          ];
        }
      }
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
        if (isContextOverflow(facts)) {
          // Not "OpenCode stopped": it summarizes and tries again (A6.10).
          overflow = "waiting";
          return [diagnostic("info", "opencode.context_overflow", OPENCODE_OVERFLOW_RECOVERING, evidence)];
        }
        overflow = "none";
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
      /*
       * A POLICY REFUSAL IS NOT A CRASH, and it was being reported as one.
       *
       * Sol's beta review of 0.225.0, ranked embarrassing: in Ask mode a run
       * asked to create a file, the write never happened -- the boundary held
       * exactly as designed -- and the card said "OpenCode ended without a
       * step that reported it had stopped" over the runtime's own
       * auto-rejecting line. "A new user is likely to conclude Ask mode or
       * OpenCode is broken."
       *
       * The mechanism is ours and it is deliberate. Ask mode sets bash to
       * "ask", and `opencode run` is non-interactive, so every shell call is
       * auto-rejected and the process ends without reaching its own stop step
       * -- see OPENCODE_ASK_CONFIG in commands.ts for why the tool has to
       * stay on the list at all. Knowing that, the vaguest sentence available
       * is the wrong one to print.
       *
       * external_directory keeps its own case above: that one names a FOLDER,
       * which tells the person something about their own mission. This names
       * the TOOL, and the mode that refused it.
       */
      const blocked = /permission requested:\s*(bash|edit|write|patch)\b/i.exec(
        completion.stderr ?? "",
      );
      const blockedTool = blocked?.[1]?.toLowerCase();
      if (finalized) return [];
      finalized = true;
      const process = processEvidence(completion);
      const thread = runtimeThreadId === undefined ? {} : { runtimeThreadId };
      const usage: RedactedJsonValue | undefined = sawTokens
        ? {
            inputTokens,
            outputTokens: outputTokens + reasoningTokens,
            ...(cacheReadTokens > 0 ? { cacheReadTokens } : {}),
            ...(cacheWriteTokens > 0 ? { cacheWriteTokens } : {}),
            ...(costUsd > 0 ? { usd: costUsd } : {}),
          }
        : undefined;
      if (completion.cancelled) {
        return [emit("run.cancelled", { ...thread, process })];
      }
      // A run that overflowed, compacted and then stopped on its own exits 1
      // all the same; that exit is the error it recovered from, not a failure.
      const recoveredExit = overflow === "recovered" && completion.exitCode === 1
        && refusedPath === undefined && blockedTool === undefined && !completion.outputLimitExceeded;
      if (!sawStop || (completion.exitCode !== 0 && !recoveredExit)) {
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
              : blockedTool !== undefined
                ? `The mode this run is in does not allow ${blockedTool}, so OpenCode stopped when it tried to use it. Nothing was changed.`
                : completion.outputLimitExceeded
                ? "OpenCode sent output faster than Locust could record it, so the run was stopped rather than leave a gap in its record. Sending it again usually works."
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
            // M7: and the next turn starts a fresh session, as the card says.
            ...(providerError !== undefined && sessionCannotContinue(providerError) ? { sessionEnded: true as const } : {}),
            runtimeTerminal: sawStop ? "completed" : "missing",
            process,
          }),
        ];
      }
      return [emit("run.completed", { ...thread, ...(usage === undefined ? {} : { usage }), process })];
    },
  };
}
