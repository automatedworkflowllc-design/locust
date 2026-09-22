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
/**
 * A rate-limit snapshot only means something when it says something. Claude
 * sends one of these on ordinary turns to report usage, and `allowed` means
 * the request went through -- surfacing that as a limit puts a red card over
 * a run that was never in trouble. `allowed_warning` is the approaching-limit
 * warning, and anything else (a rejection) is the real thing.
 */
/**
 * What the model SAID it was doing, when it said.
 *
 * Claude Code's Bash tool takes a `description` alongside the command --
 * "Clear, concise description of what this command does in active voice" --
 * and the model fills it in on every call. That sentence is why Claude
 * Code's own transcript reads "Checked what the app says about the free
 * route" where a lesser one would read a shell pipeline.
 *
 * Locust threw it away. `claudeToolTarget` answered the COMMAND for Bash and
 * nothing else looked at the input again, so every command row showed the
 * pipeline. The `Task` case two lines below it already prefers the
 * description and says in its own comment that "the description is the row's
 * text" -- the pattern was known and simply not applied to the tool that
 * runs most often.
 *
 * It is kept SEPARATE from the target rather than replacing it. The command
 * is evidence of what ran on this machine; the description is a claim about
 * it, written by the thing that ran it. A row may lead with the claim, but
 * the evidence cannot stop being recorded.
 */
export function claudeToolTitle(name: string, input: unknown): string | undefined {
  if (name !== "Bash") return undefined;
  if (!isObject(input)) return undefined;
  return stringValue(input.description);
}

/**
 * Whether Claude Code was asked to run this call in the background.
 *
 * Its Bash tool takes `run_in_background`, and the flag rides on the same
 * `tool_use` input block this adapter already opens for the command and the
 * description. It was read for neither until now, so the one fact any
 * runtime gives us about backgrounded work was arriving and being dropped.
 *
 * Bash only, because that is the tool that takes the flag. Reading it off
 * every tool would invent the field on tools that do not have it.
 */
export function claudeToolBackgrounded(name: string, input: unknown): boolean {
  if (name !== "Bash") return false;
  if (!isObject(input)) return false;
  return input.run_in_background === true;
}

/**
 * What a Claude tool acted on, for the activity row to name.
 *
 * MEASURED 2026-09-03 by reading the card after a real run: every row said
 * `Read done`, `Glob done`, `Write failed` -- the tool and nothing else, so
 * the card could not tell anyone WHICH file was read or written. Codex rows
 * name their file or command; these had no target at all because a tool's
 * input arrives after `content_block_start`, streamed as JSON deltas, and
 * nothing picked it up from the completed block.
 */
export function claudeToolTarget(name: string, input: unknown): string | undefined {
  if (!isObject(input)) return undefined;
  const first = (...keys: readonly string[]): string | undefined => {
    for (const key of keys) {
      const value = stringValue(input[key]);
      if (value !== undefined && value.length > 0) return value;
    }
    return undefined;
  };
  switch (name) {
    case "Bash":
      return first("command");
    case "Glob":
    case "Grep":
      return first("pattern", "path");
    case "Task":
    case "Agent":
      // Claude Code 2.x names its subagent launcher Agent; older builds said
      // Task. The description is the row's text; without one, the first
      // words of the prompt (seen driving the app, 2026-09-05: a live helper
      // read "a helper, unnamed").
      return first("description", "prompt");
    case "WebFetch":
    case "WebSearch":
      return first("url", "query");
    default:
      // Read, Edit, Write, NotebookEdit and anything else that names a file.
      return first("file_path", "path", "notebook_path", "command", "pattern");
  }
}

export function limitKindFor(status: unknown): "quota-exhausted" | "temporary-rate-limit" | undefined {
  const text = typeof status === "string" ? status.toLowerCase() : "";
  if (text === "allowed") return undefined;
  if (text.includes("allowed")) return "temporary-rate-limit";
  if (text.length === 0) return undefined;
  return "quota-exhausted";
}

/**
 * "5-hour window 35% used · resets 7:30 PM", from Claude Code's
 * `unifiedWindows` ({five_hour: {utilization, resetsAt}, seven_day: ...}).
 * The fuller window leads; both are named when both are known.
 */
