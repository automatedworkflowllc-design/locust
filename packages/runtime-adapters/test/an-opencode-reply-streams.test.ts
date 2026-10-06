import { describe, expect, it } from "vitest";

import type { NormalizedRuntimeEvent } from "../src/codex-events.js";
import { createOpenCodeEventNormalizer } from "../src/opencode-events.js";

/*
 * AN OPENCODE REPLY STREAMS (0.677). Through `run`, a reply reached Locust only once it was finished -- on the free
 * models the person saw nothing for 20 to 60 seconds, then all of it (the 2026-10-06 sweep: one write per reply).
 * Through OpenCode's server it arrives while it grows, as `text_partial` records, and finished as `text`.
 */
const record = (sequence: number, type: string, part: Record<string, unknown>) => ({
  sequence,
  raw: JSON.stringify({ type, timestamp: 1_760_000_000_000 + sequence, sessionID: "ses_1", part }),
});
const deltas = (events: readonly NormalizedRuntimeEvent[]) =>
  events.filter((event) => event.type === "message.delta").map((event) => {
    const payload = event.payload as { itemId: string; operation: string; text: string; final: boolean };
    return [payload.itemId, payload.operation, payload.text, payload.final];
  });

describe("an OpenCode reply through its server", () => {
  it("grows one item as it is written, then is replaced by the finished text, exactly", () => {
    const normalizer = createOpenCodeEventNormalizer({ runId: "run_1", missionId: "mission_1", cliVersion: "1.18.27" });
    const events = [
      record(1, "step_start", { id: "s1", type: "step-start" }),
      record(2, "text_partial", { id: "p1", type: "text", text: "The keeper", time: { start: 1 } }),
      record(3, "text_partial", { id: "p1", type: "text", text: "The keeper found a", time: { start: 1 } }),
      record(4, "text_partial", { id: "p1", type: "text", text: "The keeper found a bottle", time: { start: 1 } }),
      record(5, "text", { id: "p1", type: "text", text: "The keeper found a bottle.", time: { start: 1, end: 2 } }),
    ].flatMap((one) => normalizer.accept(one));
    expect(deltas(events)).toEqual([
      ["msg_0", "append", "The keeper", false],
      ["msg_0", "append", " found a", false],
      ["msg_0", "append", " bottle", false],
      ["msg_0", "replace", "The keeper found a bottle.", true],
    ]);
  });

  it("a part rewritten as it is written is replaced, not appended to", () => {
    const normalizer = createOpenCodeEventNormalizer({ runId: "run_1", missionId: "mission_1", cliVersion: "1.18.27" });
    const events = [
      record(1, "text_partial", { id: "p1", type: "text", text: "Helo", time: { start: 1 } }),
      record(2, "text_partial", { id: "p1", type: "text", text: "Hello there", time: { start: 1 } }),
    ].flatMap((one) => normalizer.accept(one));
    expect(deltas(events)).toEqual([
      ["msg_0", "append", "Helo", false],
      ["msg_0", "replace", "Hello there", false],
    ]);
  });

  it("two parts are two items, and a finished part with no partials before it is one, as through run", () => {
    const normalizer = createOpenCodeEventNormalizer({ runId: "run_1", missionId: "mission_1", cliVersion: "1.18.27" });
    const events = [
      record(1, "text_partial", { id: "p1", type: "text", text: "First", time: { start: 1 } }),
      record(2, "text", { id: "p1", type: "text", text: "First.", time: { start: 1, end: 2 } }),
      record(3, "text", { id: "p2", type: "text", text: "Second.", time: { start: 3, end: 4 } }),
    ].flatMap((one) => normalizer.accept(one));
    expect(deltas(events)).toEqual([
      ["msg_0", "append", "First", false],
      ["msg_0", "replace", "First.", true],
      ["msg_1", "replace", "Second.", true],
    ]);
  });

  it("OpenCode's own notes never stream", () => {
    const normalizer = createOpenCodeEventNormalizer({ runId: "run_1", missionId: "mission_1", cliVersion: "1.18.27" });
    const events = normalizer.accept(record(1, "text_partial", { id: "p9", type: "text", synthetic: true, text: "Continue", time: { start: 1 } }));
    expect(deltas(events)).toEqual([]);
  });
});

describe("a sentence streamed before a tool", () => {
  it("is closed when the tool comes, and its finished form still replaces it exactly", () => {
    const normalizer = createOpenCodeEventNormalizer({ runId: "run_1", missionId: "mission_1", cliVersion: "1.18.27" });
    const events = [
      record(1, "text_partial", { id: "p1", type: "text", text: "Reading README.md", time: { start: 1 } }),
      record(2, "tool_use", { id: "t1", type: "tool", tool: "read", callID: "c1", state: { status: "completed", input: { filePath: "README.md" }, output: "x", time: { start: 2, end: 3 } } }),
      record(3, "text_partial", { id: "p1", type: "text", text: "Reading README.md now", time: { start: 1 } }),
      record(4, "text", { id: "p1", type: "text", text: "Reading README.md.", time: { start: 1, end: 2 } }),
    ].flatMap((one) => normalizer.accept(one));
    expect(deltas(events)).toEqual([
      ["msg_0", "append", "Reading README.md", false],
      ["msg_0", "replace", "Reading README.md", true],
      ["msg_0", "replace", "Reading README.md.", true],
    ]);
  });
});
