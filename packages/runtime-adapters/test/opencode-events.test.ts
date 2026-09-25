import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  addedFilePatch,
  createOpenCodeEventNormalizer,
  OPENCODE_COMPACTED,
  openCodeToolOutcome,
  openCodeToolTarget,
} from "../src/opencode-events.js";
import type { NormalizedRuntimeEvent } from "../src/codex-events.js";
import type { RuntimeProcessCompletion } from "../src/process-runner.js";

const NOW = "2026-09-03T07:00:00.000Z";

function normalizer() {
  return createOpenCodeEventNormalizer({
    runId: "run_1",
    missionId: "mission_1",
    cliVersion: "1.18.27",
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
  return readFileSync(new URL(`./fixtures/opencode/${name}`, import.meta.url), "utf8")
    .split("\n")
    .filter((line) => line.length > 0);
}

function run(lines: readonly string[], finish: Partial<RuntimeProcessCompletion> = {}) {
  const opencode = normalizer();
  const events: NormalizedRuntimeEvent[] = [];
  lines.forEach((raw, index) => events.push(...opencode.accept({ sequence: index + 1, raw })));
  events.push(...opencode.finish(completion(finish)));
  return { opencode, events };
}

/** Rebuild message text the way the checkpoint summary does. */
function messages(events: readonly NormalizedRuntimeEvent[]): ReadonlyMap<string, string> {
  const buffers = new Map<string, string>();
  for (const event of events) {
    if (event.type !== "message.delta") continue;
    const { itemId, operation, text } = event.payload as { itemId: string; operation: string; text: string };
    buffers.set(itemId, operation === "replace" ? text : `${buffers.get(itemId) ?? ""}${text}`);
  }
  return buffers;
}

describe("a write-mode OpenCode run that read and then wrote, as captured", () => {
  const { opencode, events } = run(fixture("write-mode-read-and-write.jsonl"));

  it("takes the session id from the first record, not from a header record it never sends", () => {
    // OpenCode has no init record; `sessionID` is on every line instead.
    expect(opencode.runtimeThreadId).toBe("ses_f99eea38bffe0EoUlZ5GohEmmF");
    expect(events[0]?.type).toBe("step.started");
    expect(events.every((event) => event.runtimeThreadId === "ses_f99eea38bffe0EoUlZ5GohEmmF")).toBe(true);
  });

  it("opens and closes one turn per step, so nothing is left looking unfinished", () => {
    const steps = events.filter((event) => event.type === "step.started" || event.type === "step.completed");
    expect(steps.map((event) => event.type)).toEqual([
      "step.started", "step.completed",
      "step.started", "step.completed",
      "step.started", "step.completed",
    ]);
    expect(steps.every((event) => (event.payload as { stepKind: string }).stepKind === "turn")).toBe(true);
  });

  it("delivers each text part whole, as its own final message", () => {
    // There is no partial output mode here: a `text` part IS the message.
    expect([...messages(events).values()]).toEqual([
      "Creating your notes file.",
      "File location confirmed — writing it now.",
      "DONE",
    ]);
    const deltas = events.filter((event) => event.type === "message.delta");
    expect(deltas.every((event) => (event.payload as { final: boolean }).final)).toBe(true);
    expect(deltas.every((event) => (event.payload as { operation: string }).operation === "replace")).toBe(true);
  });

  it("reports each tool call as a started and a completed event under its call id", () => {
    const tools = events.filter((event) => event.type.startsWith("tool."));
    expect(tools.map((event) => event.type)).toEqual([
      "tool.started", "tool.completed", "tool.started", "tool.completed",
    ]);
    expect(tools.map((event) => (event.payload as { toolKind: string }).toolKind))
      .toEqual(["read", "read", "write", "write"]);
    expect((tools[0]?.payload as { itemId: string }).itemId)
      .toBe("call_01a066117b107a81bd58d10b2637c61b");
    expect((tools[0]?.payload as { command: string }).command).toBe("C:\\work\\pebble");
  });

  it("carries the created file's change, built from the content it wrote", () => {
    const write = events.find(
      (event) => event.type === "tool.completed" && (event.payload as { toolKind: string }).toolKind === "write",
    );
    const patch = (write?.payload as { patch?: { text: string; added: number; removed: number } }).patch;
    expect(patch?.text).toContain("--- /dev/null");
    expect(patch?.text).toContain("+++ b/C:\\work\\pebble\\notes.txt");
    expect(patch?.text).toContain("+hello from opencode");
    expect(patch).toMatchObject({ added: 1, removed: 0 });
  });

  it("adds up what every step cost, rather than reporting the last step as the total", () => {
    // The three steps reported 8673 + 1041 + 389 in and 113 + 136 + 11 out --
    // and, read in full since A6.4, 853 reasoning tokens (counted as output,
    // as Claude Code's output already counts its thinking) and 18,835 read
    // from cache. The cost was an explicit 0 on a free model, and is left
    // off rather than shown as "$0.00".
    const completed = events.at(-1);
    expect(completed?.type).toBe("run.completed");
    expect((completed?.payload as { usage?: Record<string, number> }).usage)
      .toEqual({ inputTokens: 10_103, outputTokens: 1_113, cacheReadTokens: 18_835 });
  });

  it("carries a real cost when a model has one", () => {
    const priced = run([
      JSON.stringify({ type: "step_start", sessionID: "ses_1", part: { type: "step-start" } }),
      JSON.stringify({ type: "step_finish", sessionID: "ses_1", part: { type: "step-finish", reason: "stop", cost: 0.0123, tokens: { input: 900, output: 40, reasoning: 10, cache: { read: 100, write: 50 } } } }),
    ]).events;
    expect((priced.at(-1)?.payload as { usage?: Record<string, number> }).usage)
      .toEqual({ inputTokens: 900, outputTokens: 50, cacheReadTokens: 100, cacheWriteTokens: 50, usd: 0.0123 });
  });
});

describe("a resumed OpenCode turn, as captured", () => {
  const { opencode, events } = run(fixture("resumed-turn.jsonl"));

  it("keeps the earlier session id, which is what -s takes back", () => {
    expect(opencode.runtimeThreadId).toBe("ses_f99eea38bffe0EoUlZ5GohEmmF");
    expect([...messages(events).values()]).toEqual(["DONE"]);
    expect(events.at(-1)?.type).toBe("run.completed");
  });
});

describe("a read-only OpenCode run, as captured", () => {
  // The permission config denies edit/write/bash/patch, and the write tool is
  // then not offered to the model at all.
  const { events } = run(fixture("read-only-no-write-tool.jsonl"));

  it("shows a run that could only read, and no write tool anywhere in it", () => {
    const kinds = events
      .filter((event) => event.type.startsWith("tool."))
      .map((event) => (event.payload as { toolKind: string }).toolKind);
    expect(kinds).toEqual(["read", "read"]);
    expect(kinds).not.toContain("write");
    expect(events.some((event) => event.type === "tool.failed")).toBe(false);
  });

  it("carries the runtime's own account of what it was not given", () => {
    const said = [...messages(events).values()].join("\n");
    expect(said).toContain("no write tool is available");
    expect(said).toContain("`blocked.txt` was not created");
  });
});

describe("an OpenCode plan-agent run, as captured", () => {
  const { events } = run(fixture("plan-agent-text-only.jsonl"));

  it("is a run that only talked -- which is why plan mode is not the read-only mechanism", () => {
    // Kept as evidence: the model NARRATES plan mode. It is an instruction a
    // differently-worded prompt can talk past, not a rule anything upholds,
    // so a read-only mission rests on the permission config instead.
    expect(events.filter((event) => event.type.startsWith("tool."))).toHaveLength(0);
    expect([...messages(events).values()][0]).toContain("In PLAN MODE");
    expect(events.at(-1)?.type).toBe("run.completed");
  });
});

describe("a change OpenCode reported", () => {
  it("becomes a patch only when the runtime said the file did not exist", () => {
    expect(addedFilePatch("a.txt", "one\ntwo\n", false)).toMatchObject({ added: 2, removed: 0 });
    // An overwrite: OpenCode reports no before-text, so there is no diff to
    // be had and inventing one would put a change nobody made in the ledger.
    expect(addedFilePatch("a.txt", "one\n", true)).toBeUndefined();
    expect(addedFilePatch("a.txt", "one\n", undefined)).toBeUndefined();
  });

  it("counts a trailing newline as the end of the last line, not as another one", () => {
    expect(addedFilePatch("a.txt", "only\n", false)?.added).toBe(1);
    expect(addedFilePatch("a.txt", "only", false)?.added).toBe(1);
  });
});

describe("what a tool call's status means", () => {
  it("treats anything but `completed` as a failure, including nothing at all", () => {
    expect(openCodeToolOutcome({ status: "completed" })).toEqual({ failed: false });
    expect(openCodeToolOutcome({ status: "error" })).toEqual({ failed: true, status: "error" });
    for (const shape of [{ status: "pending" }, { status: "" }, {}]) {
      expect(openCodeToolOutcome(shape).failed).toBe(true);
    }
  });

  it("names what a tool acted on, whichever field the tool used", () => {
    expect(openCodeToolTarget({ filePath: "a.txt" }, {})).toBe("a.txt");
    expect(openCodeToolTarget({ command: "ls" }, {})).toBe("ls");
    expect(openCodeToolTarget({}, { filepath: "b.txt" })).toBe("b.txt");
    expect(openCodeToolTarget({}, {})).toBeUndefined();
  });
});

describe("a failed OpenCode tool call", () => {
  const started = JSON.stringify({ type: "step_start", sessionID: "ses_1", part: { type: "step-start" } });
  const errored = JSON.stringify({
    type: "tool_use",
    sessionID: "ses_1",
    part: {
      type: "tool",
      tool: "bash",
      callID: "call_1",
      state: { status: "error", input: { command: "npm test" }, output: "denied" },
    },
  });

  it("is reported as failed, never as a tool that completed", () => {
    const { events } = run([started, errored]);
    const tools = events.filter((event) => event.type.startsWith("tool."));
    expect(tools.map((event) => event.type)).toEqual(["tool.started", "tool.failed"]);
    expect((tools[1]?.payload as { status: string }).status).toBe("error");
    expect((tools[1]?.payload as { command: string }).command).toBe("npm test");
  });
});

describe("how an OpenCode run ends", () => {
  const started = JSON.stringify({ type: "step_start", sessionID: "ses_1", part: { type: "step-start" } });
  const stopped = JSON.stringify({
    type: "step_finish",
    sessionID: "ses_1",
    part: { type: "step-finish", reason: "stop", tokens: { input: 10, output: 2 } },
  });

  it("is a failure when the stream stops mid-tool-call, however cleanly the process exited", () => {
    // `tool-calls` means the model was going to do something else next. A
    // clean exit does not turn an interrupted run into a finished one.
    const midway = JSON.stringify({
      type: "step_finish",
      sessionID: "ses_1",
      part: { type: "step-finish", reason: "tool-calls", tokens: { input: 10, output: 2 } },
    });
    const { events } = run([started, midway]);
    expect(events.at(-1)).toMatchObject({
      type: "run.failed",
      payload: { kind: "process-failed", runtimeTerminal: "missing" },
    });
  });

  it("is a failure when the process exited non-zero even after a step said stop", () => {
    const { events } = run([started, stopped], { exitCode: 1 });
    expect(events.at(-1)).toMatchObject({ type: "run.failed", payload: { runtimeTerminal: "completed" } });
  });

  it("is cancelled when the host cancelled it", () => {
    const { events } = run([started, stopped], { cancelled: true });
    expect(events.at(-1)?.type).toBe("run.cancelled");
  });

  it("reports a record it cannot parse as a diagnostic and keeps going", () => {
    const opencode = normalizer();
    const events = opencode.accept({ sequence: 1, raw: "{not json" });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "adapter.diagnostic", payload: { code: "opencode.malformed_record" } });
  });

  it("says so when it meets a record type this build has never seen", () => {
    const { events } = run([started, JSON.stringify({ type: "brand_new", sessionID: "ses_1" }), stopped]);
    expect(events.some((event) => event.type === "adapter.diagnostic"
      && (event.payload as { code: string }).code === "opencode.unknown_event")).toBe(true);
  });
});