export function usageWindowText(windows: unknown): string | undefined {
  if (!isObject(windows)) return undefined;
  const parts: { label: string; used: number; resets: string | undefined }[] = [];
  for (const [key, value] of Object.entries(windows)) {
    if (!isObject(value) || typeof value.utilization !== "number" || !Number.isFinite(value.utilization)) continue;
    const label = key === "five_hour" ? "5-hour window" : key === "seven_day" ? "7-day window" : `${key} window`;
    parts.push({ label, used: Math.round(value.utilization * 100), resets: resetsAtIso(value.resetsAt) });
  }
  if (parts.length === 0) return undefined;
  parts.sort((a, b) => b.used - a.used);
  return parts
    .map((part) => `${part.label} ${String(part.used)}% used${part.resets === undefined ? "" : ` · resets ${part.resets}`}`)
    .join(" · ");
}

/** `resetsAt` is epoch SECONDS, not milliseconds. */
export function resetsAtIso(value: unknown): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const milliseconds = value * 1000;
  if (!Number.isFinite(milliseconds)) return undefined;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/**
 * A tool named the way the activity rows name it.
 *
 * `mcp__claude_ai_Robinhood__get_accounts` is a machine name and reads as
 * one. The rows already split it into the tool and the connector it belongs
 * to, and a sentence about the same call has no business doing worse -- Colin
 * sent a capture of exactly that on 2026-09-09.
 *
 * Kept here rather than imported from the renderer, because this package has
 * no renderer. The split is one rule and it is checked against real tool
 * names in `connectors.test.ts`.
 */
/**
 * What was refused, short enough to read.
 *
 * The refusal names the thing it would not do, and for Bash that thing is a
 * whole command line. Colin sent a capture on 2026-09-10 of one that ran to
 * eight wrapped lines inside the amber register -- a `cd` into a long Windows
 * path, `&&`, and an entire `python3 -c` program with embedded JSON parsing.
 * The register is for a sentence a person can act on; a program printed into
 * it buries the sentence it came with.
 *
 * The first line, bounded. A command's first line is the part that says what
 * it was trying to do, and the whole of it is in the activity row and the
 * receipt, where a command belongs.
 */
export function brieflyPut(detail: string): string {
  const firstLine = detail.split(/\r?\n/)[0]?.trim() ?? '';
  const said = firstLine.length === 0 ? detail.trim() : firstLine;
  if (said.length <= REFUSAL_DETAIL_LIMIT) return said;
  // Cut on a space where there is one near the end, so the tail is not half
  // a word -- a path or a flag broken mid-token reads as corruption.
  const cut = said.slice(0, REFUSAL_DETAIL_LIMIT);
  const space = cut.lastIndexOf(" ");
  return `${(space > REFUSAL_DETAIL_LIMIT - 24 ? cut.slice(0, space) : cut).trimEnd()}...`;
}

/** Long enough for an ordinary command, short enough to stay one line. */
export const REFUSAL_DETAIL_LIMIT = 96;

export function namedTool(name: string): string {
  const match = /^mcp__([A-Za-z0-9_]+?)__(.+)$/.exec(name);
  if (match === null) return name;
  const server = match[1]!.replace(/^claude_ai_/, "").replace(/_/g, " ");
  return `${match[2]!} on ${server}`;
}

/**
 * Why a run was refused, which is not one reason.
 *
 * This sentence was written for Bash and said "asks for approval before
 * running commands". Once Locust stopped denying `mcp__*` outright
 * (2026-09-09) the same line began firing for connector calls, where
 * "commands" is simply the wrong word.
 *
 * A connector refusal is also the one a person can act on, so it says how.
 *
 * It used to say "a printed run has no way to put that question to you",
 * which was true until 0.63.0 and false after it: Locust is the permission
 * host now, the question IS put to the person, and the first drive of a
 * narrowed teammate saw this sentence claim otherwise right under the card
 * they had just pressed Deny on. The CLI's record cannot say which of the two
 * it was, so the sentence names both.
 */
