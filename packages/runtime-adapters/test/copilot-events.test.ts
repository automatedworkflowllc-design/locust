import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  copilotFailureFrom,
  copilotToolCommand,
  copilotUsage,
  createCopilotEventNormalizer,
  scrubCopilotRecord,
  summarizeCopilotAutoMode,
} from "../src/copilot-events.js";
import type { NormalizedRuntimeEvent } from "../src/codex-events.js";
import type { RuntimeProcessCompletion } from "../src/process-runner.js";

const NOW = "2026-09-03T07:00:00.000Z";
/** The uuid the host mints and passes as `--session-id` on a first run. */
const HOST_SESSION = "11111111-2222-3333-4444-555555555555";

function normalizer(sessionId: string | undefined = HOST_SESSION) {
  return createCopilotEventNormalizer({
    runId: "run_1",
    missionId: "mission_1",
    cliVersion: "1.0.82",
    ...(sessionId === undefined ? {} : { sessionId }),
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
  return readFileSync(new URL(`./fixtures/copilot/${name}`, import.meta.url), "utf8")
    .split("\n")
    .filter((line) => line.length > 0);
}

function text(name: string): string {
  return readFileSync(new URL(`./fixtures/copilot/${name}`, import.meta.url), "utf8");
}

function run(
  lines: readonly string[],
  finish: Partial<RuntimeProcessCompletion> = {},
  sessionId: string | undefined = HOST_SESSION,
) {
  const copilot = normalizer(sessionId);
  const events: NormalizedRuntimeEvent[] = [];
  lines.forEach((raw, index) => events.push(...copilot.accept({ sequence: index + 1, raw })));
  events.push(...copilot.finish(completion(finish)));
  return { copilot, events };
}

/** Rebuild message text the way the checkpoint summary does. */
function messages(events: readonly NormalizedRuntimeEvent[]): ReadonlyMap<string, string> {
  const buffers = new Map<string, string>();
  for (const event of events) {
    if (event.type !== "message.delta") continue;
    const { itemId, operation, text: piece } = event.payload as { itemId: string; operation: string; text: string };
    buffers.set(itemId, operation === "replace" ? piece : `${buffers.get(itemId) ?? ""}${piece}`);
  }
  return buffers;
}

describe("a plain Copilot reply, as captured", () => {
  const { copilot, events } = run(fixture("plain-reply.jsonl"));

  it("opens the run on the record that names the model it actually got", () => {
    const started = events[0];
    expect(started?.type).toBe("run.started");
    const evidence = (started?.payload as { evidence: { raw: Record<string, unknown>; redacted: boolean } }).evidence;
    expect(evidence.redacted).toBe(true);
    expect(evidence.raw).toEqual({
      chosenModel: "gpt-5.6-luna",
      routingMethod: "auto_v2",
      availableModels: ["gpt-5.6-luna"],
      fallback: false,
    });
  });

  it("prefers the session id the CLI printed over the one the host passed in", () => {
    // The brief for this work assumed the stream carried no session id. It
    // does -- in the terminal `result` record -- so the host's uuid is the
    // stand-in until that arrives rather than the last word.
    expect(copilot.runtimeThreadId).toBe("5f4fae14-95d8-43b5-8e17-d4108d6cbb17");
    expect(events[0]?.runtimeThreadId).toBe(HOST_SESSION);
    expect(events.at(-1)).toMatchObject({
      type: "run.completed",
      payload: { runtimeThreadId: "5f4fae14-95d8-43b5-8e17-d4108d6cbb17" },
    });
  });

  it("opens and closes the turn, and lets the complete message replace its fragments", () => {
    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "step.started",
      "message.delta",
      "message.delta",
      "step.completed",
      "run.completed",
    ]);
    expect([...messages(events).values()]).toEqual(["OK"]);
  });

  it("records what the run cost from the checkpoint, and nothing else in that record", () => {
    expect((events.at(-1)?.payload as { usage?: Record<string, number> }).usage)
      .toEqual({ premiumRequests: 1, nanoAiu: 383_710_000 });
  });

  it("never lets the CLI's system prompt into the ledger", () => {
    // `model.messages_snapshot` carries the whole system prompt. It is
    // dropped before anything turns a record into evidence.
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain("You are the GitHub Copilot CLI");
    expect(serialized).not.toContain("messages_snapshot");
  });

  it("never carries the model's opaque reasoning or the account's request handles", () => {
    // The fixture wrote its own marker into every blob it elided, so a
    // surviving marker is proof the adapter passed the value through. The
    // keys stay -- what they held does not.
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain("[opaque ");
    expect(serialized).toContain('"apiCallId":"[redacted]"');
  });
});