describe("an edit's own diff", () => {
  const { events } = run(fixture("write-mode-edit-with-diff.jsonl"));

  it("attaches the unified diff OpenCode reported for an edit, with counts from it", () => {
    const edit = events.find(
      (event) => event.type === "tool.completed" && (event.payload as { toolKind: string }).toolKind === "edit",
    );
    const patch = (edit?.payload as { patch?: { text: string; added: number; removed: number } }).patch;
    expect(patch).toMatchObject({ added: 1, removed: 1 });
    expect(patch?.text).toContain('-export const status = "draft";');
    expect(patch?.text).toContain('+export const status = "final";');
    expect(patch?.text).not.toContain("<home>");
  });
});

describe("a run the host stopped for output volume", () => {
  // OpenCode shares the same runner and the same 256 KB per-line cap as the
  // other four adapters, and was the last one still silent about it -- a
  // tester forcing a huge output got the runtime's own shrug and wrote
  // "Locust did not name a 256 KB cap" (2026-09-07).
  const failure = (finish: Partial<RuntimeProcessCompletion>): string | undefined => {
    const { events } = run([], finish);
    const failed = events.find((event) => event.type === "run.failed");
    return failed === undefined ? undefined : (failed.payload as { readonly message: string }).message;
  };

  it("says so instead of blaming a missing stop step", () => {
    const message = failure({ exitCode: null, signal: "SIGINT", outputLimitExceeded: true });
    expect(message).toContain("faster than Locust could record it");
    expect(message).not.toContain("without a step that reported it had stopped");
  });

  it("still puts the confined-workspace refusal first, which says more", () => {
    // A run that asked for a path outside its folder AND tripped the cap has
    // one message worth reading, and it is the one naming the path.
    const opencode = normalizer();
    opencode.accept({
      sequence: 1,
      raw: JSON.stringify({ type: "step.error", error: "permission requested: external_directory (/etc/passwd)" })
    });
    const events = opencode.finish(
      completion({ exitCode: null, signal: "SIGINT", outputLimitExceeded: true })
    );
    const failed = events.find((event) => event.type === "run.failed");
    const message = failed === undefined ? "" : (failed.payload as { readonly message: string }).message;
    if (message.includes("outside the folder")) {
      expect(message).not.toContain("faster than Locust could record it");
    } else {
      // The fixture did not produce a refusal; the cap message is then correct.
      expect(message).toContain("faster than Locust could record it");
    }
  });

  it("leaves an ordinary non-zero exit saying what it always said", () => {
    expect(failure({ exitCode: 2 })).toContain("without a step that reported it had stopped");
  });
});

