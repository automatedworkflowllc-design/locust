import { describe, expect, it } from "vitest";
import { createCodexEventNormalizer } from "../src/index.js";
import type {
  CodexEventNormalizer,
  NormalizedRuntimeEvent,
  NormalizedRuntimeEventType,
  RuntimeProcessCompletion,
} from "../src/index.js";

const NOW = "2026-08-31T14:00:00.000Z";

function normalizer(): CodexEventNormalizer {
  return createCodexEventNormalizer({
    runId: "run-1",
    missionId: "mission-1",
    requestedRouteId: "auto",
    resolvedRouteId: "codex-account:gpt-test",
    cliVersion: "0.151.0-alpha.7.2",
    now: () => new Date(NOW),
  });
}

function feed(
  target: CodexEventNormalizer,
  records: readonly (string | Record<string, unknown>)[],
): NormalizedRuntimeEvent[] {
  return records.flatMap((record, index) => target.accept({
    sequence: index + 1,
    raw: typeof record === "string" ? record : JSON.stringify(record),
  }));
}

function completion(
  overrides: Partial<RuntimeProcessCompletion> = {},
): RuntimeProcessCompletion {
  return {
    exitCode: 0,
    signal: null,
    stderr: "",
    stderrTruncated: false,
    recordCount: 0,
    cancelled: false,
    forcedTerminationAttempted: false,
    terminationUnconfirmed: false,
    inputDeliveryFailed: false,
    outputLimitExceeded: false,
    startedAt: "2026-08-31T13:59:59.000Z",
    finishedAt: NOW,
    ...overrides,
  };
}

function ofType<TType extends NormalizedRuntimeEventType>(
  events: readonly NormalizedRuntimeEvent[],
  type: TType,
): Array<Extract<NormalizedRuntimeEvent, { readonly type: TType }>> {
  return events.filter(
    (event): event is Extract<NormalizedRuntimeEvent, { readonly type: TType }> =>
      event.type === type,
  );
}

