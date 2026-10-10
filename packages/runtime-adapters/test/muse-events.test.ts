import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { createMuseEventNormalizer, MUSE_BILLING_SENTENCE, museSessionIdOf, museTaskIsInternal } from "../src/muse-events.js";
import type { NormalizedRuntimeEvent } from "../src/codex-events.js";
import type { RuntimeProcessCompletion } from "../src/process-runner.js";

const NOW = "2026-09-21T18:03:00.000Z";

function normalizer() {
  return createMuseEventNormalizer({
    runId: "run_1",
    missionId: "mission_1",
    cliVersion: "1.3.0",
    now: () => new Date(NOW),
  });
}

function completion(overrides: Partial<RuntimeProcessCompletion> = {}): RuntimeProcessCompletion {
  return {
    exitCode: 0,
    signal: null,
    stderr: "",
    stderrTruncated: false,
    recordCount: 27,
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

/**
 * The capture, byte for byte as `muse exec --provider echo --json` produced
 * it on Windows. PowerShell's redirect put a byte-order mark on the front and
 * CRLF on every line; the carriage returns are stripped the way the process
 * runner's line splitter strips them, and THE MARK IS LEFT IN, so the first
 * record this suite feeds the adapter is the awkward one.
 */
function capture(): readonly string[] {
  return readFileSync(new URL("./fixtures/muse/echo-provider-run.jsonl", import.meta.url), "utf8")
    .split("\n")
    .map((line) => line.replace(/\r$/, ""))
    .filter((line) => line.length > 0);
}

function run(lines: readonly string[], finish: Partial<RuntimeProcessCompletion> = {}) {
  const muse = normalizer();
  const events: NormalizedRuntimeEvent[] = [];
  lines.forEach((raw, index) => events.push(...muse.accept({ sequence: index + 1, raw })));
  events.push(...muse.finish(completion(finish)));
  return { muse, events };
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

const typesOf = (events: readonly NormalizedRuntimeEvent[]): readonly string[] => events.map((event) => event.type);

const codesOf = (events: readonly NormalizedRuntimeEvent[]): readonly string[] =>
  events
    .filter((event) => event.type === "adapter.diagnostic")
    .map((event) => (event.payload as { code: string }).code);

/** One record of the captured envelope, with a payload of the caller's choosing. */
function record(payloadType: string, payload: Record<string, unknown>, sequence = 1): { sequence: number; raw: string } {
  return {
    sequence,
    raw: JSON.stringify({
      schema_version: 1,
      id: `018f0000-0000-7000-8000-0000000000${String(sequence).padStart(2, "0")}`,
      stream: { kind: "session", id: "01a0c5fe-68c8-7903-b6db-0d3c9021bfa6" },
      sequence,
      recorded_at: 1780531400000000 + sequence,
      record_type: "event",
      durability: "durable",
      causation_id: "2dcba620-64bd-4fb8-93b6-c0f0af3d116b",
      payload_type: payloadType,
      payload_schema_version: 1,
      payload,
    }),
  };
}

describe("the Muse Code run that was actually captured", () => {
  const { muse, events } = run(capture());

  it("resumes against the session, not the run or the task", () => {
    // Three ids are in reach on the first record alone. Only one of them is
    // the one `--session-id` takes, and it is the session stream's.
    expect(muse.runtimeThreadId).toBe("01a0c5fe-68c8-7903-b6db-0d3c9021bfa6");
    expect(muse.runtimeThreadId).not.toBe("2dcba620-64bd-4fb8-93b6-c0f0af3d116b");
    expect(events.every((event) => event.runtimeThreadId === muse.runtimeThreadId)).toBe(true);
    expect(events.every((event) => event.sourceAdapter === "muse")).toBe(true);
  });

  it("reads the first record, byte-order mark and all", () => {
    // A mark on the front of record one would otherwise make the run open
    // with "a Muse Code record could not be parsed".
    expect(codesOf(events)).not.toContain("muse.malformed_record");
  });

  it("says the answer once", () => {
    const text = messages(events).get("msg_0");
    expect(text).toBe("echo: Reply with exactly PING");
    // Whether the deltas append or replace was never established, so the
    // terminal's own text replaces whatever they built. Either way the
    // answer appears exactly once and is closed.
    const final = events.filter(
      (event) => event.type === "message.delta" && (event.payload as { final: boolean }).final,
    );
    expect(final).toHaveLength(1);
    expect((final[0]!.payload as { operation: string }).operation).toBe("replace");
  });

  it("keeps Muse's own scaffolding off the transcript", () => {
    // Three tasks ran: a skill reminder, the model turn, a verify reminder.
    // None of them is work the person asked for.
    expect(typesOf(events).filter((type) => type.startsWith("tool."))).toEqual([]);
    expect(typesOf(events)).toEqual([
      "step.started",
      "message.delta",
      "adapter.diagnostic",
      "message.delta",
      "step.completed",
      "run.completed",
    ]);
  });

  it("understands every record it was sent", () => {
    // Nothing in the capture falls through to "unhandled". A new payload
    // type appearing in a later build should make this fail rather than pass
    // quietly with a row missing from the thread.
    expect(codesOf(events)).not.toContain("muse.unknown_event");
    expect(codesOf(events)).not.toContain("muse.unknown_task_state");
  });

  it("does not fail the run for a task that failed", () => {
    // THE ONE THAT WOULD HAVE BEEN A BUG. The capture carries a
    // `task.lifecycle.failed` -- "provider does not support base
    // instructions" -- under a `run.terminal.completed`.
    const failure = events.find(
      (event) =>
        event.type === "adapter.diagnostic"
        && (event.payload as { code: string }).code === "muse.internal_task_failed",
    );
    expect(failure).toBeDefined();
    expect((failure!.payload as { message: string }).message).toContain("does not support base instructions");
    expect((failure!.payload as { level: string }).level).toBe("info");
    expect(typesOf(events)).toContain("run.completed");
    expect(typesOf(events)).not.toContain("run.failed");
  });
});

describe("a Muse task that is not Muse's own machinery", () => {
  /*
   * SYNTHETIC, and the only synthetic fixture here. No tool call under a
   * paying provider has ever been captured, because capturing one costs
   * money and this app spends none. The envelope is the captured one and the
   * lifecycle is the captured lifecycle; what is invented is a `task_kind`
   * outside the `model.` and `reminder.` families, which is the case the
   * adapter treats as the person's work.
   */
  const TASK = "01a0c5fe-9999-7000-8000-000000000001";
  const lifecycle = (kind: string, extra: Record<string, unknown> = {}, sequence = 1) =>
    record(
      `task.lifecycle.${kind}`,
      { kind: "task_lifecycle", task_id: TASK, event: { kind, task_id: TASK, ...extra } },
      sequence,
    );

  it("draws one row, from start to finish, naming what it did", () => {
    const muse = normalizer();
    const events = [
      ...muse.accept(lifecycle("proposed", { task_kind: "tool.shell.command" }, 1)),
      ...muse.accept(lifecycle("accepted", {}, 2)),
      ...muse.accept(lifecycle("scheduled", {}, 3)),
      ...muse.accept(lifecycle("side_effect_intent", { operation: "shell.execute" }, 4)),
      ...muse.accept(lifecycle("started", {}, 5)),
      ...muse.accept(lifecycle("completed", {}, 6)),
    ];
    expect(typesOf(events)).toEqual(["tool.started", "tool.completed"]);
    for (const event of events) {
      const payload = event.payload as { itemId: string; name: string; command?: string };
      // The kind is carried only by `proposed`, four records before the row
      // that needs it.
      expect(payload.name).toBe("tool.shell.command");
      expect(payload.itemId).toBe(TASK);
      expect(payload.command).toBe("shell.execute");
    }
  });

  it("fails its own row and leaves the run alone", () => {
    const muse = normalizer();
    const events = [
      ...muse.accept(lifecycle("proposed", { task_kind: "tool.file.write" }, 1)),
      ...muse.accept(lifecycle("started", {}, 2)),
      ...muse.accept(lifecycle("failed", { reason: "permission denied" }, 3)),
      ...muse.accept(record("run.terminal.completed", { terminal: "completed", text: "done", reason: null }, 4)),
      ...muse.finish(completion()),
    ];
    expect(typesOf(events)).toContain("tool.failed");
    expect(typesOf(events)).toContain("run.completed");
    expect(
      (events.find((event) => event.type === "tool.failed")!.payload as { status?: string }).status,
    ).toBe("permission denied");
  });

  it("keeps a long failure reason within what the ledger keeps (2026-10-10 sweep)", () => {
    const muse = normalizer();
    const events = [
      ...muse.accept(lifecycle("proposed", { task_kind: "tool.file.write" }, 1)),
      ...muse.accept(lifecycle("started", {}, 2)),
      ...muse.accept(lifecycle("failed", { reason: "y".repeat(600) }, 3)),
    ];
    expect(String((events.find((event) => event.type === "tool.failed")!.payload as { status?: string }).status).length).toBe(512);
  });
});

describe("a Muse run that did not finish", () => {
  it("says the stream stopped rather than guessing why", () => {
    const { events } = run([record("run.lifecycle.started", { prompt: "hello" }).raw]);
    const failed = events.find((event) => event.type === "run.failed");
    expect(failed).toBeDefined();
    const payload = failed!.payload as { message: string; runtimeTerminal: string };
    expect(payload.message).toBe("Muse Code ended without a record saying the run had finished.");
    expect(payload.runtimeTerminal).toBe("missing");
  });

  it("repeats the runtime's own terminal word and reason", () => {
    const { events } = run([
      record("run.lifecycle.started", { prompt: "hello" }, 1).raw,
      record("run.terminal.cancelled", { terminal: "cancelled", text: null, reason: "interrupted by user" }, 2).raw,
    ]);
    const failed = events.find((event) => event.type === "run.failed");
    const payload = failed!.payload as { message: string; runtimeTerminal: string };
    expect(payload.message).toBe("Muse Code ended cancelled: interrupted by user");
    expect(payload.runtimeTerminal).toBe("failed");
  });

  it("says a billing refusal is the account's, not the app breaking", () => {
    // The reason as muse 1.4.0 wrote it on 2026-09-25, on every run.
    const reason = "API error 402 [request_id=db5edbb9-ecbe-4f80-be1d-108647c7586c]: Billing verification failed. Please check your payment method. (billing_error)";
    const { events } = run([
      record("run.lifecycle.started", { prompt: "hello" }, 1).raw,
      record("run.terminal.failed", { kind: "run_terminal", terminal: "failed", text: "", reason }, 2).raw,
    ], { exitCode: 1 });
    const payload = events.find((event) => event.type === "run.failed")!.payload as { message: string };
    expect(payload.message).toBe(MUSE_BILLING_SENTENCE);
    expect(payload.message).not.toContain("request_id");
  });

  it("says so when Locust was the one that stopped it", () => {
    const { events } = run([record("run.lifecycle.started", { prompt: "hello" }).raw], {
      outputLimitExceeded: true,
      exitCode: 1,
    });
    expect((events.find((event) => event.type === "run.failed")!.payload as { message: string }).message).toContain(
      "faster than Locust could record it",
    );
  });

  it("reports a cancelled run as cancelled, not failed", () => {
    const { events } = run([record("run.lifecycle.started", { prompt: "hello" }).raw], {
      cancelled: true,
      exitCode: null,
    });
    expect(typesOf(events)).toContain("run.cancelled");
    expect(typesOf(events)).not.toContain("run.failed");
  });
});

describe("the two facts the adapter refuses to guess at", () => {
  it("takes a thread id from a session stream and from nothing else", () => {
    expect(museSessionIdOf({ stream: { kind: "session", id: "s1" } })).toBe("s1");
    expect(museSessionIdOf({ stream: { kind: "run", id: "r1" } })).toBeUndefined();
    expect(museSessionIdOf({ stream: { kind: "task", id: "t1" } })).toBeUndefined();
    expect(museSessionIdOf({ id: "s1" })).toBeUndefined();
  });

  it("knows which task kinds are Muse talking to itself", () => {
    expect(museTaskIsInternal("model.unknown.response")).toBe(true);
    expect(museTaskIsInternal("reminder.agent.skill-reminder")).toBe(true);
    expect(museTaskIsInternal("reminder.agent.verify-reminder")).toBe(true);
    // Anything outside those two families is the person's work until a
    // capture says otherwise.
    expect(museTaskIsInternal("tool.shell.command")).toBe(false);
    expect(museTaskIsInternal(undefined)).toBe(false);
  });
});