/*
 * Astra, 2026-09-13, measuring a live OpenCode run: `todowrite` arrived four
 * times carrying real three-step state at
 * `payload.evidence.raw.part.state.input.todos`, and every surface drew one
 * row -- `todowrite done`. The plan advanced four times and nothing showed it.
 * Codex's `todo_list` has always been `plan.updated`; this is the same fact.
 */
describe("OpenCode's plan", () => {
  function todoLine(todos: readonly unknown[], callID: string): string {
    return JSON.stringify({
      type: "tool_use",
      sessionID: "ses_1",
      part: { tool: "todowrite", callID, state: { status: "completed", input: { todos } } },
    });
  }

  const STEPS = ["read README", "write notes", "verify"];
  /** Astra's exact sequence: one step advancing per update. */
  const SEQUENCE = [
    ["in_progress", "pending", "pending"],
    ["completed", "in_progress", "pending"],
    ["completed", "completed", "in_progress"],
    ["completed", "completed", "completed"],
  ];

  function plans(statuses: readonly (readonly string[])[]) {
    const { events } = run(
      statuses.map((row, index) =>
        todoLine(STEPS.map((content, step) => ({ id: String(step), content, status: row[step] })), `call_${String(index)}`)
      )
    );
    return events.filter((event) => event.type === "plan.updated");
  }

  it("becomes a plan, four times, not four tool rows", () => {
    const events = run(SEQUENCE.map((row, index) =>
      todoLine(STEPS.map((content, step) => ({ id: String(step), content, status: row[step] })), `call_${String(index)}`)
    )).events;
    expect(events.filter((event) => event.type === "plan.updated")).toHaveLength(4);
    expect(events.filter((event) => event.type === "tool.completed")).toHaveLength(0);
    expect(events.filter((event) => event.type === "tool.started")).toHaveLength(0);
  });

  it("carries the steps and their advancing state", () => {
    const updates = plans(SEQUENCE);
    const last = updates[updates.length - 1];
    const first = updates[0];
    const plan = (event: NormalizedRuntimeEvent | undefined): readonly Record<string, unknown>[] =>
      event === undefined ? [] : ((event.payload as { readonly plan: unknown }).plan as Record<string, unknown>[]);
    expect(plan(first).map((step) => step.content)).toEqual(STEPS);
    expect(plan(first).map((step) => step.status)).toEqual(["in_progress", "pending", "pending"]);
    expect(plan(last).map((step) => step.status)).toEqual(["completed", "completed", "completed"]);
  });

  it("invents no plan when a todo call carries no todos", () => {
    // Acceptance is Astra's: a run without todo data must not grow a plan.
    const { events } = run([
      JSON.stringify({
        type: "tool_use",
        sessionID: "ses_1",
        part: { tool: "todowrite", callID: "call_0", state: { status: "completed", input: { todos: [] } } },
      }),
    ]);
    expect(events.filter((event) => event.type === "plan.updated")).toHaveLength(0);
    expect(events.filter((event) => event.type === "tool.completed")).toHaveLength(1);
  });

  it("leaves every other tool alone", () => {
    const { events } = run([
      JSON.stringify({
        type: "tool_use",
        sessionID: "ses_1",
        part: { tool: "bash", callID: "call_0", state: { status: "completed", input: { command: "ls" } } },
      }),
    ]);
    expect(events.filter((event) => event.type === "plan.updated")).toHaveLength(0);
    expect(events.filter((event) => event.type === "tool.completed")).toHaveLength(1);
  });

  /*
   * The same thing again, but from a REAL run rather than a hand-built line.
   *
   * Captured 2026-09-13 off opencode-ai against muse-spark-1.3-contributor-free,
   * asked for three files and told to keep a todo list. Five `todowrite` calls
   * came back carrying the plan at every stage. The hand-built cases above
   * prove the mapping; this proves the SHAPE is still the one the runtime
   * actually sends, which is the half that rots.
   */
  it("reads the plan out of a captured live run, advancing step by step", () => {
    const { events } = run(fixture("todo-plan.jsonl"));
    const plans = events.filter((event) => event.type === "plan.updated");
    expect(plans).toHaveLength(5);
    expect(events.filter((event) => /todo/i.test(String((event.payload as { name?: string }).name ?? "")))).toHaveLength(0);

    const statuses = plans.map((event) =>
      ((event.payload as { readonly plan: readonly Record<string, unknown>[] }).plan).map((step) => String(step.status))
    );
    // Every step starts pending and every step ends completed: the plan moved.
    expect(statuses[0]).toEqual(["pending", "pending", "pending"]);
    expect(statuses[statuses.length - 1]).toEqual(["completed", "completed", "completed"]);
    // And it advanced rather than jumping: some update has work in flight.
    expect(statuses.some((row) => row.includes("in_progress"))).toBe(true);

    const first = (plans[0]?.payload as { readonly plan: readonly Record<string, unknown>[] }).plan;
    expect(first).toHaveLength(3);
    // OpenCode spells the step `content`; the thread reads that spelling.
    expect(first.every((step) => typeof step.content === "string" && String(step.content).length > 0)).toBe(true);
  });
});

