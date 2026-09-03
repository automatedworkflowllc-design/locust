import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  createCursorEventNormalizer,
  cursorToolKind,
  isCursorMessageFragment,
  summarizeCursorInit,
  toolOutcome,
} from "../src/cursor-events.js";
import type { NormalizedRuntimeEvent } from "../src/codex-events.js";
import type { RuntimeProcessCompletion } from "../src/process-runner.js";

const NOW = "2026-09-02T19:00:00.000Z";

function normalizer() {
  return createCursorEventNormalizer({
    runId: "run_1",
    missionId: "mission_1",
    cliVersion: "2026.08.31-4057e58",
    now: () => new Date(NOW),
  });
}

function completion(overrides: Partial<RuntimeProcessCompletion> = {}): RuntimeProcessCompletion {
  return {
    exitCode: 0,
    signal: null,
    stderr: "",
    stderrTruncated: false,
    recordCount: 5,
    cancelled: false,
    forcedTerminationAttempted: false,
    terminationUnconfirmed: false,
    inputDeliveryFailed: false,
    outputLimitExceeded: false,
    startedAt: NOW,
    finishedAt: NOW,
    ...overrides,
  };
}

/** A stream captured off the real CLI, line by line, in transport order. */
function fixture(name: string): readonly string[] {
  return readFileSync(new URL(`./fixtures/cursor/${name}`, import.meta.url), "utf8")
    .split("\n")
    .filter((line) => line.length > 0);
}

function run(lines: readonly string[], finish: Partial<RuntimeProcessCompletion> = {}) {
  const cursor = normalizer();
  const events: NormalizedRuntimeEvent[] = [];
  lines.forEach((raw, index) => events.push(...cursor.accept({ sequence: index + 1, raw })));
  events.push(...cursor.finish(completion(finish)));
  return { cursor, events };
}

/** Rebuild message text the way the checkpoint summary does: append or replace per item. */
function messages(events: readonly NormalizedRuntimeEvent[]): ReadonlyMap<string, string> {
  const buffers = new Map<string, string>();
  for (const event of events) {
    if (event.type !== "message.delta") continue;
    const { itemId, operation, text } = event.payload as { itemId: string; operation: string; text: string };
    buffers.set(itemId, operation === "replace" ? text : `${buffers.get(itemId) ?? ""}${text}`);
  }
  return buffers;
}

describe("a read-only Cursor run with partial output, as captured", () => {
  const { cursor, events } = run(fixture("read-only-partial.jsonl"));

  it("starts the run with the session id and only the allow-listed init fields", () => {
    const started = events[0];
    expect(started?.type).toBe("run.started");
    expect(cursor.runtimeThreadId).toBe("5ea83b16-7669-44d8-aaf3-97a1b41d581b");
    const raw = (started?.payload as { evidence: { raw: Record<string, unknown>; redacted: boolean } }).evidence;
    expect(raw.redacted).toBe(true);
    expect(Object.keys(raw.raw).sort()).toEqual(["apiKeySource", "cwd", "model", "permissionMode", "session_id"]);
  });

  it("rebuilds each message from its fragments and lets the complete message replace, not double, them", () => {
    const built = [...messages(events).values()];
    expect(built).toEqual([
      "I'll read the README and summarize the project in one sentence.",
      "Pebble is a tiny CLI timer whose single command, `pebble start`, counts down 25 minutes and rings a bell.",
    ]);
  });

  it("keeps the two messages apart: the answer does not overwrite what was said before the tool ran", () => {
    const finals = events.filter((event) => event.type === "message.delta" && (event.payload as { final: boolean }).final);
    expect(finals.map((event) => (event.payload as { itemId: string }).itemId)).toEqual(["msg_0", "msg_1"]);
  });

  it("records the read as one tool that started and completed under the clean call id", () => {
    const tools = events.filter((event) => event.type.startsWith("tool."));
    expect(tools.map((event) => event.type)).toEqual(["tool.started", "tool.completed"]);
    const ids = new Set(tools.map((event) => (event.payload as { itemId: string }).itemId));
    expect(ids.size).toBe(1);
    expect([...ids][0]).not.toContain("\n");
    expect((tools[0]?.payload as { toolKind: string }).toolKind).toBe("read");
    expect((tools[0]?.payload as { command: string }).command).toContain("README.md");
  });

  it("shows reasoning as a step and never lets its text into the ledger", () => {
    const steps = events.filter((event) => event.type === "step.started" || event.type === "step.completed");
    expect(steps.every((event) => (event.payload as { stepKind: string }).stepKind === "reasoning")).toBe(true);
    expect(steps.length).toBe(4);
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain("Reading README.md to");
    expect(serialized).not.toContain("provide a one-sentence");
  });

  it("completes the run on exit 0 with a result record", () => {
    expect(events.at(-1)?.type).toBe("run.completed");
  });
});