describe("a Copilot run that wrote a file, as captured", () => {
  const { events } = run(fixture("write-apply-patch.jsonl"));

  it("reports apply_patch as one tool that started and completed, with the patch it applied", () => {
    const tools = events.filter((event) => event.type.startsWith("tool."));
    expect(tools.map((event) => event.type)).toEqual(["tool.started", "tool.completed"]);
    expect((tools[0]?.payload as { toolKind: string }).toolKind).toBe("apply_patch");
    // The arguments of a custom tool arrive as one string -- the patch the
    // model asked for -- rather than as an object with a `command`.
    expect((tools[0]?.payload as { command: string }).command).toContain("*** Add File: notes.txt");
    const patch = (tools[1]?.payload as { patch?: { text: string; added: number; removed: number } }).patch;
    expect(patch?.text).toContain("diff --git a/C:/work/pebble/cp-write/notes.txt");
    expect(patch?.text).toContain("+hello from copilot.");
    expect(patch).toMatchObject({ added: 2, removed: 0 });
  });

  it("writes no message for the turn that only asked for a tool", () => {
    // That `assistant.message` has empty content and one toolRequest; the
    // tool records already say what happened, and an empty bubble says
    // nothing.
    expect([...messages(events).values()]).toEqual(["DONE"]);
  });

  it("keeps the two turns apart, each opened and closed", () => {
    const steps = events.filter((event) => event.type === "step.started" || event.type === "step.completed");
    expect(steps.map((event) => (event.payload as { itemId?: string }).itemId)).toEqual(["0", "0", "1", "1"]);
  });

  it("never lets the operator's own local skills into the ledger", () => {
    // `session.skills_loaded` lists every skill on the machine by name,
    // description and path. None of that is the mission's.
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain("skills_loaded");
    expect(serialized).not.toContain("SKILL.md");
  });
});

describe("a read-only Copilot run whose tools were denied, as captured", () => {
  // Run with `--deny-tool=write,shell`. No file was created.
  const { events } = run(fixture("read-only-tools-denied.jsonl"));

  it("reports both refusals as tools that failed, never as tools that completed", () => {
    const tools = events.filter((event) => event.type.startsWith("tool."));
    expect(tools.map((event) => event.type)).toEqual([
      "tool.started", "tool.failed", "tool.started", "tool.failed",
    ]);
    const failed = tools.filter((event) => event.type === "tool.failed");
    expect(failed.map((event) => (event.payload as { toolKind: string }).toolKind))
      .toEqual(["apply_patch", "powershell"]);
    expect(failed.every((event) => (event.payload as { status: string }).status === "denied")).toBe(true);
  });

  it("names what each refused tool wanted to do, in the two shapes the CLI uses", () => {
    // The patch arrived as a bare string and the shell call as an object; a
    // refusal that records neither is a row with nothing in it.
    const refused = events
      .filter((event) => event.type === "tool.failed")
      .map((event) => (event.payload as { command?: string }).command);
    expect(refused[0]).toContain("*** Add File: blocked.txt");
    expect(refused[1]).toBe("Set-Content -Path '.\\blocked.txt' -Value 'hi' -NoNewline");
  });

  it("carries the run's own account of what it could not do", () => {
    expect([...messages(events).values()]).toEqual([
      "Unable to create `blocked.txt` because file-writing tools are blocked.",
    ]);
    expect(events.at(-1)?.type).toBe("run.completed");
  });
});

describe("a Copilot session set and then resumed, as captured", () => {
  const first = run(fixture("session-first-turn.jsonl"));
  const second = run(fixture("session-resumed-turn.jsonl"));

  it("reports the same thread id on both turns, which is what --resume takes back", () => {
    expect(first.copilot.runtimeThreadId).toBe("9a4575f4-30d4-4d2e-99b3-07d9da08fae5");
    expect(second.copilot.runtimeThreadId).toBe(first.copilot.runtimeThreadId);
  });

  it("shows the second turn recalling what the first was told", () => {
    expect([...messages(first.events).values()]).toEqual(["STORED"]);
    expect([...messages(second.events).values()]).toEqual(["marmalade-4471"]);
  });

  it("shows that thinking happened without writing down what was thought", () => {
    const reasoning = second.events.filter(
      (event) => (event.payload as { stepKind?: string }).stepKind === "reasoning",
    );
    expect(reasoning.map((event) => event.type)).toEqual(["step.started", "step.completed"]);
    const serialized = JSON.stringify(second.events);
    expect(serialized).not.toContain("[opaque ");
    expect(serialized).toContain('"reasoningId":"[redacted]"');
  });
});

