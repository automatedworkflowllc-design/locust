import { describe, expect, it } from "vitest";

import {
  createAppServerEventNormalizer,
  limitFromSnapshot,
  toolCommandOf,
  toolNameOf,
} from "../src/app-server-events.js";
import type { AppServerNotification } from "../src/app-server.js";

const NOW = "2026-09-01T10:00:00.000Z";

function normalizer() {
  return createAppServerEventNormalizer({
    runId: "run_1",
    missionId: "mission_1",
    runtime: "codex",
    now: () => new Date(NOW),
  });
}

function note(method: string, params: unknown): AppServerNotification {
  return { method, params: params as never };
}

describe("run lifecycle", () => {
  it("takes the runtime thread id from thread/started without emitting an event", () => {
    const app = normalizer();
    const events = app.accept(note("thread/started", { thread: { id: "th_1" } }));
    expect(events).toEqual([]);
    expect(app.runtimeThreadId).toBe("th_1");
  });

  it("starts on turn/started and completes on turn/completed", () => {
    const app = normalizer();
    app.accept(note("thread/started", { thread: { id: "th_1" } }));
    const started = app.accept(note("turn/started", { threadId: "th_1", turn: {} }));
    const completed = app.accept(note("turn/completed", { threadId: "th_1", turn: {} }));
    expect(started.map((event) => event.type)).toEqual(["run.started"]);
    expect(completed.map((event) => event.type)).toEqual(["run.completed"]);
    expect(app.finalized).toBe(true);
  });

  it("goes quiet once finalized", () => {
    const app = normalizer();
    app.accept(note("turn/completed", { threadId: "t", turn: {} }));
    expect(app.accept(note("item/agentMessage/delta", { itemId: "a", delta: "x" }))).toEqual([]);
    expect(app.finish("cancelled")).toEqual([]);
  });

  it("reports a lost connection as failed rather than completed", () => {
    // A turn that never said it finished did not finish. Reporting success on
    // a dropped connection is how a truncated run becomes a completed one.
    const terminal = normalizer().finish("transport-lost");
    expect(terminal[0]?.type).toBe("run.failed");
    expect(terminal[0]?.type === "run.failed" && terminal[0].payload.runtimeTerminal).toBe("missing");
  });

  it("reports cancellation as cancelled", () => {
    const terminal = normalizer().finish("cancelled");
    expect(terminal[0]?.type).toBe("run.cancelled");
  });
});

describe("assistant text", () => {
  it("appends deltas and replaces on the completed item", () => {
    const app = normalizer();
    const deltas = ["Hel", "lo"].flatMap((delta) =>
      app.accept(note("item/agentMessage/delta", { itemId: "msg_1", delta, threadId: "t", turnId: "u" })),
    );
    expect(deltas.every((event) => event.type === "message.delta")).toBe(true);
    for (const event of deltas) {
      expect(event.type === "message.delta" && event.payload.operation).toBe("append");
    }

    // The completed item carries the WHOLE message. Appending it would double
    // every answer -- the same trap every streaming provider sets.
    const [complete] = app.accept(
      note("item/completed", {
        threadId: "t",
        turnId: "u",
        completedAtMs: 1,
        item: { id: "msg_1", type: "agentMessage", text: "Hello" },
      }),
    );
    expect(complete?.type === "message.delta" && complete.payload.operation).toBe("replace");
    expect(complete?.type === "message.delta" && complete.payload.final).toBe(true);
    expect(complete?.type === "message.delta" && complete.payload.text).toBe("Hello");
  });

  it("ignores a delta with no text or no item", () => {
    const app = normalizer();
    expect(app.accept(note("item/agentMessage/delta", { itemId: "a" }))).toEqual([]);
    expect(app.accept(note("item/agentMessage/delta", { delta: "x" }))).toEqual([]);
  });
});