describe("a write-mode Cursor run whose shell commands were rejected, as captured", () => {
  const { events } = run(fixture("write-mode-shell-rejected.jsonl"));

  it("reports a rejected shell command as a tool that failed, never as one that completed", () => {
    const shells = events.filter(
      (event) => event.type.startsWith("tool.") && (event.payload as { toolKind: string }).toolKind === "shell",
    );
    const completed = shells.filter((event) => event.type === "tool.completed");
    const failed = shells.filter((event) => event.type === "tool.failed");
    expect(failed.length).toBe(4);
    expect(failed.every((event) => (event.payload as { status?: string }).status === "rejected")).toBe(true);
    // `ls -la` did run, and is the one shell call that completed.
    expect(completed.length).toBe(1);
    expect((completed[0]?.payload as { command: string }).command).toBe("ls -la");
  });

  it("names the commands it refused to run, which is the fact a rejection exists to record", () => {
    // A rejected call carries no `args` at all; what it wanted to run is
    // inside the rejection. Reading only `args` left four identical blank
    // rows where the audit trail should be.
    const refused = events
      .filter((event) => event.type === "tool.failed")
      .map((event) => (event.payload as { command?: string }).command);
    expect(refused).toEqual(["dir", "dir", "cmd.exe /c dir", "dir"]);
  });

  it("reports a command that RAN and FAILED as failed, with its exit code", () => {
    // Cursor puts the command's own outcome inside the `success` wrapper:
    // success means the tool was allowed to run, not that it worked.
    expect(toolOutcome({ success: { command: "npm test", exitCode: 1 } }))
      .toEqual({ failed: true, status: "exit", exitCode: 1 });
    expect(toolOutcome({ success: { command: "ls", exitCode: 0 } })).toEqual({ failed: false, exitCode: 0 });
  });

  it("treats an outcome it has never seen as a failure, not as a success", () => {
    for (const shape of [{ aborted: {} }, { timedOut: {} }, { denied: {} }, {}]) {
      expect(toolOutcome(shape).failed).toBe(true);
    }
  });

  it("records what the run cost, the way the other adapters do", () => {
    const completed = events.at(-1);
    expect(completed?.type).toBe("run.completed");
    expect((completed?.payload as { usage?: Record<string, number> }).usage)
      .toMatchObject({ inputTokens: 15012, outputTokens: 1125 });
  });

  it("reports the edit and the glob as completed tools with their targets", () => {
    const kinds = events
      .filter((event) => event.type === "tool.completed")
      .map((event) => (event.payload as { toolKind: string }).toolKind);
    expect(kinds).toEqual(expect.arrayContaining(["edit", "glob"]));
    const edit = events.find((event) => event.type === "tool.completed" && (event.payload as { toolKind: string }).toolKind === "edit");
    expect((edit?.payload as { command: string }).command).toContain("NOTES.md");
    // A glob names a pattern AND the directory it was run in; the pattern
    // alone ("*") says nothing about where it looked.
    const glob = events.find((event) => event.type === "tool.completed" && (event.payload as { toolKind: string }).toolKind === "glob");
    expect((glob?.payload as { command: string }).command).toBe("* in C:\\work\\scratch");
  });

  it("carries the resolved model name out of init", () => {
    const raw = (events[0]?.payload as { evidence: { raw: { model: string } } }).evidence.raw;
    expect(raw.model).toBe("Composer 2.5");
  });
});