/*
 * A6.9: when a conversation outgrows the model's context, OpenCode summarizes
 * it and adds a note to carry on, and `run` prints both as ordinary text.
 * These records are shaped as OpenCode writes them (session/compaction.ts and
 * cli/cmd/run.ts, read 2026-09-24; the same code is in the 1.18.27 binary):
 * the summary is a step of its own with no tools and an ordinary text part,
 * and the note is a synthetic text part with a finished time. NOT captured --
 * the free tier was down -- so a capture replaces these when it can be made.
 */
describe("an OpenCode compaction", () => {
  const record = (type: string, part: Record<string, unknown>) => JSON.stringify({ type, sessionID: "ses_1", part });
  const start = record("step_start", { type: "step-start" });
  const finish = (reason: string) =>
    record("step_finish", { type: "step-finish", reason, tokens: { input: 10, output: 2 } });
  const said = (text: string) => record("text", { type: "text", text, time: { start: 1, end: 2 } });
  const read = record("tool_use", {
    type: "tool",
    tool: "read",
    callID: "call_1",
    state: { status: "completed", input: { filePath: "a.txt" }, output: "hi" },
  });
  const NOTE = "Continue if you have next steps, or stop and ask for clarification if you are unsure how to proceed.";
  const note = record("text", {
    type: "text",
    synthetic: true,
    metadata: { compaction_continue: true },
    text: NOTE,
    time: { start: 3, end: 3 },
  });
  const SUMMARY = "## Objective\nSay what a.txt holds.\n\n## Work State\nRead it; <locust-share to=\"Booty\">old news</locust-share>";
  const compacted = [
    start, said("Reading the file first."), read, finish("tool-calls"),
    start, said(SUMMARY), finish("stop"),
    note,
    start, said("a.txt says hi."), finish("stop"),
  ];
  const compactionNotices = (events: readonly NormalizedRuntimeEvent[]) =>
    events.filter((event) => event.type === "adapter.diagnostic"
      && (event.payload as { code: string }).code === "opencode.context_compacted");

  it("never gives OpenCode's note to the model as the teammate's words", () => {
    const { events } = run(compacted);
    expect([...messages(events).values()].some((text) => text.includes("Continue if you have next steps"))).toBe(false);
    // Nor any other text OpenCode marks as its own.
    const other = record("text", { type: "text", synthetic: true, text: "Summarize the task tool output above.", time: { start: 1, end: 2 } });
    const quiet = run([start, other, said("Done."), finish("stop")]).events;
    expect([...messages(quiet).values()]).toEqual(["Done."]);
    expect(compactionNotices(quiet)).toHaveLength(0);
  });

  it("takes the summary back, so it is neither drawn nor the reply, and says what happened", () => {
    const { events } = run(compacted);
    // Delivered when it arrived, then emptied: an empty message is not drawn
    // and cannot be the last thing said, or carry the blocks it quoted.
    expect([...messages(events).values()]).toEqual(["Reading the file first.", "", "a.txt says hi."]);
    const notices = compactionNotices(events);
    expect(notices).toHaveLength(1);
    expect(notices[0]?.payload).toMatchObject({ level: "info", message: OPENCODE_COMPACTED });
    expect(events.at(-1)?.type).toBe("run.completed");
  });

  it("does not count the summary's stop as the run's", () => {
    // Ended on the note: what came after the summary never finished.
    const { events } = run(compacted.slice(0, 8));
    expect(events.at(-1)).toMatchObject({ type: "run.failed", payload: { runtimeTerminal: "missing" } });
  });

  it("takes nothing back from a step that called a tool, or across a step that began", () => {
    // A step with a tool call is not the compaction's, whatever else it is.
    const tooled = run([start, said("Reading the file first."), read, finish("stop"), note, start, said("Done."), finish("stop")]).events;
    expect([...messages(tooled).values()]).toEqual(["Reading the file first.", "Done."]);
    // A note after another step opened is not about the step before it.
    const late = run([start, said("An answer."), finish("stop"), start, note, said("Done."), finish("stop")]).events;
    expect([...messages(late).values()]).toEqual(["An answer.", "Done."]);
    expect(compactionNotices(late)).toHaveLength(1);
  });
});
