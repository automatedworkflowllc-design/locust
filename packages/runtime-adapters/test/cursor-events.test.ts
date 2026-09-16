import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  createCursorEventNormalizer,
  cursorToolKind,
  isCursorMessageFragment,
  summarizeCursorInit,
  toolOutcome,
} from "../src/cursor-events.js";
import { toolPatchFrom } from "../src/codex-events.js";
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

  it("shows reasoning as a step and KEEPS its text", () => {
    /*
     * This asserted the opposite until 2026-09-16: the text was replaced
     * with "[redacted]" before the record was rebuilt, so the app could say
     * a model had thought for fifty-eight seconds and nothing about what it
     * thought.
     *
     * Colin's call, asked straight and answered straight: "i wanted to
     * sacrifice nothing." The objection I first gave him was softer than I
     * made it sound -- his whole ledger is about 15MB across 51 missions and
     * roughly doubling it costs nothing against the disk. What it does cost
     * is that a ledger sent to somebody now carries the working-out too,
     * which is a thing to know rather than a reason to throw it away.
     */
    const steps = events.filter((event) => event.type === "step.started" || event.type === "step.completed");
    expect(steps.every((event) => (event.payload as { stepKind: string }).stepKind === "reasoning")).toBe(true);
    expect(steps.length).toBe(4);
    const serialized = JSON.stringify(events);
    expect(serialized).toContain("Reading README.md to");
  });

  it("carries the reasoning on the step that closes, not on every fragment", () => {
    // The deltas still collapse into one step, which is unchanged and
    // deliberate: a row per fragment is a log nobody reads.
    const completed = events.filter(
      (event) => event.type === "step.completed" && (event.payload as { stepKind: string }).stepKind === "reasoning",
    );
    expect(completed.length).toBeGreaterThan(0);
    expect(completed.some((event) => ((event.payload as { message?: string }).message ?? "").length > 0)).toBe(true);
    const started = events.filter(
      (event) => event.type === "step.started" && (event.payload as { stepKind: string }).stepKind === "reasoning",
    );
    expect(started.every((event) => (event.payload as { message?: string }).message === undefined)).toBe(true);
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


describe("records Cursor sends that this adapter does not draw", () => {
  /*
   * TAKEN FROM COLIN'S LEDGERS, 2026-09-13. A room filled with two dozen
   * identical amber lines reading "Unhandled Cursor record: interaction_query",
   * burying the conversation under them.
   *
   * Two things were wrong. `interaction_query` is the same tool call the
   * adapter already draws -- Cursor announces a web search on two channels and
   * the `toolCallId` in the query is byte-for-byte the `call_id` on the
   * `tool_call` beside it -- so drawing it would have shown every search
   * twice. And an unhandled TYPE is a fact about the stream, which does not
   * get truer by being repeated once per record.
   */
  const init = JSON.stringify({ type: "system", subtype: "init", session_id: "s1", model: "Auto" });

  const run = (records: readonly unknown[]) => {
    const cursor = normalizer();
    const events: NormalizedRuntimeEvent[] = [];
    let sequence = 0;
    events.push(...cursor.accept({ sequence: (sequence += 1), raw: init }));
    for (const record of records) events.push(...cursor.accept({ sequence: (sequence += 1), raw: JSON.stringify(record) }));
    return events;
  };

  const query = (term: string) => ({
    type: "interaction_query",
    subtype: "request",
    query_type: "webSearchRequestQuery",
    query: { id: 0, webSearchRequestQuery: { args: { searchTerm: term, toolCallId: "call-1" } } },
    session_id: "s1",
    timestamp_ms: 1
  });

  it("says nothing at all about interaction_query, because the tool row already says it", () => {
    const events = run([query("TSMC capex"), query("NVDA targets"), { ...query("GOOGL"), subtype: "response" }]);
    const said = events.filter((event) => event.type === "adapter.diagnostic");
    expect(said).toHaveLength(0);
  });

  it("still draws the tool call itself, which is where a web search belongs", () => {
    const events = run([
      { type: "tool_call", subtype: "started", call_id: "call-1", tool_call: { webSearchToolCall: { args: { searchTerm: "TSMC capex" } }, toolCallId: "call-1" } },
      query("TSMC capex")
    ]);
    expect(events.some((event) => event.type === "tool.started")).toBe(true);
    // And exactly once: the query must not add a second row for the same call.
    expect(events.filter((event) => event.type === "tool.started")).toHaveLength(1);
  });

  it("says an unhandled type once a run, however many arrive", () => {
    const odd = { type: "something_new", session_id: "s1", timestamp_ms: 1 };
    const said = run([odd, odd, odd, odd]).filter(
      (event) => event.type === "adapter.diagnostic" && /Unhandled/.test((event.payload as { message: string }).message)
    );
    expect(said).toHaveLength(1);
    expect((said[0]?.payload as { message: string }).message).toContain("something_new");
  });

  it("still says each different type it meets", () => {
    const said = run([
      { type: "alpha", session_id: "s1", timestamp_ms: 1 },
      { type: "beta", session_id: "s1", timestamp_ms: 1 },
      { type: "alpha", session_id: "s1", timestamp_ms: 1 }
    ]).filter((event) => event.type === "adapter.diagnostic");
    expect(said).toHaveLength(2);
  });
});

describe("a Cursor version that marks nothing", () => {
  /*
   * TAKEN FROM COLIN'S OWN LEDGER, 2026-09-11 (mission fd0adba1), where two
   * runs the same evening disagreed about the keys on a complete message:
   *
   *   f8dedec3  type,message,session_id,model_call_id,timestamp_ms
   *   fd0adba1  type,message,session_id,timestamp_ms
   *
   * In the second nothing distinguishes the complete message from a
   * fragment, so it was appended and the reply said itself twice -- and,
   * worse, was never marked final, so the host reported "Jimothy's turn
   * ended without a reply" about a teammate who had plainly written one.
   */
  const init = JSON.stringify({ type: "system", subtype: "init", session_id: "s1", model: "Auto" });
  const WORDS = ["Looking", " up", " NVIDIA", " forward", " earnings", " now", "."];
  const WHOLE = WORDS.join("");

  const feed = (words: readonly string[], andThen: readonly string[] = []) => {
    const cursor = normalizer();
    const events: NormalizedRuntimeEvent[] = [];
    let sequence = 0;
    const accept = (value: unknown) => {
      sequence += 1;
      events.push(...cursor.accept({ sequence, raw: JSON.stringify(value) }));
    };
    const say = (text: string) =>
      accept({ type: "assistant", timestamp_ms: sequence, message: { role: "assistant", content: [{ type: "text", text }] } });
    accept(JSON.parse(init));
    for (const word of words) say(word);
    // The complete message, carrying no `model_call_id` -- indistinguishable
    // from a fragment by its keys, identifiable only by what it says.
    say(words.join(""));
    for (const word of andThen) say(word);
    return events;
  };

  it("does not let the reply say itself twice", () => {
    const built = [...messages(feed(WORDS)).values()];
    expect(built[0]).toBe(WHOLE);
    expect(built[0]).not.toBe(`${WHOLE}${WHOLE}`);
  });

  it("closes the message, which is what the rest of the host reads", () => {
    /*
     * The half that cost a reply. The share, the memory block, the room task
     * and the workroom post all read the last FINAL message; a turn that
     * never marks one said nothing, as far as they can tell.
     */
    const deltas = feed(WORDS).filter((event) => event.type === "message.delta");
    expect(deltas.at(-1)?.payload).toMatchObject({ final: true });
  });

  it("starts a new message after the complete one, rather than running two together", () => {
    // Thirty seconds later in the real run, after tool work: the ANSWER --
    // which had been concatenated onto the end of the preamble.
    const built = [...messages(feed(WORDS, ["Partly", ".", " The", " stock"])).values()];
    expect(built).toHaveLength(2);
    expect(built[0]).toBe(WHOLE);
    expect(built[1]).toBe("Partly. The stock");
  });

  it("still trusts the marker where a version sends one", () => {
    // The old rule is not replaced, only backed up: a marked complete message
    // is complete even where its text differs from the fragments.
    const cursor = normalizer();
    const events: NormalizedRuntimeEvent[] = [];
    events.push(...cursor.accept({ sequence: 1, raw: init }));
    events.push(...cursor.accept({
      sequence: 2,
      raw: JSON.stringify({ type: "assistant", timestamp_ms: 1, message: { role: "assistant", content: [{ type: "text", text: "part" }] } })
    }));
    events.push(...cursor.accept({
      sequence: 3,
      raw: JSON.stringify({ type: "assistant", model_call_id: "m1", message: { role: "assistant", content: [{ type: "text", text: "part and the rest" }] } })
    }));
    expect([...messages(events).values()][0]).toBe("part and the rest");
  });
});

describe("the change itself", () => {
  const { events } = run(fixture("write-mode-shell-rejected.jsonl"));

  it("carries the edit's unified diff as its own field, with counts derived from it", () => {
    const edit = events.find(
      (event) => event.type === "tool.completed" && (event.payload as { toolKind: string }).toolKind === "edit",
    );
    const patch = (edit?.payload as { patch?: { text: string; added: number; removed: number; truncated: boolean } }).patch;
    expect(patch?.text).toContain("+hello");
    expect(patch?.text).toContain("@@ -1,0 +1 @@");
    expect(patch).toMatchObject({ added: 1, removed: 0, truncated: false });
  });

  it("counts the whole change before bounding the text, and says when it bounded", () => {
    const lines = Array.from({ length: 3_000 }, (_, i) => `+line ${String(i)} ${"x".repeat(40)}`);
    const unified = `--- a/big.ts\n+++ b/big.ts\n@@ -1,0 +1,3000 @@\n${lines.join("\n")}\n`;
    const patch = toolPatchFrom(unified);
    expect(patch?.added).toBe(3_000);
    expect(patch?.removed).toBe(0);
    expect(patch?.truncated).toBe(true);
    expect((patch?.text.length ?? 0) < unified.length).toBe(true);
  });

  it("does not count the file headers as changed lines", () => {
    expect(toolPatchFrom("--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+new\n")).toMatchObject({ added: 1, removed: 1 });
  });

  it("records no patch for an edit that reported none", () => {
    expect(toolPatchFrom("")).toBeUndefined();
  });
});

/**
 * A long Cursor answer must still CLOSE its message.
 *
 * Reported 2026-09-08 by a Cursor teammate reading this source from inside
 * Locust: when partial output is on and the fragments already sum past the
 * message cap, the complete message is skipped -- and it used to be skipped by
 * emitting nothing at all, so the item was never marked final.
 *
 * Everything the host parses out of a reply reads the last FINAL message: the
 * share in `peer-exchange.ts` ("if (final) latestFinal = next"), the memory
 * block, a decision, a room task. So the longest, most substantial turns --
 * exactly the ones that land here -- rendered perfectly in the thread and
 * posted nothing to the workroom, with nothing on screen saying so.
 */
describe("a long answer whose fragments outrun the complete message", () => {
  const fragment = "x".repeat(9_000);
  const lines = [
    JSON.stringify({ type: "assistant", timestamp_ms: 1, message: { role: "assistant", content: [{ type: "text", text: fragment }] } }),
    JSON.stringify({ type: "assistant", timestamp_ms: 2, message: { role: "assistant", content: [{ type: "text", text: fragment }] } }),
    // The complete message: bounded to the cap, so SHORTER than the two
    // fragments already delivered.
    JSON.stringify({ type: "assistant", model_call_id: "c1", message: { role: "assistant", content: [{ type: "text", text: `${fragment}${fragment}` }] } })
  ];

  it("keeps the fragments rather than taking text back out of the ledger", () => {
    const { events } = run(lines);
    // Read the id off the events rather than assuming it.
    const built = [...messages(events).values()];
    expect(built.length).toBeGreaterThan(0);
    expect(Math.max(...built.map((text) => text.length))).toBeGreaterThanOrEqual(18_000);
  });

  it("MARKS THE MESSAGE FINAL, so the host still reads what the reply said", () => {
    // THE test. Without it the turn looks complete and posts nothing.
    const { events } = run(lines);
    const finals = events.filter(
      (event) => event.type === "message.delta" && (event.payload as { final: boolean }).final
    );
    expect(finals.length).toBeGreaterThan(0);
  });

  it("does not rewrite the text when it closes the item", () => {
    // The control: closing must not become a way to shorten the answer.
    const { events } = run(lines);
    const closing = events.filter(
      (event) => event.type === "message.delta" && (event.payload as { final: boolean }).final
    );
    for (const event of closing) {
      const { operation, text } = event.payload as { operation: string; text: string };
      if (operation === "append") expect(text).toBe("");
    }
  });
});

/*
 * Cursor keeps a plan, and Locust dropped it for ninety missions.
 *
 * Captured 2026-09-13 off a real cursor-agent run on grok-4.6, asked for
 * three files and told to keep a todo list: `updateTodosToolCall` arrived
 * four times and every one of them was drawn as an ordinary tool row.
 *
 * The trap this exists to hold down: after the first call Cursor sets
 * `merge: true` and sends ONLY the items that changed -- the last update in
 * this very fixture carries one todo. A mapping that took `args.todos` as the
 * plan would shrink three steps to one as the run finished.
 */
describe("Cursor's plan", () => {
  it("becomes a plan that never shrinks, not four tool rows", () => {
    const { events } = run(fixture("todo-plan.jsonl"));
    const plans = events.filter((event) => event.type === "plan.updated");
    expect(plans.length).toBeGreaterThanOrEqual(3);

    const sizes = plans.map((event) => (event.payload as { readonly plan: readonly unknown[] }).plan.length);
    // THE REGRESSION THIS CATCHES: the last update carries one todo.
    expect(sizes.every((size) => size === 3)).toBe(true);

    // and the todo call is never also a tool row
    expect(
      events.filter((event) => /todo/i.test(String((event.payload as { name?: string }).name ?? "")))
    ).toHaveLength(0);
  });

  it("advances the steps and finishes with all of them done", () => {
    const { events } = run(fixture("todo-plan.jsonl"));
    const plans = events.filter((event) => event.type === "plan.updated");
    const statuses = plans.map((event) =>
      ((event.payload as { readonly plan: readonly Record<string, unknown>[] }).plan).map((step) => String(step.status))
    );
    const last = statuses[statuses.length - 1] ?? [];
    expect(last.every((status) => /COMPLETED/i.test(status))).toBe(true);
    expect(statuses.some((row) => row.some((status) => /IN_PROGRESS/i.test(status)))).toBe(true);
    // The step order is the plan's own and must not be reshuffled by a merge.
    const words = ((plans[plans.length - 1]?.payload as { readonly plan: readonly Record<string, unknown>[] }).plan)
      .map((step) => String(step.content));
    expect(words).toEqual([
      "Create a.txt containing alpha",
      "Create b.txt containing beta",
      "Create c.txt listing the two file names"
    ]);
  });

  it("invents no plan from a todo call that carries nothing", () => {
    const { events } = run([
      JSON.stringify({ type: "system", subtype: "init", session_id: "s1" }),
      JSON.stringify({
        type: "tool_call",
        subtype: "completed",
        call_id: "c1",
        tool_call: { updateTodosToolCall: { args: { todos: [] }, result: { success: {} }, toolCallId: "c1" } }
      })
    ]);
    expect(events.filter((event) => event.type === "plan.updated")).toHaveLength(0);
  });
});