describe("Codex JSONL event normalizer", () => {
  it("normalizes the official success shape and waits for a clean host exit", () => {
    const target = normalizer();
    const events = feed(target, [
      { type: "thread.started", thread_id: "thread-123" },
      { type: "turn.started" },
      {
        type: "item.completed",
        item: { id: "item-0", type: "agent_message", text: "Mission complete." },
      },
      {
        type: "turn.completed",
        usage: {
          input_tokens: 120,
          cached_input_tokens: 80,
          output_tokens: 12,
          reasoning_output_tokens: 4,
          cache_write_input_tokens: 2,
        },
      },
    ]);

    expect(events.map(({ type }) => type)).toEqual([
      "run.started",
      "step.started",
      "message.delta",
      "step.completed",
    ]);
    expect(target.runtimeThreadId).toBe("thread-123");
    expect(ofType(events, "message.delta")[0]?.payload).toMatchObject({
      itemId: "item-0",
      operation: "replace",
      text: "Mission complete.",
      final: true,
    });
    expect(events.map(({ sequence }) => sequence)).toEqual([1, 2, 3, 4]);
    expect(events.every(({ occurredAt }) => occurredAt === NOW)).toBe(true);
    expect(events[0]).toMatchObject({
      runId: "run-1",
      missionId: "mission-1",
      requestedRouteId: "auto",
      resolvedRouteId: "codex-account:gpt-test",
      sourceAdapter: "codex",
      cliVersion: "0.151.0-alpha.7.2",
    });

    // A provider turn completion is not itself a product terminal event.
    expect(ofType(events, "run.completed")).toHaveLength(0);
    const terminal = target.finish(completion({ recordCount: 4 }));
    expect(ofType(terminal, "run.completed")[0]?.payload).toMatchObject({
      runtimeThreadId: "thread-123",
      usage: {
        input_tokens: 120,
        cached_input_tokens: 80,
        output_tokens: 12,
        reasoning_output_tokens: 4,
        cache_write_input_tokens: 2,
      },
      process: { exitCode: 0, signal: null, recordCount: 4 },
    });
    expect(target.finalized).toBe(true);
    expect(target.finish(completion())).toEqual([]);
  });

  it("classifies and deduplicates the observed quota-exhaustion sequence", () => {
    const target = normalizer();
    const quotaMessage = "You've hit your usage limit. Try again later.";
    const events = feed(target, [
      { type: "thread.started", thread_id: "01a0567a-bd81-7003-b870-67defca91130" },
      {
        type: "item.completed",
        item: { id: "item_0", type: "error", message: "nonterminal diagnostic" },
      },
      { type: "turn.started" },
      { type: "error", message: quotaMessage },
      { type: "turn.failed", error: { message: quotaMessage } },
    ]);

    expect(ofType(events, "route.limit_detected")).toHaveLength(1);
    expect(ofType(events, "route.limit_detected")[0]?.payload).toMatchObject({
      kind: "quota-exhausted",
      message: quotaMessage,
    });
    expect(ofType(events, "adapter.diagnostic").some(
      ({ payload }) => payload.code === "codex.item_error" && payload.terminal === false,
    )).toBe(true);
    expect(ofType(events, "run.failed")).toHaveLength(0);

    const terminal = target.finish(completion({ exitCode: 1, recordCount: 5 }));
    expect(ofType(terminal, "run.failed")[0]?.payload).toMatchObject({
      kind: "quota-exhausted",
      message: quotaMessage,
      runtimeTerminal: "failed",
      process: { exitCode: 1 },
    });
  });

  it("keeps an item error nonterminal when the turn later succeeds", () => {
    const target = normalizer();
    const events = feed(target, [
      { type: "thread.started", thread_id: "thread-recovered" },
      {
        type: "item.completed",
        item: {
          id: "recoverable",
          type: "error",
          message: "You've hit your usage limit. Try again later.",
        },
      },
      { type: "turn.started" },
      {
        type: "item.completed",
        item: { id: "answer", type: "agent_message", text: "Recovered safely." },
      },
      { type: "turn.completed", usage: { output_tokens: 3 } },
    ]);

    const diagnostic = ofType(events, "adapter.diagnostic").find(
      ({ payload }) => payload.code === "codex.item_error",
    );
    expect(diagnostic?.payload.terminal).toBe(false);
    expect(ofType(events, "route.limit_detected")).toHaveLength(0);
    expect(ofType(events, "run.failed")).toHaveLength(0);
    expect(ofType(target.finish(completion({ recordCount: 5 })), "run.completed")).toHaveLength(1);
  });

  it("preserves unknown/additive provider data after redaction and never stores reasoning text", () => {
    const target = normalizer();
    const events = feed(target, [
      {
        type: "thread.started",
        thread_id: "thread-forward-compatible",
        provider_version: 2,
        api_key: "sk-abcdefghijklmnopqrstuvwxyz",
      },
      {
        type: "future.event",
        feature: { enabled: true, access_token: "very-secret-token-value" },
      },
      {
        type: "item.completed",
        item: {
          id: "reasoning-1",
          type: "reasoning",
          text: "private chain of thought must never persist",
          summary: "also private",
          status: "completed",
        },
      },
    ]);

    const serialized = JSON.stringify(events);
    expect(serialized).toContain("provider_version");
    expect(serialized).toContain("future.event");
    expect(serialized).toContain("[redacted]");
    expect(serialized).not.toContain("sk-abcdefghijklmnopqrstuvwxyz");
    expect(serialized).not.toContain("very-secret-token-value");
    expect(serialized).not.toContain("private chain of thought");
    expect(serialized).not.toContain("also private");
    expect(ofType(events, "adapter.diagnostic").some(
      ({ payload }) => payload.code === "codex.unknown_event",
    )).toBe(true);
    expect(ofType(events, "step.completed").some(
      ({ payload }) => payload.stepKind === "reasoning",
    )).toBe(true);
  });

  it("turns malformed JSON into a redacted, nonterminal diagnostic", () => {
    const target = normalizer();
    const [event] = target.accept({
      sequence: 1,
      raw: '{"type":"error","api_key=sk-abcdefghijklmnopqrstuvwxyz"',
    });

    expect(event).toMatchObject({
      type: "adapter.diagnostic",
      payload: {
        code: "codex.malformed_json",
        terminal: false,
      },
    });
    expect(JSON.stringify(event)).not.toContain("sk-abcdefghijklmnopqrstuvwxyz");
    expect(JSON.stringify(event)).toContain("[redacted]");
  });

  it("synthesizes cancellation only from host-owned completion correlation", () => {
    const target = normalizer();
    const events = feed(target, [
      { type: "thread.started", thread_id: "thread-cancelled" },
      { type: "turn.started" },
    ]);
    expect(ofType(events, "run.cancelled")).toHaveLength(0);

    const terminal = target.finish(completion({
      exitCode: null,
      signal: "SIGINT",
      cancelled: true,
      recordCount: 2,
    }));
    expect(ofType(terminal, "run.cancelled")[0]?.payload).toMatchObject({
      runtimeThreadId: "thread-cancelled",
      process: { exitCode: null, signal: "SIGINT" },
    });
    expect(ofType(terminal, "run.failed")).toHaveLength(0);
  });

  it("rejects both EOF/exit mismatches instead of claiming success", () => {
    const completedButBadExit = normalizer();
    feed(completedButBadExit, [
      { type: "thread.started", thread_id: "thread-one" },
      { type: "turn.completed" },
    ]);
    expect(ofType(
      completedButBadExit.finish(completion({ exitCode: 1, recordCount: 2 })),
      "run.failed",
    )[0]?.payload).toMatchObject({
      kind: "protocol-mismatch",
      runtimeTerminal: "completed",
      process: { exitCode: 1 },
    });

    const cleanExitWithoutTerminal = normalizer();
    feed(cleanExitWithoutTerminal, [
      { type: "thread.started", thread_id: "thread-two" },
      { type: "turn.started" },
    ]);
    expect(ofType(
      cleanExitWithoutTerminal.finish(completion({ recordCount: 2 })),
      "run.failed",
    )[0]?.payload).toMatchObject({
      kind: "protocol-mismatch",
      runtimeTerminal: "missing",
      process: { exitCode: 0 },
    });
  });

  it("normalizes message append deltas and accumulated-text replacement", () => {
    const target = normalizer();
    const events = feed(target, [
      {
        type: "item.started",
        item: { id: "message-1", type: "agent_message", text: "Hel" },
      },
      {
        type: "item.updated",
        item: { id: "message-1", type: "agent_message", delta: "lo" },
      },
      {
        type: "item.updated",
        item: { id: "message-1", type: "agent_message", text: "Hello world" },
      },
      {
        type: "item.updated",
        item: { id: "message-1", type: "agent_message", text: "Corrected" },
      },
      {
        type: "item.completed",
        item: { id: "message-1", type: "agent_message", text: "Corrected" },
      },
    ]);

    expect(ofType(events, "message.delta").map(({ payload }) => ({
      operation: payload.operation,
      text: payload.text,
      final: payload.final,
    }))).toEqual([
      { operation: "replace", text: "Hel", final: false },
      { operation: "append", text: "lo", final: false },
      { operation: "append", text: " world", final: false },
      { operation: "replace", text: "Corrected", final: false },
      { operation: "append", text: "", final: true },
    ]);
  });

  it("emits a tool failure without forcing the whole run to fail", () => {
    const target = normalizer();
    const events = feed(target, [
      { type: "thread.started", thread_id: "thread-command" },
      { type: "turn.started" },
      {
        type: "item.started",
        item: {
          id: "command-1",
          type: "command_execution",
          command: "rg needle .",
          status: "in_progress",
        },
      },
      {
        type: "item.completed",
        item: {
          id: "command-1",
          type: "command_execution",
          command: "rg needle .",
          status: "failed",
          exit_code: 2,
          aggregated_output: "authorization=Bearer abcdefghijklmnop",
        },
      },
      { type: "turn.completed", usage: { output_tokens: 9 } },
    ]);

    expect(ofType(events, "tool.started")[0]?.payload).toMatchObject({
      itemId: "command-1",
      name: "shell",
      command: "rg needle .",
      status: "in_progress",
    });
    const failedTool = ofType(events, "tool.failed")[0];
    expect(failedTool?.payload).toMatchObject({
      itemId: "command-1",
      status: "failed",
      exitCode: 2,
    });
    expect(JSON.stringify(failedTool)).not.toContain("abcdefghijklmnop");
    expect(ofType(target.finish(completion({ recordCount: 5 })), "run.completed")).toHaveLength(1);
  });

  it("does not mistake incidental usage-limit wording for confirmed quota exhaustion", () => {
    const target = normalizer();
    const events = feed(target, [
      { type: "error", message: "Usage limit monitoring is disabled in this build." },
      { type: "turn.failed", error: { message: "Unknown runtime failure" } },
    ]);
    expect(ofType(events, "route.limit_detected")).toHaveLength(0);
    expect(ofType(
      target.finish(completion({ exitCode: 1, recordCount: 2 })),
      "run.failed",
    )[0]?.payload.kind).toBe("process-failed");
  });
});