describe("a resumed Cursor turn, as captured", () => {
  const { cursor, events } = run(fixture("resumed-turn.jsonl"));

  it("keeps the earlier session id and delivers the whole answer as one final message", () => {
    expect(cursor.runtimeThreadId).toBe("5ea83b16-7669-44d8-aaf3-97a1b41d581b");
    expect([...messages(events).values()]).toEqual(["Pebble"]);
    const deltas = events.filter((event) => event.type === "message.delta");
    expect(deltas.length).toBe(1);
    expect((deltas[0]?.payload as { final: boolean }).final).toBe(true);
  });
});

describe("fragment or complete message", () => {
  it("tells them apart the way the stream does", () => {
    expect(isCursorMessageFragment({ timestamp_ms: 1, type: "assistant" })).toBe(true);
    expect(isCursorMessageFragment({ timestamp_ms: 1, model_call_id: "m", type: "assistant" })).toBe(false);
    expect(isCursorMessageFragment({ type: "assistant" })).toBe(false);
  });

  it("names tool kinds from their wrapper keys", () => {
    expect(cursorToolKind("readToolCall")).toBe("read");
    expect(cursorToolKind("shellToolCall")).toBe("shell");
    expect(cursorToolKind("somethingElse")).toBe("somethingElse");
  });

  it("summarizes init to five fields whatever else is there", () => {
    expect(summarizeCursorInit({ session_id: "s", model: "Auto", cwd: "C:\\w", permissionMode: "default", apiKeySource: "login", extra: "x" }))
      .toEqual({ session_id: "s", model: "Auto", cwd: "C:\\w", permissionMode: "default", apiKeySource: "login" });
  });
});

describe("how a Cursor run ends", () => {
  const init = JSON.stringify({ type: "system", subtype: "init", session_id: "s1", model: "Auto" });

  it("is a failure when the CLI exits clean without ever saying it finished", () => {
    const { events } = run([init]);
    expect(events.at(-1)).toMatchObject({ type: "run.failed", payload: { kind: "process-failed", runtimeTerminal: "missing" } });
  });

  it("is a failure, in the CLI's words, when the result says so", () => {
    const { events } = run([init, JSON.stringify({ type: "result", subtype: "error", is_error: true, result: "Model unavailable" })]);
    expect(events.at(-1)).toMatchObject({ type: "run.failed", payload: { kind: "unknown", message: "Model unavailable" } });
  });

  it("is cancelled when the host cancelled it", () => {
    const { events } = run([init], { cancelled: true });
    expect(events.at(-1)?.type).toBe("run.cancelled");
  });

  it("reports a record it cannot parse as a diagnostic and keeps going", () => {
    const cursor = normalizer();
    const events = cursor.accept({ sequence: 1, raw: "{not json" });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "adapter.diagnostic", payload: { code: "cursor.malformed_record" } });
  });
});

