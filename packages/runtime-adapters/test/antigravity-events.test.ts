import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  antigravityToolArg,
  antigravityToolCommand,
  antigravityWritePatch,
  createAntigravityEventNormalizer,
} from "../src/antigravity-events.js";
import {
  normalizeAntigravityWorkspace,
  parseAntigravityProjects,
  projectIdForWorkspace,
} from "../src/antigravity-projects.js";
import type { NormalizedRuntimeEvent } from "../src/codex-events.js";
import type { RuntimeProcessCompletion } from "../src/process-runner.js";

const NOW = "2026-09-03T09:00:00.000Z";
const CONVERSATION = "03a2fcb4-8fd9-468e-a683-6bf3a5acd077";

function normalizer() {
  return createAntigravityEventNormalizer({
    runId: "run_1",
    missionId: "mission_1",
    conversationId: CONVERSATION,
    now: () => new Date(NOW),
  });
}

/**
 * The host tails a file rather than owning a process, so it synthesizes this.
 * `exitCode: null` is what a pure file-poll reports.
 */
function completion(overrides: Partial<RuntimeProcessCompletion> = {}): RuntimeProcessCompletion {
  return {
    exitCode: null,
    signal: null,
    stderr: "",
    stderrTruncated: false,
    recordCount: 7,
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

/** A transcript captured off the real IDE, line by line, in file order. */
function fixture(name: string): readonly string[] {
  return readFileSync(new URL(`./fixtures/antigravity/${name}`, import.meta.url), "utf8")
    .split("\n")
    .filter((line) => line.length > 0);
}

function feed(
  antigravity: ReturnType<typeof normalizer>,
  lines: readonly string[],
  from = 0,
): NormalizedRuntimeEvent[] {
  const events: NormalizedRuntimeEvent[] = [];
  lines.forEach((raw, index) => events.push(...antigravity.accept({ sequence: from + index + 1, raw })));
  return events;
}

function run(lines: readonly string[], finish: Partial<RuntimeProcessCompletion> = {}) {
  const antigravity = normalizer();
  const events = feed(antigravity, lines);
  events.push(...antigravity.finish(completion(finish)));
  return { antigravity, events };
}

function payload<T>(event: NormalizedRuntimeEvent | undefined): T {
  return (event?.payload ?? {}) as T;
}

describe("an Antigravity conversation that only answered, as captured", () => {
  const lines = fixture("transcript-plain-reply.jsonl");
  const { antigravity, events } = run(lines);

  it("says nothing about the prompt it was handed or the checkpoint it was handed back", () => {
    // Three lines in; only the model's answer and the run's end come out.
    expect(events.map((event) => event.type)).toEqual(["message.delta", "run.completed"]);
  });

  it("never lets Antigravity's checkpoint summary into the ledger", () => {
    // The checkpoint is Antigravity's own context summary: on a long
    // conversation it holds the conversation. None of it is evidence.
    const ledger = JSON.stringify(events);
    expect(ledger).not.toContain("CHECKPOINT 0");
    expect(ledger).not.toContain("Conversation Logs");
    expect(ledger).not.toContain("Single Word Response Test");
    expect(ledger).not.toContain("transcript.jsonl");
  });

  it("delivers the planner's answer whole, as its own final message", () => {
    const delta = payload<{ itemId: string; operation: string; text: string; final: boolean }>(events[0]);
    expect(delta).toMatchObject({ itemId: "msg_2", operation: "replace", text: "OK", final: true });
  });

  it("reports a final planner answer with no tool calls as the turn being over", () => {
    // The transcript has no terminal record of any kind. This is the signal.
    expect(antigravity.latestFinal).toBe(true);
  });

  it("carries the conversation id the host passed in, which the transcript never prints", () => {
    expect(antigravity.runtimeThreadId).toBe(CONVERSATION);
    expect(events.every((event) => event.runtimeThreadId === CONVERSATION)).toBe(true);
    expect(events.every((event) => event.sourceAdapter === "antigravity")).toBe(true);
  });
});

describe("an Antigravity conversation that wrote a file and was then continued, as captured", () => {
  const lines = fixture("transcript-write-then-followup.jsonl");
  const { antigravity, events } = run(lines);

  it("turns seven transcript lines into the four things that actually happened", () => {
    expect(events.map((event) => event.type)).toEqual([
      "step.started",
      "step.completed",
      "tool.started",
      "tool.completed",
      "message.delta",
      "message.delta",
      "run.completed",
    ]);
  });

  it("opens and closes the reasoning step in one go, so nothing is left unfinished", () => {
    // There is no line saying the model stopped thinking.
    expect(payload<{ stepKind: string }>(events[0]).stepKind).toBe("reasoning");
    expect(payload<{ stepKind: string }>(events[1]).stepKind).toBe("reasoning");
  });

  it("never stores the model's reasoning, and does not even record that a thinking field was there", () => {
    const raw = payload<{ evidence: { raw: Record<string, unknown>; redacted: boolean } }>(events[0]).evidence;
    expect("thinking" in raw.raw).toBe(false);
    expect(raw.redacted).toBe(true);
    const ledger = JSON.stringify(events);
    expect(ledger).not.toContain("File Creation Verification");
    expect(ledger).not.toContain("easily verifiable operation");
  });

  it("names the write call from its position in the file, because the call carries no id", () => {
    const started = payload<{ itemId: string; name: string; toolKind: string; command: string }>(events[2]);
    expect(started).toMatchObject({
      itemId: "tool_2_0",
      name: "write_to_file",
      toolKind: "write_to_file",
      command: "c:/work/pebble/hello.txt",
    });
  });

  it("records an overwrite as a path and no diff, because there is no before-text to diff against", () => {
    // The captured call set `Overwrite: "true"`. Building an added-file diff
    // from `CodeContent` would claim every line was new.
    expect(payload<{ patch?: unknown }>(events[2]).patch).toBeUndefined();
  });

  it("attaches the tool's result to the call it came from, which the result line does not name", () => {
    const completed = payload<{ itemId: string; output: string }>(events[3]);
    expect(completed.itemId).toBe("tool_2_0");
    expect(completed.output).toContain("Created file file:///c:/work/pebble/hello.txt");
  });

  it("recognises the follow-up `send-message` line and says nothing about it", () => {
    // Measured: a `send-message` arrives as source SYSTEM, type SYSTEM_MESSAGE
    // -- not as a USER_INPUT line. It is the host's own send coming back.
    expect(events.some((event) => event.type === "adapter.diagnostic")).toBe(false);
    expect(JSON.stringify(events)).not.toContain("MESSAGE_PRIORITY_HIGH");
    const deltas = events.filter((event) => event.type === "message.delta");
    expect(deltas.map((event) => payload<{ itemId: string; text: string }>(event))).toEqual([
      { itemId: "msg_4", operation: "replace", text: "DONE", final: true, evidence: expect.anything() },
      { itemId: "msg_6", operation: "replace", text: "DONE", final: true, evidence: expect.anything() },
    ]);
  });

  it("reports the run complete when the last line was a planner answer with no tool calls", () => {
    expect(antigravity.latestFinal).toBe(true);
    expect(events.at(-1)?.type).toBe("run.completed");
    expect(payload<{ runtimeThreadId: string }>(events.at(-1)).runtimeThreadId).toBe(CONVERSATION);
  });
});

describe("re-reading a transcript the host has already read", () => {
  const lines = fixture("transcript-write-then-followup.jsonl");

  it("emits each step exactly once, however many times the file is polled", () => {
    // The host re-reads from the top on every poll. Without this the whole
    // conversation would land in the ledger again on each pass.
    const antigravity = normalizer();
    const first = feed(antigravity, lines);
    const second = feed(antigravity, lines, lines.length);
    const third = feed(antigravity, lines, lines.length * 2);
    expect(first.length).toBe(6);
    expect(second).toEqual([]);
    expect(third).toEqual([]);
    expect(antigravity.latestFinal).toBe(true);
  });
});

describe("a planner answer that carries the model's reasoning beside it", () => {
  // Colin's own stuck run, 2026-09-06: Antigravity on `flash` ended the turn
  // with one line carrying BOTH `thinking` and `content` and no tool calls.
  // The completion heuristic required no reasoning, so nothing ever looked
  // final, the host kept polling, and the composer kept its stop button until
  // the idle timeout. Neither captured conversation has a line of this shape.
  const answerWithReasoning = JSON.stringify({
    step_index: 7,
    source: "MODEL",
    type: "PLANNER_RESPONSE",
    status: "DONE",
    created_at: "2026-09-06T03:02:28Z",
    thinking: "**Defining the answer**",
    content: "Locust is a desktop app.",
  });

  it("is the end of the turn, and the reasoning is still its own step", () => {
    const antigravity = normalizer();
    const events = antigravity.accept({ sequence: 1, raw: answerWithReasoning });
    expect(events.map((event) => event.type)).toEqual([
      "step.started",
      "step.completed",
      "message.delta",
    ]);
    expect(payload<{ text: string }>(events[2]).text).toBe("Locust is a desktop app.");
    expect(antigravity.latestFinal).toBe(true);
  });

  it("does not end the turn on reasoning with no answer", () => {
    const antigravity = normalizer();
    const events = antigravity.accept({
      sequence: 1,
      raw: JSON.stringify({
        step_index: 7,
        source: "MODEL",
        type: "PLANNER_RESPONSE",
        status: "DONE",
        created_at: "2026-09-06T03:02:28Z",
        thinking: "**Still working**",
      }),
    });
    expect(events.map((event) => event.type)).toEqual(["step.started", "step.completed"]);
    expect(antigravity.latestFinal).toBe(false);
  });
});

describe("a step the transcript has not finished writing", () => {
  // Not in either capture: every line captured was already DONE. Built by
  // hand, in the shape the captures establish.
  const running = JSON.stringify({
    step_index: 2,
    source: "MODEL",
    type: "PLANNER_RESPONSE",
    status: "RUNNING",
    created_at: "2026-09-03T08:39:47Z",
    content: "partial",
  });
  const settled = JSON.stringify({
    step_index: 2,
    source: "MODEL",
    type: "PLANNER_RESPONSE",
    status: "DONE",
    created_at: "2026-09-03T08:39:50Z",
    content: "DONE",
  });

  it("holds it: nothing is emitted, and nothing claims the turn is over", () => {
    const antigravity = normalizer();
    expect(antigravity.accept({ sequence: 1, raw: running })).toEqual([]);
    expect(antigravity.latestFinal).toBe(false);
  });

  it("normalizes it once it settles, rather than treating it as already seen", () => {
    const antigravity = normalizer();
    antigravity.accept({ sequence: 1, raw: running });
    const events = antigravity.accept({ sequence: 2, raw: settled });
    expect(events.map((event) => event.type)).toEqual(["message.delta"]);
    expect(payload<{ text: string }>(events[0]).text).toBe("DONE");
    expect(antigravity.latestFinal).toBe(true);
  });
});

describe("a write of a file that is not being overwritten", () => {
  // Not captured: the one write measured set `Overwrite`. This is the shape
  // the captured call establishes, with that flag left off.
  const created = JSON.stringify({
    step_index: 2,
    source: "MODEL",
    type: "PLANNER_RESPONSE",
    status: "DONE",
    created_at: "2026-09-03T08:39:47Z",
    thinking: "SECRET REASONING",
    tool_calls: [
      {
        name: "write_to_file",
        args: {
          CodeContent: JSON.stringify("alpha\nbeta\n"),
          TargetFile: JSON.stringify("c:/work/pebble/notes.txt"),
          Description: JSON.stringify("Create notes.txt"),
        },
      },
    ],
  });

  it("reconstructs the added file from the content the call carried", () => {
    const antigravity = normalizer();
    const events = antigravity.accept({ sequence: 1, raw: created });
    const patch = payload<{ patch: { text: string; added: number; removed: number } }>(events[2]).patch;
    expect(patch.text).toBe("--- /dev/null\n+++ b/c:/work/pebble/notes.txt\n@@ -0,0 +1,2 @@\n+alpha\n+beta\n");
    expect(patch).toMatchObject({ added: 2, removed: 0 });
  });

  it("still keeps the reasoning out of the patch's own event", () => {
    const antigravity = normalizer();
    const events = antigravity.accept({ sequence: 1, raw: created });
    expect(JSON.stringify(events)).not.toContain("SECRET REASONING");
  });
});

describe("a tool result with nothing open to attach it to", () => {
  const orphan = JSON.stringify({
    step_index: 0,
    source: "MODEL",
    type: "GENERIC",
    status: "DONE",
    created_at: "2026-09-03T08:39:50Z",
    content: "Created file file:///c:/work/pebble/hello.txt with requested content.",
  });

  it("says so, rather than inventing a tool call to hang it on", () => {
    const antigravity = normalizer();
    const events = antigravity.accept({ sequence: 1, raw: orphan });
    expect(events.map((event) => event.type)).toEqual(["adapter.diagnostic"]);
    expect(payload<{ code: string; level: string }>(events[0])).toMatchObject({
      code: "antigravity.unattached_result",
      level: "info",
    });
  });
});

describe("how an Antigravity run ends", () => {
  const lines = fixture("transcript-write-then-followup.jsonl");

  it("fails with a reason a person can act on when no final answer ever arrived", () => {
    // The host gave up while a tool call was still the last thing in the file.
    const { events } = run(lines.slice(0, 4));
    const failure = events.at(-1);
    expect(failure?.type).toBe("run.failed");
    expect(payload<{ message: string; runtimeTerminal: string }>(failure)).toMatchObject({
      runtimeTerminal: "missing",
    });
    expect(payload<{ message: string }>(failure).message).toContain("stopped waiting");
  });

  it("reports a cancelled run as cancelled, not as a run that failed to answer", () => {
    const { events } = run(lines.slice(0, 4), { cancelled: true });
    expect(events.at(-1)?.type).toBe("run.cancelled");
  });

  it("lets a non-zero exit from the host's own driver outrank a finished transcript", () => {
    const { events } = run(lines, { exitCode: 1 });
    const failure = events.at(-1);
    expect(failure?.type).toBe("run.failed");
    expect(payload<{ runtimeTerminal: string }>(failure).runtimeTerminal).toBe("completed");
  });

  it("ends once: a second finish, and anything accepted after it, produce nothing", () => {
    const antigravity = normalizer();
    feed(antigravity, lines);
    expect(antigravity.finish(completion()).length).toBe(1);
    expect(antigravity.finalized).toBe(true);
    expect(antigravity.finish(completion())).toEqual([]);
    expect(antigravity.accept({ sequence: 99, raw: lines[0]! })).toEqual([]);
  });
});

describe("a transcript line this build cannot read", () => {
  it("keeps the line as a diagnostic rather than dropping it", () => {
    const antigravity = normalizer();
    const events = antigravity.accept({ sequence: 1, raw: "{not json" });
    expect(events.map((event) => event.type)).toEqual(["adapter.diagnostic"]);
    expect(payload<{ code: string }>(events[0]).code).toBe("antigravity.malformed_record");
  });

  it("treats a line with no step_index as malformed, since there is nothing to deduplicate on", () => {
    const antigravity = normalizer();
    const events = antigravity.accept({
      sequence: 1,
      raw: JSON.stringify({ source: "MODEL", type: "PLANNER_RESPONSE", status: "DONE", content: "OK" }),
    });
    expect(payload<{ code: string }>(events[0]).code).toBe("antigravity.malformed_record");
  });

  it("preserves a step type this build has never seen", () => {
    const antigravity = normalizer();
    const events = antigravity.accept({
      sequence: 1,
      raw: JSON.stringify({ step_index: 9, source: "MODEL", type: "BRAINSTORM", status: "DONE" }),
    });
    expect(payload<{ code: string }>(events[0]).code).toBe("antigravity.unknown_step");
  });
});

describe("reading a tool call's arguments", () => {
  const args = {
    CodeContent: "\"hello from antigravity\\n\"",
    Overwrite: "true",
    TargetFile: "\"c:/work/pebble/hello.txt\"",
    toolSummary: "\"Create hello.txt\"",
  };

  it("decodes them, because every value is a JSON-encoded string and not the value", () => {
    // A caller comparing `args.Overwrite` to `true` would never match, and one
    // using `args.TargetFile` as a path would carry the quotes into the ledger.
    expect(antigravityToolArg(args, "Overwrite")).toBe(true);
    expect(antigravityToolArg(args, "TargetFile")).toBe("c:/work/pebble/hello.txt");
    expect(antigravityToolArg(args, "CodeContent")).toBe("hello from antigravity\n");
    expect(antigravityToolArg(args, "Missing")).toBeUndefined();
  });

  it("returns a value that is not JSON as it arrived, rather than discarding it", () => {
    expect(antigravityToolArg({ TargetFile: "c:/plain/path.txt" }, "TargetFile")).toBe("c:/plain/path.txt");
  });

  it("summarizes a call on one line, falling back to the model's own phrasing", () => {
    expect(antigravityToolCommand(args)).toBe("c:/work/pebble/hello.txt");
    expect(antigravityToolCommand({ toolSummary: "\"Create\\nhello.txt\"" })).toBe("Create hello.txt");
    expect(antigravityToolCommand({})).toBeUndefined();
  });

  it("builds no patch for an overwrite, whatever content the call carried", () => {
    expect(antigravityWritePatch(args)).toBeUndefined();
  });
});

describe("the project id `new-conversation` refuses to start without", () => {
  const bytes = new Uint8Array(
    readFileSync(new URL("./fixtures/antigravity/summaries.pb", import.meta.url)),
  );
  const projects = parseAntigravityProjects(bytes);

  it("finds the workspace the IDE had open and the project it belongs to", () => {
    // This binary is kept unscrubbed: its paths are length-prefixed inside a
    // schema-less protobuf, so replacing them would break the length prefixes.
    expect([...projects]).toEqual([
      ["c:/Users/<home>/Documents/antigravtest", "daf0f8ec-bb8e-49e8-a445-954eb0a62d0f"],
    ]);
  });

  it("collapses both encodings of the same workspace onto one key", () => {
    // The file holds the same folder as `file:///c:/Users/…` and as
    // `file:///c%3A%5CUsers%5C…`; 17 records, one entry.
    expect(projects.size).toBe(1);
  });

  it("answers for a path in the form a host would actually hold it", () => {
    expect(projectIdForWorkspace(projects, "C:\\Users\\<home>\\Documents\\antigravtest\\"))
      .toBe("daf0f8ec-bb8e-49e8-a445-954eb0a62d0f");
    expect(projectIdForWorkspace(projects, "c:/Users/<home>/Documents/antigravtest"))
      .toBe("daf0f8ec-bb8e-49e8-a445-954eb0a62d0f");
  });

  it("has no answer for a workspace the file never mentioned", () => {
    expect(projectIdForWorkspace(projects, "c:/work/pebble")).toBeUndefined();
  });

  it("returns nothing for bytes that are not this file, rather than a guess", () => {
    expect(parseAntigravityProjects(new Uint8Array([0, 1, 2, 3]))).toEqual(new Map());
  });

  it("normalizes a workspace to forward slashes, a lower-case drive and no trailing slash", () => {
    expect(normalizeAntigravityWorkspace("file:///C%3A%5Cwork%5Cpebble%5C")).toBe("c:/work/pebble");
    expect(normalizeAntigravityWorkspace("D:\\work\\pebble")).toBe("d:/work/pebble");
  });
});

describe("the row an ask_question draws", () => {
  /*
   * The record Colin screenshotted, as Antigravity wrote it. He saw
   * "Prompting user with options · ask_question · still running" while the run
   * hung for the full idle timeout -- and the question and its four options
   * were sitting in this very record, unread.
   */
  const askRecord = JSON.stringify({
    step_index: 4,
    source: "MODEL",
    type: "PLANNER_RESPONSE",
    status: "DONE",
    created_at: "2026-09-07T19:36:08Z",
    tool_calls: [
      {
        name: "ask_question",
        args: {
          questions:
            '[{"is_multi_select":false,"options":["(Recommended) Run performance benchmark tests","Inspect codebase architecture","Execute automated unit tests","Review system environment settings"],"question":"Which test option would you like to select?"}]',
          toolAction: '"Prompting user with options"',
          toolSummary: '"Interactive option selection"',
        },
      },
    ],
  });

  it("says what is being asked, and every option", () => {
    const antigravity = normalizer();
    const started = antigravity
      .accept({ sequence: 1, raw: askRecord })
      .find((event) => event.type === "tool.started");
    const command = String((started?.payload as { command?: string } | undefined)?.command ?? "");
    expect(command).toContain("Which test option would you like to select?");
    expect(command).toContain("Run performance benchmark tests");
    expect(command).toContain("Review system environment settings");
  })

  it("carries the question, structured, for the card that answers it", () => {
    // Yurt's beta run, 2026-09-23, hung on a question that showed only as a
    // row inside the folded tool calls. The desktop raises a question card
    // from this and answers it through Antigravity's own server, looking the
    // waiting step up from the step that asked.
    const antigravity = normalizer();
    const started = antigravity
      .accept({ sequence: 1, raw: askRecord })
      .find((event) => event.type === "tool.started");
    expect((started?.payload as { question?: unknown } | undefined)?.question).toEqual({
      question: "Which test option would you like to select?",
      options: [
        "(Recommended) Run performance benchmark tests",
        "Inspect codebase architecture",
        "Execute automated unit tests",
        "Review system environment settings",
      ],
      multiSelect: false,
      askedAtStep: 4,
    });
    // The row is the record of what was asked; it no longer sends the
    // person somewhere else to answer.
    expect(String((started?.payload as { command?: string } | undefined)?.command)).not.toContain(
      "answer in Antigravity",
    );
  })

  it("leaves every other tool's row exactly as it was", () => {
    // The control: this changes ask_question and nothing else.
    const write = JSON.stringify({
      step_index: 1,
      source: "MODEL",
      type: "PLANNER_RESPONSE",
      status: "DONE",
      created_at: "2026-09-07T19:36:08Z",
      tool_calls: [{ name: "write_to_file", args: { TargetFile: '"c:/x/notes.md"' } }],
    });
    const antigravity = normalizer();
    const started = antigravity
      .accept({ sequence: 1, raw: write })
      .find((event) => event.type === "tool.started");
    const command = String((started?.payload as { command?: string } | undefined)?.command ?? "");
    expect((started?.payload as { question?: unknown } | undefined)?.question).toBeUndefined();
    expect(command).toContain("notes.md");
  })
})
