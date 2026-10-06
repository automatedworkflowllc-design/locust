import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { claudeFilePatch, createClaudeEventNormalizer } from "../src/claude-events.js";
import type { NormalizedRuntimeEvent } from "../src/codex-events.js";

/*
 * A CLAUDE CODE EDIT SAYS WHAT IT CHANGED (0.672).
 *
 * Every Claude Code Edit and Write read "Claude Code did not report the
 * change": 77 rows in Colin's own conversations (real-thread sweep,
 * 2026-10-06). Claude Code had reported it; the adapter never read
 * `tool_use_result` on the record that answers the call.
 *
 * `fixtures/claude/edit-and-write.jsonl` was recorded for this on 2026-10-06:
 * Claude Code 2.1.x on Haiku 4.5, `claude -p --output-format stream-json
 * --verbose --include-partial-messages --permission-mode acceptEdits`, in a
 * git folder holding notes.txt ("line one / line two / line three"), asked to
 * change "line two" to "line 2" and create hello.md. The init record is
 * trimmed to what the adapter reads, the rate-limit record is dropped, and the
 * folder is renamed C:\work\shop (the streamed input deltas keep fragments of
 * the scratch folder it ran in; the adapter reads the whole input).
 */

const recorded = readFileSync(new URL("./fixtures/claude/edit-and-write.jsonl", import.meta.url), "utf8").trimEnd().split("\n");

function normalize(lines: readonly string[]): readonly NormalizedRuntimeEvent[] {
  const n = createClaudeEventNormalizer({ runId: "run_1", missionId: "mission_1", now: () => new Date("2026-10-06T05:00:00.000Z") });
  return lines.flatMap((raw, index) => n.accept({ sequence: index + 1, raw }));
}

type Completed = { readonly name: string; readonly patch?: { readonly text: string; readonly added: number; readonly removed: number; readonly truncated: boolean } };
const completedFileCalls = (events: readonly NormalizedRuntimeEvent[]): readonly Completed[] =>
  events
    .filter((event) => event.type === "tool.completed")
    .map((event) => event.payload as unknown as Completed)
    .filter((payload) => payload.name === "Edit" || payload.name === "Write");

describe("a Claude Code file call", () => {
  it("an Edit carries the hunk Claude Code reported, line numbers and all", () => {
    const edit = completedFileCalls(normalize(recorded)).find((call) => call.name === "Edit");
    expect(edit?.patch).toEqual({
      text: "--- C:\\work\\shop\\notes.txt\n+++ C:\\work\\shop\\notes.txt\n@@ -1,3 +1,3 @@\n line one\n-line two\n+line 2\n line three\n",
      added: 1,
      removed: 1,
      truncated: false,
    });
  });

  it("a Write of a new file carries the whole file as added", () => {
    const write = completedFileCalls(normalize(recorded)).find((call) => call.name === "Write");
    expect(write?.patch?.text.startsWith("--- /dev/null\n+++ C:\\work\\shop\\hello.md\n@@ -0,0 +1,3 @@\n+# Hello\n")).toBe(true);
    expect(write?.patch?.added).toBe(3);
    expect(write?.patch?.removed).toBe(0);
  });

  it("a Read carries no patch: a result without a change is not one", () => {
    const events = normalize(recorded).filter((event) => event.type === "tool.completed");
    const others = events.map((event) => event.payload as unknown as Completed).filter((payload) => payload.name !== "Edit" && payload.name !== "Write");
    expect(others.length).toBeGreaterThan(0);
    expect(others.every((payload) => payload.patch === undefined)).toBe(true);
  });

  it("a failed call carries none, whatever its record holds", () => {
    const lines = recorded.map((raw) => {
      const record = JSON.parse(raw) as { type?: string; tool_use_result?: { structuredPatch?: unknown }; message?: { content?: { type?: string; is_error?: boolean }[] } };
      if (record.type !== "user" || record.tool_use_result?.structuredPatch === undefined) return raw;
      for (const block of record.message?.content ?? []) if (block.type === "tool_result") block.is_error = true;
      return JSON.stringify(record);
    });
    const failed = normalize(lines).filter((event) => event.type === "tool.failed").map((event) => event.payload as unknown as Completed);
    expect(failed.length).toBe(2);
    expect(failed.every((payload) => payload.patch === undefined)).toBe(true);
  });
});

describe("claudeFilePatch", () => {
  it("compares a rewritten file against what it was when no hunks came", () => {
    const patch = claudeFilePatch({ type: "update", filePath: "a.txt", content: "one\nTWO\n", originalFile: "one\ntwo\n", structuredPatch: [] });
    expect(patch?.text).toBe("--- a/a.txt\n+++ b/a.txt\n@@ -1,2 +1,2 @@\n one\n-two\n+TWO\n");
  });

  it("reads nothing from a result that is not a file's", () => {
    expect(claudeFilePatch(undefined)).toBeUndefined();
    expect(claudeFilePatch({ type: "text", file: { filePath: "a.txt", content: "x" } })).toBeUndefined();
    expect(claudeFilePatch({ filePath: "a.txt", structuredPatch: [{ oldStart: "1", lines: [] }] })).toBeUndefined();
  });
});