describe("ledger-writable bounds", () => {
  const NUL = String.fromCharCode(0);

  it("clamps identity fields the mission ledger caps at 512 characters", () => {
    const target = normalizer();
    const events = feed(target, [
      { type: "thread.started", thread_id: "thread-bounds" },
      {
        type: "item.completed",
        item: {
          id: "i".repeat(900),
          type: "mcp_tool_call",
          server: "s".repeat(400),
          tool: "t".repeat(400),
          status: "u".repeat(700),
        },
      },
    ]);
    const tool = ofType(events, "tool.completed")[0];
    expect(tool).toBeDefined();
    const payload = tool?.payload as { itemId: string; name: string; status?: string };
    // Clamped, not dropped: the record is still identifiable afterwards.
    expect(payload.itemId.length).toBeLessThanOrEqual(512);
    expect(payload.name.length).toBeLessThanOrEqual(512);
    expect(payload.status?.length ?? 0).toBeLessThanOrEqual(512);
    expect(payload.itemId.startsWith("iii")).toBe(true);
    expect(payload.name.startsWith("sss")).toBe(true);
  });

  it("strips NUL from every persisted string", () => {
    const target = normalizer();
    const events = feed(target, [
      { type: "thread.started", thread_id: `thread${NUL}-nul` },
      {
        type: "item.completed",
        item: {
          id: `answer${NUL}`,
          type: "agent_message",
          text: `Durable${NUL} result`,
        },
      },
    ]);
    // A NUL anywhere in a persisted string makes the ledger reader refuse the
    // record, and recovery then stops at that point -- so none may survive.
    // Walk the real string values: JSON.stringify escapes NUL to a six-character
    // sequence, so searching its output for a NUL can never fail.
    const strings: string[] = [];
    const walk = (value: unknown): void => {
      if (typeof value === "string") strings.push(value);
      else if (Array.isArray(value)) value.forEach(walk);
      else if (value !== null && typeof value === "object") {
        Object.values(value as Record<string, unknown>).forEach(walk);
      }
    };
    walk(events);
    expect(strings.length).toBeGreaterThan(0);
    expect(strings.filter((entry) => entry.includes(NUL))).toEqual([]);
  });
});