describe("a message longer than the ledger's bound", () => {
  const init = JSON.stringify({ type: "system", subtype: "init", session_id: "s1", model: "Auto" });
  const long = "x".repeat(20_000);

  it("never takes back text the fragments already delivered", () => {
    // Each fragment is bounded on its own, so fragments are never truncated;
    // the complete message can be. Replacing with the truncated copy left the
    // ledger holding LESS than it held a moment earlier.
    const cursor = normalizer();
    const events: NormalizedRuntimeEvent[] = [];
    let sequence = 0;
    const accept = (value: unknown) => {
      sequence += 1;
      events.push(...cursor.accept({ sequence, raw: JSON.stringify(value) }));
    };
    accept(JSON.parse(init));
    for (const piece of [long.slice(0, 10_000), long.slice(10_000)]) {
      accept({
        type: "assistant",
        timestamp_ms: sequence,
        message: { role: "assistant", content: [{ type: "text", text: piece }] }
      });
    }
    accept({
      type: "assistant",
      model_call_id: "m1",
      message: { role: "assistant", content: [{ type: "text", text: long }] }
    });

    const built = [...messages(events).values()];
    expect(built[0]?.length).toBe(20_000);
  });

  it("still replaces when the complete message is no shorter", () => {
    const cursor = normalizer();
    const events: NormalizedRuntimeEvent[] = [];
    events.push(...cursor.accept({ sequence: 1, raw: init }));
    events.push(...cursor.accept({
      sequence: 2,
      raw: JSON.stringify({
        type: "assistant",
        timestamp_ms: 2,
        message: { role: "assistant", content: [{ type: "text", text: "Peb" }] }
      })
    }));
    events.push(...cursor.accept({
      sequence: 3,
      raw: JSON.stringify({
        type: "assistant",
        model_call_id: "m1",
        message: { role: "assistant", content: [{ type: "text", text: "Pebble is a timer." }] }
      })
    }));
    expect([...messages(events).values()]).toEqual(["Pebble is a timer."]);
  });
});

describe("a turn that opens", () => {
  it("also closes, so nothing is left looking unfinished", () => {
    const cursor = normalizer();
    const events = cursor.accept({
      sequence: 1,
      raw: JSON.stringify({ type: "system", subtype: "compact" })
    });
    expect(events.map((event) => event.type)).toEqual(["step.started", "step.completed"]);
  });
});

describe("a message longer than the ledger's bound", () => {
  const init = JSON.stringify({ type: "system", subtype: "init", session_id: "s1", model: "Auto" });
  const long = "x".repeat(20_000);

  it("never takes back text the fragments already delivered", () => {
    // Each fragment is bounded on its own, so fragments are never truncated;
    // the complete message can be. Replacing with the truncated copy left the
    // ledger holding LESS than it held a moment earlier.
    const cursor = normalizer();
    const events: NormalizedRuntimeEvent[] = [];
    let sequence = 0;
    const accept = (value: unknown) => {
      sequence += 1;
      events.push(...cursor.accept({ sequence, raw: JSON.stringify(value) }));
    };
    accept(JSON.parse(init));
    for (const piece of [long.slice(0, 10_000), long.slice(10_000)]) {
      accept({
        type: "assistant",
        timestamp_ms: sequence,
        message: { role: "assistant", content: [{ type: "text", text: piece }] }
      });
    }
    accept({
      type: "assistant",
      model_call_id: "m1",
      message: { role: "assistant", content: [{ type: "text", text: long }] }
    });

    const built = [...messages(events).values()];
    expect(built[0]?.length).toBe(20_000);
  });

  it("still replaces when the complete message is no shorter", () => {
    const cursor = normalizer();
    const events: NormalizedRuntimeEvent[] = [];
    events.push(...cursor.accept({ sequence: 1, raw: init }));
    events.push(...cursor.accept({
      sequence: 2,
      raw: JSON.stringify({
        type: "assistant",
        timestamp_ms: 2,
        message: { role: "assistant", content: [{ type: "text", text: "Peb" }] }
      })
    }));
    events.push(...cursor.accept({
      sequence: 3,
      raw: JSON.stringify({
        type: "assistant",
        model_call_id: "m1",
        message: { role: "assistant", content: [{ type: "text", text: "Pebble is a timer." }] }
      })
    }));
    expect([...messages(events).values()]).toEqual(["Pebble is a timer."]);
  });
});

describe("a turn that opens", () => {
  it("also closes, so nothing is left looking unfinished", () => {
    const cursor = normalizer();
    const events = cursor.accept({
      sequence: 1,
      raw: JSON.stringify({ type: "system", subtype: "compact" })
    });
    expect(events.map((event) => event.type)).toEqual(["step.started", "step.completed"]);
  });
});
