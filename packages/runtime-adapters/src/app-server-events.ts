import {
  boundedMessageText,
  failureKind,
  identityValue,
  isObject,
  stringValue,
} from "./codex-events.js";
import type {
  CodexEventEvidence,
  CodexLimitKind,
  CodexRunFailureKind,
  NormalizedRuntimeEvent,
  NormalizedRuntimeEventType,
  NormalizedRuntimePayloadMap,
} from "./codex-events.js";
import type { AppServerNotification, JsonValue } from "./app-server.js";
import type { MissionRuntimeId } from "./types.js";

/**
 * app-server notifications -> the same product events every other adapter
 * emits, so the ledger, the checkpoint reconciler and the whole shell are
 * unchanged by a new transport.
 *
 * Shapes were read from the protocol's own JSON Schema and confirmed against a
 * live server; every field is still checked rather than assumed, because this
 * is an experimental protocol and a shape change must degrade to a missing
 * detail rather than to a crash or a wrong claim.
 */

/** Item types that represent the agent DOING something rather than saying it. */
const TOOL_ITEM_TYPES = new Set([
  "commandExecution",
  "fileChange",
  "mcpToolCall",
  "dynamicToolCall",
  "webSearch",
  "imageGeneration",
]);

export interface AppServerInvocationContext {
  readonly runId: string;
  readonly missionId?: string;
  readonly runtime?: MissionRuntimeId;
  readonly requestedRouteId?: string;
  readonly resolvedRouteId?: string;
  readonly cliVersion?: string;
  readonly now?: () => Date;
}

export interface AppServerEventNormalizer {
  readonly runtimeThreadId: string | undefined;
  readonly finalized: boolean;
  accept(notification: AppServerNotification): readonly NormalizedRuntimeEvent[];
  /** Terminal event for a run that ended without the server saying so. */
  finish(reason: "cancelled" | "transport-lost"): readonly NormalizedRuntimeEvent[];
}

function evidence(notification: AppServerNotification): CodexEventEvidence {
  return {
    runtimeEventType: notification.method,
    // The params are NOT copied wholesale. They routinely carry aggregated
    // command output and full file diffs, and this evidence lands in a durable
    // ledger -- the method name plus the fields each branch pulls out is what
    // a reader actually needs.
    redacted: true,
  };
}

/** A tool's display name, from whichever field its item type carries. */
export function toolNameOf(item: Record<string, unknown>): string {
  const type = stringValue(item.type) ?? "tool";
  if (type === "commandExecution") return "shell";
  if (type === "fileChange") return "apply_patch";
  if (type === "webSearch") return "web_search";
  const server = identityValue(item.server);
  const tool = identityValue(item.tool);
  if (server !== undefined && tool !== undefined) return identityValue(`${server}.${tool}`) ?? tool;
  return tool ?? type;
}

/** A short, bounded description of what a tool item is doing. */
export function toolCommandOf(item: Record<string, unknown>): string | undefined {
  const command = stringValue(item.command);
  if (command !== undefined) return boundedMessageText(command);
  const query = stringValue(item.query);
  if (query !== undefined) return boundedMessageText(query);
  if (Array.isArray(item.changes)) return `${item.changes.length} file change(s)`;
  return undefined;
}

/**
 * A rate-limit snapshot only becomes an event when it says something. The
 * server pushes these unprompted and often while everything is fine; emitting
 * one every time would fill the transcript with "nothing is wrong".
 */
/**
 * A window, in the words a person uses for it.
 *
 * The snapshot's own keys are `primary` and `secondary`, which say nothing:
 * measured on a real account, `primary` is the FIVE-HOUR window and
 * `secondary` is the weekly one. Reporting "primary limit 93% used" told
 * Colin his Codex quota was nearly gone when the weekly bucket was at 14% and
 * the five-hour one refilled 56 minutes later. He was right to push back, and
 * the snapshot had `window_minutes` in it the whole time.
 */