describe("a Copilot run an organisation policy refused, as captured", () => {
  const { events } = run(fixture("policy-denied.jsonl"), {
    exitCode: 1,
    stderr: text("stderr-policy-denied.txt"),
  });

  it("fails with a reason a person can act on, not just 'the process exited 1'", () => {
    // The stream shows only session records and then stops; everything that
    // says WHY is on stderr.
    const failed = events.at(-1);
    expect(failed).toMatchObject({ type: "run.failed", payload: { kind: "authentication-failed" } });
    const message = (failed?.payload as { message: string }).message;
    expect(message).toContain("Copilot plan required");
    expect(message).toContain("https://github.com/settings/copilot");
  });

  it("says nothing about the run beyond the session warning it printed", () => {
    expect(events.map((event) => event.type)).toEqual(["adapter.diagnostic", "run.failed"]);
    expect((events[0]?.payload as { message: string }).message)
      .toContain("Third-party MCP servers are disabled");
  });
});

describe("a Copilot run given a model the account cannot use", () => {
  it("fails in the CLI's own words, which name the model it was handed", () => {
    // No JSON records at all: the CLI dies before the stream starts.
    const { events } = run([], { exitCode: 1, stderr: text("stderr-unknown-model.txt") });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "run.failed", payload: { kind: "unknown" } });
    expect((events[0]?.payload as { message: string }).message)
      .toBe('Model "definitely-not-a-model" from --model flag is not available.');
  });

  it("reads both refusals off stderr and nothing else off it", () => {
    expect(copilotFailureFrom(text("stderr-policy-denied.txt"))?.kind).toBe("authentication-failed");
    expect(copilotFailureFrom(text("stderr-unknown-model.txt"))?.kind).toBe("unknown");
    expect(copilotFailureFrom("Error: something else entirely")).toBeUndefined();
    expect(copilotFailureFrom("")).toBeUndefined();
  });
});

describe("what a completed Copilot tool call means", () => {
  const auto = JSON.stringify({
    type: "session.auto_mode_resolved",
    data: { chosenModel: "m", availableModels: ["m"] },
  });
  const start = JSON.stringify({
    type: "tool.execution_start",
    data: { toolCallId: "t1", toolName: "powershell", arguments: { command: "ls" } },
  });

  it("keeps a long failure message within what the ledger keeps (2026-10-10 sweep)", () => {
    const { events } = run([auto, start, JSON.stringify({ type: "tool.execution_complete", data: { toolCallId: "t1", success: false, error: { message: "x".repeat(600) } } })]);
    const failed = events.find((event) => event.type === "tool.failed");
    expect(String((failed?.payload as { status?: string }).status).length).toBe(512);
  });

  it("is a failure unless the CLI said success in so many words", () => {
    // Measured, `success` is always present. A field that could go missing
    // and be read as success is the failure that matters.
    for (const data of [
      { toolCallId: "t1", success: false, error: { message: "boom", code: "failed" } },
      { toolCallId: "t1" },
      { toolCallId: "t1", success: "true" },
    ]) {
      const { events } = run([auto, start, JSON.stringify({ type: "tool.execution_complete", data })]);
      expect(events.some((event) => event.type === "tool.failed")).toBe(true);
      expect(events.some((event) => event.type === "tool.completed")).toBe(false);
    }
  });

  it("records no patch for a tool whose detail was prose rather than a diff", () => {
    const { events } = run([
      auto,
      start,
      JSON.stringify({
        type: "tool.execution_complete",
        data: { toolCallId: "t1", success: true, result: { content: "ok", detailedContent: "Listed 3 files." } },
      }),
    ]);
    const completed = events.find((event) => event.type === "tool.completed");
    expect((completed?.payload as { patch?: unknown }).patch).toBeUndefined();
  });

  it("names a tool call whichever way its arguments were spelled", () => {
    expect(copilotToolCommand("*** Begin Patch\n")).toBe("*** Begin Patch\n");
    expect(copilotToolCommand({ command: "ls", description: "list" })).toBe("ls");
    expect(copilotToolCommand({ description: "list" })).toBe("list");
    expect(copilotToolCommand(undefined)).toBeUndefined();
  });
});

