import {
  boundedMessageText,
  identityValue,
  isObject,
  stringValue,
} from "./codex-events.js";
import type {
  CodexEventEvidence,
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
export function limitFromSnapshot(
  snapshot: unknown,
): { readonly kind: "quota-exhausted" | "temporary-rate-limit"; readonly message: string } | undefined {
  if (!isObject(snapshot)) return undefined;
  const windows: { label: string; used: number; resets: unknown }[] = [];
  for (const [label, value] of Object.entries(snapshot)) {
    if (!isObject(value)) continue;
    const used = typeof value.usedPercent === "number"
      ? value.usedPercent
      : typeof value.utilization === "number"
        ? value.utilization * 100
        : undefined;
    if (used === undefined) continue;
    windows.push({ label, used, resets: value.resetsAt ?? value.resetsInSeconds });
  }
  if (windows.length === 0) return undefined;
  const worst = windows.reduce((left, right) => (right.used > left.used ? right : left));
  if (worst.used >= 100) {
    return { kind: "quota-exhausted", message: `${worst.label} limit reached` };
  }
  // Only speak up when it is close enough to matter to a decision.
  if (worst.used >= 90) {
    return {
      kind: "temporary-rate-limit",
      message: `${worst.label} limit ${Math.round(worst.used)}% used`,
    };
  }
  return undefined;
}

export function createAppServerEventNormalizer(
  context: AppServerInvocationContext,
): AppServerEventNormalizer {
  const runId = context.runId;
  const now = context.now ?? (() => new Date());
  const runtime: MissionRuntimeId = context.runtime ?? "codex";

  const openTools = new Map<string, string>();
  const messageBuffers = new Map<string, string>();
  let runtimeThreadId: string | undefined;
  let normalizedSequence = 0;
  let finalized = false;
  let announcedLimit = false;

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
    const failed = status === "failed" || status === "error" || (exitCode !== undefined && exitCode !== 0);
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
              process: {
                exitCode: 0,
                signal: null,
                stderr: "",
                stderrTruncated: false,
                recordCount: normalizedSequence,
                inputDeliveryFailed: false,
                outputLimitExceeded: false,
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
          if (limit === undefined || announcedLimit) return [];
          announcedLimit = true;
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
          return [
            emit("run.failed", {
              kind: "unknown",
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
                forcedTerminationAttempted: false,
                terminationUnconfirmed: false,
                startedAt: now().toISOString(),
                finishedAt: now().toISOString(),
              },
            }),
          ];
        }

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