describe("tools", () => {
  function startItem(item: Record<string, unknown>) {
    return note("item/started", { threadId: "t", turnId: "u", startedAtMs: 1, item });
  }
  function completeItem(item: Record<string, unknown>) {
    return note("item/completed", { threadId: "t", turnId: "u", completedAtMs: 2, item });
  }

  it("opens and settles a command execution", () => {
    const app = normalizer();
    const [started] = app.accept(
      startItem({ id: "exec_1", type: "commandExecution", command: "pnpm test" }),
    );
    expect(started?.type).toBe("tool.started");
    expect(started?.type === "tool.started" && started.payload.name).toBe("shell");
    expect(started?.type === "tool.started" && started.payload.command).toBe("pnpm test");

    const [done] = app.accept(
      completeItem({ id: "exec_1", type: "commandExecution", command: "pnpm test", exitCode: 0, status: "completed" }),
    );
    expect(done?.type).toBe("tool.completed");
  });

  it("treats a non-zero exit as a failure even when the status says otherwise", () => {
    const app = normalizer();
    app.accept(startItem({ id: "exec_1", type: "commandExecution", command: "false" }));
    const [done] = app.accept(
      completeItem({ id: "exec_1", type: "commandExecution", exitCode: 1, status: "completed" }),
    );
    expect(done?.type).toBe("tool.failed");
  });

  it("names an MCP tool by server and tool", () => {
    expect(toolNameOf({ type: "mcpToolCall", server: "gmail", tool: "send" })).toBe("gmail.send");
    expect(toolNameOf({ type: "fileChange" })).toBe("apply_patch");
    expect(toolNameOf({ type: "webSearch" })).toBe("web_search");
  });

  it("describes a file change by its count rather than its diff", () => {
    // The diff can be enormous and this lands in a durable ledger.
    expect(toolCommandOf({ type: "fileChange", changes: [1, 2, 3] })).toBe("3 file change(s)");
  });

  it("treats an unknown non-tool item as a step, not a tool", () => {
    const app = normalizer();
    const [event] = app.accept(startItem({ id: "r_1", type: "reasoning" }));
    expect(event?.type).toBe("step.started");
  });
});

describe("rate limits", () => {
  it("says nothing while usage is comfortable", () => {
    // The server pushes this unprompted and usually while everything is fine.
    expect(limitFromSnapshot({ weekly: { usedPercent: 31 } })).toBeUndefined();
    expect(limitFromSnapshot({})).toBeUndefined();
    expect(limitFromSnapshot(null)).toBeUndefined();
  });

  it("warns near the limit and reports exhaustion at it", () => {
    expect(limitFromSnapshot({ weekly: { usedPercent: 92 } })?.kind).toBe("temporary-rate-limit");
    expect(limitFromSnapshot({ weekly: { usedPercent: 100 } })?.kind).toBe("quota-exhausted");
  });

  it("reports the worst window, not the first", () => {
    const limit = limitFromSnapshot({ fiveHour: { usedPercent: 10 }, weekly: { usedPercent: 95 } })
    expect(limit?.message).toContain("weekly");
  });

  it("accepts a fractional utilization as well as a percent", () => {
    expect(limitFromSnapshot({ weekly: { utilization: 0.95 } })?.kind).toBe("temporary-rate-limit");
  });

  it("announces a limit once rather than on every push", () => {
    const app = normalizer();
    const first = app.accept(note("account/rateLimits/updated", { rateLimits: { weekly: { usedPercent: 95 } } }));
    const second = app.accept(note("account/rateLimits/updated", { rateLimits: { weekly: { usedPercent: 96 } } }));
    expect(first.map((event) => event.type)).toEqual(["route.limit_detected"]);
    // A transcript that repeats the same warning is one nobody reads.
    expect(second).toEqual([]);
  });
});

describe("errors and noise", () => {
  it("does not end the run on an error the provider intends to retry", () => {
    const app = normalizer();
    const events = app.accept(
      note("error", { threadId: "t", turnId: "u", willRetry: true, error: { message: "rate limited" } }),
    );
    expect(events[0]?.type).toBe("adapter.diagnostic");
    expect(app.finalized).toBe(false);
  });

  it("ends the run on an error the provider will not retry", () => {
    const app = normalizer();
    const events = app.accept(
      note("error", { threadId: "t", turnId: "u", willRetry: false, error: { message: "no auth" } }),
    );
    expect(events[0]?.type).toBe("run.failed");
    expect(app.finalized).toBe(true);
  });

  it("stays silent on the protocol's many unrelated notifications", () => {
    // MCP startup, remote control and realtime audio all stream through here;
    // a diagnostic per unknown method would bury the actual run.
    const app = normalizer();
    for (const method of [
      "mcpServer/startupStatus/updated",
      "remoteControl/status/changed",
      "thread/tokenUsage/updated",
      "thread/status/changed",
      "fs/changed",
    ]) {
      expect(app.accept(note(method, {}))).toEqual([]);
    }
  });

  it("stamps every event with the mission runtime", () => {
    const app = createAppServerEventNormalizer({ runId: "run_1", runtime: "claude", now: () => new Date(NOW) });
    const events = app.accept(note("turn/started", { threadId: "t", turn: {} }));
    expect(events[0]?.sourceAdapter).toBe("claude");
  });
});