function windowName(minutes: number | undefined, label: string): string {
  if (minutes === undefined) return label;
  if (minutes >= 10_080) return "weekly";
  if (minutes >= 1_440) return `${String(Math.round(minutes / 1_440))}-day`;
  if (minutes >= 60 && minutes % 60 === 0) return `${String(minutes / 60)}-hour`;
  return `${String(minutes)}-minute`;
}

/** `14:39`, from epoch seconds, or nothing when there is nothing to say. */
function resetClock(resets: unknown): string | undefined {
  const seconds = typeof resets === "number" ? resets : undefined;
  // Epoch SECONDS, not milliseconds: a value this small in ms would be 1970.
  if (seconds === undefined || seconds < 1_000_000_000) return undefined;
  const at = new Date(seconds * 1000);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

/**
 * A rate-limit snapshot only becomes an event when it says something. The
 * server pushes these unprompted and often while everything is fine; emitting
 * one every time would fill the transcript with "nothing is wrong".
 *
 * Both spellings are read. The app-server notification is camelCase and the
 * rollout file Codex writes to disk is snake_case, and this has to survive
 * either -- a field it cannot see is a field it silently drops, which is how
 * the window and the reset went missing from the message for so long.
 */
export function limitFromSnapshot(
  snapshot: unknown,
): { readonly kind: "quota-exhausted" | "temporary-rate-limit"; readonly message: string } | undefined {
  if (!isObject(snapshot)) return undefined;
  const number = (value: unknown): number | undefined => (typeof value === "number" ? value : undefined);
  const windows: { name: string; used: number; resets: unknown }[] = [];
  for (const [label, value] of Object.entries(snapshot)) {
    if (!isObject(value)) continue;
    const used = number(value.usedPercent)
      ?? number(value.used_percent)
      ?? (number(value.utilization) === undefined ? undefined : (value.utilization as number) * 100);
    if (used === undefined) continue;
    windows.push({
      name: windowName(number(value.windowMinutes) ?? number(value.window_minutes), label),
      used,
      resets: value.resetsAt ?? value.resets_at ?? value.resetsInSeconds,
    });
  }
  if (windows.length === 0) return undefined;
  const worst = windows.reduce((left, right) => (right.used > left.used ? right : left));
  // The reset is the actionable half: "wait an hour" and "stop for the week"
  // are different decisions, and the percentage alone cannot tell them apart.
  const clock = resetClock(worst.resets);
  const until = clock === undefined ? "" : `, resets ${clock}`;
  if (worst.used >= 100) {
    return { kind: "quota-exhausted", message: `${worst.name} limit reached${until}` };
  }
  // Only speak up when it is close enough to matter to a decision.
  if (worst.used >= 90) {
    return {
      kind: "temporary-rate-limit",
      message: `${worst.name} limit ${String(Math.round(worst.used))}% used${until}`,
    };
  }
  return undefined;
}

/** Said when the runtime summarizes its conversation to fit its context (A2.5). */
export const APP_SERVER_COMPACTED =
  "The conversation outgrew the model's context, so Codex summarized it and carried on from the summary.";

export function createAppServerEventNormalizer(
  context: AppServerInvocationContext,
): AppServerEventNormalizer {
  const runId = context.runId;
  const now = context.now ?? (() => new Date());
  const runtime: MissionRuntimeId = context.runtime ?? "codex";

  const openTools = new Map<string, string>();
  /**
   * What the turn has cost so far.
   *
   * This transport reports usage in its own notification -- `turn/completed`
   * carries none at all -- so the latest reading is held here and attached to
   * the receipt at the end. Without it a Codex run showed no `40k in / 275
   * out` line, which is the reading a person uses to judge what a teammate is
   * spending. Names are translated to the ones every other runtime's receipt
   * uses, because the cost line reads one vocabulary.
   */
  let latestUsage: Record<string, number> | undefined;
  const messageBuffers = new Map<string, string>();
  let runtimeThreadId: string | undefined;
  let normalizedSequence = 0;
  let finalized = false;
  // Per kind, as the exec transport keeps them: one flag for every limit
  // meant an exhausted quota was never said once a warning had been (M3).
  const announcedLimits = new Set<CodexLimitKind>();
  /*
   * A compaction, said once however it is reported (A2.5). Codex 0.156.1
   * has both a `contextCompaction` item and a `thread/compacted` notification
   * (read in the binary, 2026-09-24; not yet captured), and whether one
   * compaction sends one or both is not known -- so each kind is counted, and
   * a line is said only when a count passes the lines already said.
   */
  let compactionItems = 0;
  let compactionNotices = 0;
  let compactionsSaid = 0;
  const compacted = (notification: AppServerNotification, seen: number): readonly NormalizedRuntimeEvent[] => {
    if (seen <= compactionsSaid) return [];
    compactionsSaid = seen;
    return [
      emit("adapter.diagnostic", {
        level: "info",
        code: `${runtime}.context_compacted`,
        message: APP_SERVER_COMPACTED,
        terminal: false,
        evidence: evidence(notification),
      }),
    ];
  };

  const emit = <TType extends NormalizedRuntimeEventType>(
    type: TType,
    payload: NormalizedRuntimePayloadMap[TType],
  ): NormalizedRuntimeEvent => {
    normalizedSequence += 1;
    return {
      id: `${runId}:app:${normalizedSequence}`,
      runId,
      ...(context.missionId === undefined ? {} : { missionId: context.missionId }),
      sequence: normalizedSequence,
      occurredAt: now().toISOString(),
      sourceAdapter: runtime,
      ...(context.cliVersion === undefined ? {} : { cliVersion: context.cliVersion }),
      ...(context.requestedRouteId === undefined ? {} : { requestedRouteId: context.requestedRouteId }),
      ...(context.resolvedRouteId === undefined ? {} : { resolvedRouteId: context.resolvedRouteId }),
      ...(runtimeThreadId === undefined ? {} : { runtimeThreadId }),
      type,
      payload,
    } as NormalizedRuntimeEvent;
  };

  const itemEvents = (
    notification: AppServerNotification,
    params: Record<string, unknown>,
    completed: boolean,
  ): readonly NormalizedRuntimeEvent[] => {
    const item = isObject(params.item) ? params.item : undefined;
    if (item === undefined) return [];
    const itemType = stringValue(item.type) ?? "";
    const itemId = identityValue(item.id) ?? `item_${normalizedSequence + 1}`;

    if (itemType === "agentMessage") {
      if (!completed) return [];
      // Same trap as every streaming provider: the text has already arrived as
      // deltas, and this record is the whole message. It REPLACES rather than
      // appends, or every answer doubles.
      const text = stringValue(item.text);
      if (text === undefined) return [];
      messageBuffers.set(itemId, text);
      return [
        emit("message.delta", {
          itemId,
          operation: "replace",
          text: boundedMessageText(text),
          final: true,
          evidence: evidence(notification),
        }),
      ];
    }

    if (itemType === "plan") {
      return [];
    }

    if (itemType === "contextCompaction") {
      if (!completed) return [];
      compactionItems += 1;
      return compacted(notification, compactionItems);
    }

    if (!TOOL_ITEM_TYPES.has(itemType)) {
      return completed
        ? []
        : [
            emit("step.started", {
              stepKind: "item",
              itemId,
              itemType,
              evidence: evidence(notification),
            }),
          ];
    }

    const name = toolNameOf(item);
    const command = toolCommandOf(item);
    if (!completed) {
      openTools.set(itemId, name);
      return [
        emit("tool.started", {
          itemId,
          toolKind: itemType,
          name,
          ...(command === undefined ? {} : { command }),
          phase: "started",
          evidence: evidence(notification),
        }),
      ];
    }

    openTools.delete(itemId);
    const status = stringValue(item.status);
    const exitCode = typeof item.exitCode === "number" ? item.exitCode : undefined;
    // Any terminal status but "completed" is not a success -- in particular
    // "declined", what Codex reports for a call the person refused in
    // Approve-each. It was recorded as completed, as though it had run (M2).
    const failed = (status !== undefined && status !== "completed") || (exitCode !== undefined && exitCode !== 0);
    return [
      emit(failed ? "tool.failed" : "tool.completed", {
        itemId,
        toolKind: itemType,
        name,
        ...(command === undefined ? {} : { command }),
        ...(exitCode === undefined ? {} : { exitCode }),
        ...(status === undefined ? {} : { status }),
        phase: "completed",
        evidence: evidence(notification),
      }),
    ];
  };

  return {
    get runtimeThreadId() {
      return runtimeThreadId;
    },
    get finalized() {
      return finalized;
    },

    accept(notification: AppServerNotification): readonly NormalizedRuntimeEvent[] {
      if (finalized) return [];
      const params = isObject(notification.params) ? (notification.params as Record<string, unknown>) : {};

      switch (notification.method) {
        case "thread/tokenUsage/updated": {
          const usage = isObject(params.tokenUsage) ? params.tokenUsage : undefined;
          // `total` is the thread's running count and `last` only the most
          // recent turn; the receipt is for the run, so the total is the one
          // that answers "what did this cost".
          const total = isObject(usage?.total) ? usage.total : undefined;
          if (total === undefined) return [];
          const held: Record<string, number> = {};
          const carry = (from: string, to: string): void => {
            const value = total[from];
            if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
              held[to] = value;
            }
          };
          carry("inputTokens", "inputTokens");
          carry("outputTokens", "outputTokens");
          carry("cachedInputTokens", "cacheReadTokens");
          carry("cacheWriteInputTokens", "cacheWriteTokens");
          if (Object.keys(held).length > 0) latestUsage = held;
          return [];
        }

        case "thread/started": {
          const thread = isObject(params.thread) ? params.thread : undefined;
          runtimeThreadId = identityValue(thread?.id) ?? identityValue(params.threadId);
          return [];
        }

        case "turn/started":
          runtimeThreadId = runtimeThreadId ?? identityValue(params.threadId);
          return [
            emit("run.started", {
              runtimeThreadId: runtimeThreadId ?? "",
              evidence: evidence(notification),
            }),
          ];

        case "turn/completed":
          finalized = true;
          return [
            emit("run.completed", {
              ...(runtimeThreadId === undefined ? {} : { runtimeThreadId }),
              ...(latestUsage === undefined ? {} : { usage: latestUsage }),
              process: {
                exitCode: 0,
                signal: null,
                stderr: "",
                stderrTruncated: false,
                recordCount: normalizedSequence,
                inputDeliveryFailed: false,
                outputLimitExceeded: false,
        oversizedRecordsDropped: 0,
                forcedTerminationAttempted: false,
                terminationUnconfirmed: false,
                startedAt: now().toISOString(),
                finishedAt: now().toISOString(),
              },
            }),
          ];

        case "item/started":
          return itemEvents(notification, params, false);

        case "item/completed":
          return itemEvents(notification, params, true);

        case "item/agentMessage/delta": {
          const delta = stringValue(params.delta);
          const itemId = identityValue(params.itemId);
          if (delta === undefined || itemId === undefined) return [];
          messageBuffers.set(itemId, `${messageBuffers.get(itemId) ?? ""}${delta}`);
          return [
            emit("message.delta", {
              itemId,
              operation: "append",
              text: boundedMessageText(delta),
              final: false,
              evidence: evidence(notification),
            }),
          ];
        }

        case "turn/plan/updated": {
          const plan = Array.isArray(params.plan) ? params.plan : [];
          return [
            emit("plan.updated", {
              itemId: identityValue(params.turnId) ?? "plan",
              plan: plan as unknown as JsonValue as never,
              final: false,
              evidence: evidence(notification),
            }),
          ];
        }

        case "account/rateLimits/updated": {
          const limit = limitFromSnapshot(params.rateLimits);
          // Say it once. The server pushes this repeatedly, and a transcript
          // that repeats the same warning is a transcript nobody reads.
          if (limit === undefined || announcedLimits.has(limit.kind)) return [];
          announcedLimits.add(limit.kind);
          return [
            emit("route.limit_detected", {
              kind: limit.kind,
              message: limit.message,
              evidence: evidence(notification),
            }),
          ];
        }

        case "error": {
          const error = isObject(params.error) ? params.error : {};
          const message = boundedMessageText(
            stringValue(error.message) ?? "The runtime reported an error.",
          );
          // `willRetry` means the provider intends to continue. Ending the run
          // on it would report a failure the provider is about to recover from.
          if (params.willRetry === true) {
            return [
              emit("adapter.diagnostic", {
                level: "warning",
                code: "app.retrying",
                message,
                terminal: false,
                evidence: evidence(notification),
              }),
            ];
          }
          finalized = true;
          // M3: classified, from Codex's own error info when it gives one --
          // a string, or an object keyed by the variant -- and from the
          // message when not. An exhausted quota or a signed-out account used
          // to end as "unknown", with no limit said, so no other route was
          // offered.
          const info = isObject(error.codexErrorInfo)
            ? Object.keys(error.codexErrorInfo)[0]
            : stringValue(error.codexErrorInfo);
          const kind: CodexRunFailureKind = info === "usageLimitExceeded"
            ? "quota-exhausted"
            : info === "unauthorized"
              ? "authentication-failed"
              : failureKind(message);
          const limitSaid = (kind === "quota-exhausted" || kind === "temporary-rate-limit") && !announcedLimits.has(kind);
          if (limitSaid) announcedLimits.add(kind);
          return [
            ...(limitSaid
              ? [emit("route.limit_detected", { kind, message, evidence: evidence(notification) })]
              : []),
            emit("run.failed", {
              kind,
              message,
              ...(runtimeThreadId === undefined ? {} : { runtimeThreadId }),
              runtimeTerminal: "failed",
              process: {
                exitCode: null,
                signal: null,
                stderr: "",
                stderrTruncated: false,
                recordCount: normalizedSequence,
                inputDeliveryFailed: false,
                outputLimitExceeded: false,
        oversizedRecordsDropped: 0,
                forcedTerminationAttempted: false,
                terminationUnconfirmed: false,
                startedAt: now().toISOString(),
                finishedAt: now().toISOString(),
              },
            }),
          ];
        }

        case "thread/compacted":
          compactionNotices += 1;
          return compacted(notification, compactionNotices);

        case "warning":
        case "guardianWarning":
        case "configWarning": {
          const message = stringValue(params.message);
          if (message === undefined) return [];
          return [
            emit("adapter.diagnostic", {
              level: "warning",
              code: "app.warning",
              message: boundedMessageText(message),
              terminal: false,
              evidence: evidence(notification),
            }),
          ];
        }

        default:
          // Silence by default. This protocol emits dozens of notifications
          // about MCP startup, remote control and realtime audio; turning each
          // unknown one into a diagnostic would bury the run in noise.
          return [];
      }
    },

    finish(reason): readonly NormalizedRuntimeEvent[] {
      if (finalized) return [];
      finalized = true;
      const process = {
        exitCode: null,
        signal: null,
        stderr: "",
        stderrTruncated: false,
        recordCount: normalizedSequence,
        inputDeliveryFailed: false,
        outputLimitExceeded: false,
        oversizedRecordsDropped: 0,
        forcedTerminationAttempted: reason === "cancelled",
        terminationUnconfirmed: reason === "transport-lost",
        startedAt: now().toISOString(),
        finishedAt: now().toISOString(),
      };
      if (reason === "cancelled") {
        return [
          emit("run.cancelled", {
            ...(runtimeThreadId === undefined ? {} : { runtimeThreadId }),
            process,
          }),
        ];
      }
      return [
        emit("run.failed", {
          kind: "process-failed",
          message: "The runtime connection ended before the turn completed.",
          ...(runtimeThreadId === undefined ? {} : { runtimeThreadId }),
          runtimeTerminal: "missing",
          process,
        }),
      ];
    },
  };
}