export function whyRefused(refused: readonly { readonly tool: string }[]): string {
  return refused.every((entry) => entry.tool.startsWith("mcp__"))
    ? "Claude Code asks before using a connector, and this one was not allowed: either you said no when it asked, or it is not one of this teammate's connectors. Give this teammate the connector in its card, or run it in Auto."
    : "This route allows edits but asks for approval before running commands, and a printed run has no way to give it.";
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
  const openTools = new Map<string, { name: string; target?: string; title?: string; background?: boolean }>();
  /** A subagent's type and one-line summary, by the Agent tool call that started it. */
  const subagentKinds = new Map<string, string>();
  const subagentSummaries = new Map<string, string>();
  let runtimeThreadId: string | undefined;
  let normalizedSequence = 0;
  let finalized = false;
  let sawResult = false;
  let terminalFailure: string | undefined;
  // What the run cost, as Claude Code itself priced it. Measured 2026-09-03:
  // the `result` record carries `total_cost_usd` and a `usage` block with
  // `input_tokens` / `output_tokens`. Only the numbers travel; the record's
  // model-usage table names the account's models and stays behind.
  let completedUsage: Record<string, number> | undefined;
  let resolvedModel: string | undefined;
  /**
   * The block the assistant's text is actually streaming into.
   *
   * MEASURED 2026-09-03: Claude Code does not always put the text at index 0.
   * When it sends another block first, the deltas arrive as `block_1` while
   * the completing record below replaced `block_0` -- two different items, so
   * the finished answer rendered TWICE, in full, one after the other. The
   * replace has to land on the block the text was written to.
   */
  let textBlockId: string | undefined;

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
      if (kind === undefined) {
        // Allowed, with the windows' utilisation: what Claude Code's own
        // status line shows ("35% of the 5-hour window"). Not a thread item;
        // the host keeps the latest per runtime for the route chip and
        // Settings (MEASURED 2026-09-05; parity table row).
        const window = usageWindowText(info.unifiedWindows);
        if (window === undefined) return [];
        return [
          emit("adapter.diagnostic", {
            code: "claude.usage_window",
            level: "info",
            terminal: false,
            message: window,
            evidence,
          }),
        ];
      }
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
      // MEASURED 2026-09-05 off a live `--output-format stream-json` run of
      // Claude Code 2.1.261: the system channel also carries
      //   notification  -- "Stop hook error occurred · ctrl+o to see",
      //                    priority "immediate": the runtime telling the
      //                    person something about its own setup;
      //   task_started / task_progress / task_updated / task_notification
      //                 -- a subagent's life: its type, what it is doing,
      //                    its last tool, and its one-line summary at the end;
      //   status        -- "requesting" and the like;
      //   thinking_tokens -- an estimate, no words.
      // Colin, 2026-09-05: the different notices Claude Code and Codex give
      // are what a person uses to know what is happening; none is cut.
      if (subtype === "notification") {
        const text = stringValue(parsed.text);
        if (text === undefined) return [];
        const immediate = stringValue(parsed.priority) === "immediate";
        return [
          emit("adapter.diagnostic", {
            code: "claude.notification",
            level: immediate ? "warning" : "info",
            terminal: false,
            message: boundedMessageText(text.replace(/\s*·\s*ctrl\+o to see\s*$/i, "")),
            evidence,
          }),
        ];
      }
      if (subtype === "task_started" || subtype === "task_progress") {
        const taskId = identityValue(parsed.task_id) ?? "task";
        const kind = stringValue(parsed.subagent_type);
        const doing = stringValue(parsed.description);
        const tool = stringValue(parsed.last_tool_name);
        const words = [kind, doing, tool === undefined ? undefined : `last tool ${tool}`].filter((part): part is string => part !== undefined);
        const toolUseId = identityValue(parsed.tool_use_id);
        if (toolUseId !== undefined && kind !== undefined) subagentKinds.set(toolUseId, kind);
        return [
          emit("step.started", {
            stepKind: "item",
            itemId: `subagent:${taskId}`,
            itemType: "subagent",
            ...(words.length === 0 ? {} : { message: boundedMessageText(words.join(" · ")) }),
            evidence,
          }),
        ];
      }
      if (subtype === "task_notification") {
        const taskId = identityValue(parsed.task_id) ?? "task";
        const toolUseId = identityValue(parsed.tool_use_id);
        const summary = stringValue(parsed.summary);
        if (toolUseId !== undefined && summary !== undefined) subagentSummaries.set(toolUseId, summary);
        const status = stringValue(parsed.status);
        return [
          emit(status === "failed" ? "step.failed" : "step.completed", {
            stepKind: "item",
            itemId: `subagent:${taskId}`,
            itemType: "subagent",
            ...(status === undefined ? {} : { status }),
            evidence,
          }),
        ];
      }
      if (subtype === "task_updated" || subtype === "thinking_tokens") return [];
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
        textBlockId = `block_${String(inner.index ?? 0)}`;
        return [
          emit("message.delta", {
            itemId: textBlockId,
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
      // The same record carries every tool_use block with its input filled
      // in, which is the first point the target is knowable.
      for (const block of content) {
        if (!isObject(block) || stringValue(block.type) !== "tool_use") continue;
        const itemId = identityValue(block.id);
        if (itemId === undefined) continue;
        const open = openTools.get(itemId);
        if (open === undefined) continue;
        const target = claudeToolTarget(open.name, block.input);
        const title = claudeToolTitle(open.name, block.input);
        const background = claudeToolBackgrounded(open.name, block.input);
        if (target !== undefined || title !== undefined || background) {
          openTools.set(itemId, {
            ...open,
            ...(target === undefined ? {} : { target }),
            ...(title === undefined ? {} : { title }),
            ...(background ? { background: true } : {})
          });
        }
      }
      const text = content
        .map((block) => (isObject(block) ? stringValue(block.text) : undefined))
        .filter((value): value is string => value !== undefined)
        .join("");
      if (text.length === 0) return [];
      return [
        emit("message.delta", {
          // The block the text streamed into, not an assumed one.
          itemId: textBlockId ?? "block_0",
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
        const subagentKind = subagentKinds.get(itemId);
        const subagentSummary = subagentSummaries.get(itemId);
        subagentKinds.delete(itemId);
        subagentSummaries.delete(itemId);
        events.push(
          emit(failed ? "tool.failed" : "tool.completed", {
            itemId,
            toolKind: "tool_use",
            name: open?.name ?? "tool",
            ...(open?.target === undefined ? {} : { command: open.target }),
            ...(open?.title === undefined ? {} : { title: open.title }),
            ...(open?.background === true ? { background: true } : {}),
            phase: "completed",
            ...(failed ? { status: "error" } : subagentKind === undefined ? {} : { status: subagentKind }),
            // What the subagent came back with, in its own words: the row
            // reads "reported back · 3" instead of only "reported back".
            ...(subagentSummary === undefined ? {} : { output: boundedMessageText(subagentSummary) }),
            evidence,
          }),
        );
      }
      return events;
    }

    if (type === "result") {
      sawResult = true;
      const usage: Record<string, number> = {};
      if (typeof parsed.total_cost_usd === "number" && Number.isFinite(parsed.total_cost_usd)) {
        usage.usd = parsed.total_cost_usd;
      }
      if (isObject(parsed.usage)) {
        // The cache counts belong here too: a resumed turn sends almost
        // nothing new and reads the rest from cache, so `input_tokens` alone
        // says a long conversation is using nothing. What occupies the
        // window is the whole prompt, cached or not.
        for (const [from, to] of [
          ["input_tokens", "inputTokens"],
          ["output_tokens", "outputTokens"],
          ["cache_read_input_tokens", "cacheReadTokens"],
          ["cache_creation_input_tokens", "cacheWriteTokens"],
        ] as const) {
          const held = parsed.usage[from];
          if (typeof held === "number" && Number.isFinite(held)) usage[to] = held;
        }
      }
      // MEASURED 2026-09-06: Claude Code's result carries `modelUsage`, and
      // each entry states the model's real `contextWindow` (1,000,000 for
      // claude-sonnet-5) and `maxOutputTokens`. That is what makes a "how
      // full is the context" reading a measurement rather than a guess at a
      // denominator -- so it is kept, and no runtime that does not report one
      // gets a percentage invented for it.
      if (isObject(parsed.modelUsage)) {
        // MEASURED 2026-09-06: each entry is keyed by the real model id and
        // states `canonicalModel` as well. One entry means one model ran and
        // the alias has an answer; several means the run moved between them,
        // and naming one of them would be picking a favourite.
        const entries = Object.entries(parsed.modelUsage);
        if (entries.length === 1) {
          const [key, only] = entries[0]!;
          const canonical = isObject(only) ? only.canonicalModel : undefined;
          const named = typeof canonical === "string" && canonical.length > 0 ? canonical : key;
          if (named.length > 0) resolvedModel = named;
        }
        let widest: number | undefined;
        for (const entry of Object.values(parsed.modelUsage)) {
          if (!isObject(entry)) continue;
          const window = entry.contextWindow;
          if (typeof window === "number" && Number.isFinite(window) && window > 0) {
            widest = widest === undefined ? window : Math.max(widest, window);
          }
        }
        if (widest !== undefined) usage.contextWindow = widest;
      }
      if (Object.keys(usage).length > 0) completedUsage = usage;
      const isError = parsed.is_error === true;
      const subtype = stringValue(parsed.subtype) ?? "";
      const reason = stringValue(parsed.terminal_reason) ?? subtype;
      if (isError || (subtype.length > 0 && subtype !== "success")) {
        terminalFailure = boundedMessageText(
          stringValue(parsed.result) ?? `Claude Code ended with ${reason || "an error"}.`,
        );
      }
      // What the run was NOT allowed to do.
      //
      // MEASURED 2026-09-05, running the app's own accept-edits argv by hand:
      // `--permission-mode acceptEdits` auto-approves edits but NOT Bash, so
      // asking Claude Code to run `node t.mjs` produced
      // `permission_denials: [{tool_name: "Bash", ...}]` -- and the record
      // still said `is_error: false`, `subtype: "success"`,
      // `terminal_reason: "completed"`. The mission therefore completed with
      // the thing the person asked for never attempted, and nothing on
      // screen said so (QA pass, 2026-09-05, five identical attempts).
      //
      // The runtime names each refusal, so the app can too. This is not a
      // failure of the run and is not reported as one: it is the run saying
      // what it could not do.
      const denials = Array.isArray(parsed.permission_denials) ? parsed.permission_denials : [];
      const refused = denials
        .filter(isObject)
        .map((denial) => {
          const tool = stringValue(denial.tool_name) ?? "a tool";
          const input = isObject(denial.tool_input) ? denial.tool_input : {};
          const detail = stringValue(input.command) ?? stringValue(input.file_path) ?? stringValue(input.description);
          const said = namedTool(tool);
          const brief = detail === undefined ? undefined : brieflyPut(detail);
          return { tool, text: brief === undefined ? said : `${said} \`${brief}\`` };
        });
      if (refused.length > 0) {
        return [
          diagnostic(
            "warning",
            "claude.permission_denied",
            refused.length === 1
              ? `Claude Code was not permitted to use ${refused[0]!.text}, so it did not. ${whyRefused(refused)}`
              : `Claude Code was not permitted to use ${String(refused.length)} tools, so it did not: ${refused.map((entry) => entry.text).join("; ")}. ${whyRefused(refused)}`,
            evidence,
          ),
        ];
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
            // The host stopped this, not the runtime: a single line of
            // output went past the 256 KB cap in process-runner.ts and the
            // process was killed. Checked FIRST because nothing the runtime
            // said afterwards describes it better, and because saying
            // "ended without a terminal result record" for a kill we
            // performed is the vaguest possible account of the one thing we
            // know for certain.
            message: completion.outputLimitExceeded
              ? "Claude Code sent a single piece of output larger than Locust accepts, so the run was stopped. Asking for a narrower slice -- one file, or a summary rather than the whole contents -- usually avoids it."
              : sawResult
                ? `Claude Code exited with code ${String(completion.exitCode)}.`
                : "Claude Code ended without a terminal result record.",
            ...(runtimeThreadId === undefined ? {} : { runtimeThreadId }),
            runtimeTerminal: sawResult ? "completed" : "missing",
            process,
          }),
        ];
      }
      return [
        emit("run.completed", {
          ...(runtimeThreadId === undefined ? {} : { runtimeThreadId }),
          ...(completedUsage === undefined ? {} : { usage: completedUsage }),
          ...(resolvedModel === undefined ? {} : { resolvedModel }),
          process,
        }),
      ];
    },
  };
}