describe("what this adapter refuses to write down", () => {
  it("strips the opaque blobs wherever in a record they sit", () => {
    const scrubbed = scrubCopilotRecord({
      type: "assistant.message",
      data: { content: "hi", reasoningOpaque: "AAAA", nested: [{ encryptedContent: "BBBB", keep: 1 }] },
    }) as { data: { content: string; reasoningOpaque: string; nested: readonly { encryptedContent: string; keep: number }[] } };
    expect(scrubbed.data.content).toBe("hi");
    expect(scrubbed.data.reasoningOpaque).toBe("[redacted]");
    expect(scrubbed.data.nested[0]?.encryptedContent).toBe("[redacted]");
    expect(scrubbed.data.nested[0]?.keep).toBe(1);
  });

  it("keeps only the four auto-mode fields that say which model ran", () => {
    expect(summarizeCopilotAutoMode({
      chosenModel: "m", routingMethod: "auto_v2", availableModels: ["m"], fallback: false,
      categoryScores: { debugging: 0.6 }, endToEndLatencyMs: 145.9,
    })).toEqual({ chosenModel: "m", routingMethod: "auto_v2", availableModels: ["m"], fallback: false });
    expect(summarizeCopilotAutoMode("not an object")).toEqual({});
  });

  it("keeps only the two totals from a checkpoint that is mostly cache bookkeeping", () => {
    expect(copilotUsage({ totalPremiumRequests: 2, totalNanoAiu: 5, promptCacheBreakState: [{ big: "x" }] }))
      .toEqual({ premiumRequests: 2, nanoAiu: 5 });
    expect(copilotUsage({ promptCacheBreakState: [] })).toBeUndefined();
  });
});

describe("how a Copilot run ends", () => {
  const auto = JSON.stringify({
    type: "session.auto_mode_resolved",
    data: { chosenModel: "m", availableModels: ["m"] },
  });
  const result = JSON.stringify({ type: "result", sessionId: "s1", exitCode: 0, usage: {} });

  it("is a failure when the CLI exits clean without ever printing its result record", () => {
    const { events } = run([auto]);
    expect(events.at(-1)).toMatchObject({
      type: "run.failed",
      payload: { kind: "process-failed", runtimeTerminal: "missing" },
    });
  });

  it("is a failure when the result record itself reports a non-zero exit", () => {
    const { events } = run([auto, JSON.stringify({ type: "result", sessionId: "s1", exitCode: 2 })]);
    expect(events.at(-1)).toMatchObject({ type: "run.failed", payload: { runtimeTerminal: "failed" } });
  });

  it("is cancelled when the host cancelled it", () => {
    const { events } = run([auto, result], { cancelled: true });
    expect(events.at(-1)?.type).toBe("run.cancelled");
  });

  it("still resumes from the host's id when the CLI never printed one", () => {
    const { copilot } = run([auto]);
    expect(copilot.runtimeThreadId).toBe(HOST_SESSION);
  });

  it("reports a record it cannot parse as a diagnostic and keeps going", () => {
    const copilot = normalizer();
    const events = copilot.accept({ sequence: 1, raw: "{not json" });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "adapter.diagnostic", payload: { code: "copilot.malformed_record" } });
  });

  it("says so when it meets a record type this build has never seen", () => {
    const { events } = run([auto, JSON.stringify({ type: "assistant.brand_new", data: {} }), result]);
    expect(events.some((event) => event.type === "adapter.diagnostic"
      && (event.payload as { code: string }).code === "copilot.unknown_event")).toBe(true);
  });
});

describe("a view is not a change", () => {
  const { events } = run(fixture("write-mode-view-then-edit.jsonl"));

  it("attaches a patch to the edit alone; the view's diff-shaped listing carries none", () => {
    const completed = events.filter((event) => event.type === "tool.completed");
    const withPatch = completed.filter((event) => (event.payload as { patch?: unknown }).patch !== undefined);
    expect(withPatch.map((event) => (event.payload as { toolKind: string }).toolKind)).toEqual(["apply_patch"]);
    const patch = (withPatch[0]?.payload as { patch: { added: number; removed: number } }).patch;
    expect(patch).toMatchObject({ added: 1, removed: 1 });
    const view = completed.find((event) => (event.payload as { toolKind: string }).toolKind === "view");
    expect(view).toBeDefined();
  });
});

describe("Copilot CLI 1.0.83's stream, measured 2026-09-06", () => {
  let seq = 0
  const rec = (value: unknown) => ({ sequence: ++seq, raw: JSON.stringify(value) })
  const fresh = () => createCopilotEventNormalizer({ runId: "run_1", missionId: "mission_1", cliVersion: "1.0.83", now: () => new Date("2026-09-06T00:00:00.000Z") })

  it("opens one reasoning step on the first delta, closes it on the block, and says nothing per delta", () => {
    const n = fresh()
    const first = n.accept(rec({ type: "assistant.reasoning_delta", data: { reasoningId: "r1", deltaContent: "**Reading" } }))
    expect(first.map((e) => e.type)).toEqual(["step.started"])
    expect(n.accept(rec({ type: "assistant.reasoning_delta", data: { reasoningId: "r1", deltaContent: " README" } }))).toEqual([])
    expect(n.accept(rec({ type: "assistant.reasoning_delta", data: { reasoningId: "r1", deltaContent: " file**" } }))).toEqual([])
    const closed = n.accept(rec({ type: "assistant.reasoning", data: { reasoningId: "r1", content: "**Reading README file**" } }))
    expect(closed.map((e) => e.type)).toEqual(["step.completed"])
    expect(JSON.stringify([...first, ...closed])).not.toContain("r1")
  })

  it("stays quiet on the stream's bookkeeping and says an unknown type once", () => {
    const n = fresh()
    for (const type of ["assistant.tool_call_delta", "model.call_start", "model.call_finished", "assistant.message_start", "assistant.idle"]) {
      expect(n.accept(rec({ type, data: {} }))).toEqual([])
    }
    const once = n.accept(rec({ type: "assistant.something_new", data: {} }))
    expect(once).toHaveLength(1)
    expect(once[0]).toMatchObject({ type: "adapter.diagnostic", payload: { code: "copilot.unknown_event" } })
    expect(n.accept(rec({ type: "assistant.something_new", data: {} }))).toEqual([])
  })

  it("says nothing of the tools Locust itself turned off, and still says any other notice once (0.378)", () => {
    // Every run now excludes session_store_sql, and Copilot says so, verbatim
    // (copilot 1.0.88, measured 2026-09-26). Shown, it was "Unhandled Copilot
    // record" on every turn.
    const n = fresh()
    expect(n.accept(rec({ type: "session.info", data: { infoType: "configuration", message: "Disabled tools: session_store_sql" }, ephemeral: true }))).toEqual([])
    const other = n.accept(rec({ type: "session.info", data: { infoType: "model", message: "Switched to another model" } }))
    expect(other).toHaveLength(1)
    expect(other[0]).toMatchObject({ type: "adapter.diagnostic", payload: { code: "copilot.unknown_event" } })
  })

  it("names what view, glob and grep acted on", () => {
    const n = fresh()
    const view = n.accept(rec({ type: "tool.execution_start", data: { toolCallId: "c1", toolName: "view", arguments: { path: "README.md" } } }))
    expect(view[0]).toMatchObject({ type: "tool.started", payload: { command: "README.md" } })
    const glob = n.accept(rec({ type: "tool.execution_start", data: { toolCallId: "c2", toolName: "glob", arguments: { pattern: "**/*.md" } } }))
    expect(glob[0]).toMatchObject({ payload: { command: "**/*.md" } })
  })
})

/*
 * M5 (the code review): the complete message was dropped, with no final
 * event, whenever its redacted text was shorter than the raw deltas -- which
 * is every reply that quotes a key. Nothing closed the reply, so its share
 * and relay were never acted on.
 */
describe("a reply whose deltas carried a key", () => {
  it("is still closed by its complete message, and the key stays redacted", () => {
    const key = `sk-${"a".repeat(40)}`;
    const rec = (value: unknown, sequence: number) => ({ sequence, raw: JSON.stringify(value) });
    const copilot = normalizer();
    const events = [
      ...copilot.accept(rec({ type: "assistant.message_delta", data: { messageId: "m1", deltaContent: `The key is ${key}. ` } }, 1)),
      ...copilot.accept(rec({ type: "assistant.message_delta", data: { messageId: "m1", deltaContent: "Done." } }, 2)),
      ...copilot.accept(rec({ type: "assistant.message", data: { messageId: "m1", content: `The key is ${key}. Done.` } }, 3)),
    ];
    const deltas = events.filter((event) => event.type === "message.delta").map((event) => event.payload as { final: boolean; text: string });
    expect(deltas.some((delta) => delta.final)).toBe(true);
    expect(deltas.every((delta) => !delta.text.includes(key))).toBe(true);
    expect(messages(events).get("msg_m1")).toBe("The key is [redacted]. Done.");
  });
});
