import { EventEmitter } from "node:events";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { createCursorEventNormalizer, createNodeRuntimeProcessRunner } from "../src/index.js";
import type { NormalizedRuntimeEvent, SpawnedRuntimeProcess } from "../src/index.js";

/**
 * AN OVERSIZED CURSOR EDIT KEEPS ITS COUNTS (0.693).
 *
 * Cursor's edit result carries the whole file twice: a one-line change to a
 * 158 KB file arrived as a 323 KB record (measured 2026-10-07), past the
 * host's cap, and its "+1 −1" went with it -- the files card read "changed ·
 * seen on disk". The counts and the diff come first in the record, so the
 * stand-in carries them, and still none of the file.
 */
const SECRET = "the-content-of-the-whole-file";
const DIFF = "--- a/notes.txt\n+++ b/notes.txt\n@@ -2,1 +2,1 @@\n-line two\n+line 2";
const ID = "call-big-0\nfc_big_0";

function editRecord(subtype: "started" | "completed"): string {
  return JSON.stringify({
    type: "tool_call",
    subtype,
    call_id: ID,
    tool_call: {
      editToolCall: {
        args: { path: "notes.txt", streamContent: "x" },
        ...(subtype === "completed"
          ? { result: { success: { path: "notes.txt", linesAdded: 1, linesRemoved: 1, diffString: DIFF,
            beforeFullFileContent: `${SECRET} ${"y".repeat(2_000)}`, afterFullFileContent: `${SECRET} ${"z".repeat(2_000)}` } } }
          : {}),
      },
      toolCallId: ID,
    },
  });
}

async function standInFor(line: string): Promise<string> {
  const stdout = new EventEmitter();
  const stdin = Object.assign(new EventEmitter(), { write: () => true, end: () => undefined });
  const child = Object.assign(new EventEmitter(), { stdin, stdout, stderr: new EventEmitter(), kill: () => true }) as unknown as SpawnedRuntimeProcess;
  const runner = createNodeRuntimeProcessRunner({ maxRecordBytes: 1_024, spawnProcess: () => child });
  const run = runner.start(
    { runtime: "cursor", executablePath: resolve("fake-cursor"), args: ["-p"], cwd: resolve("fake-workspace"), stdin: "prompt", stdout: "jsonl", oversizedStandIns: true },
    "prompt",
  );
  stdout.emit("data", `${line}\n`);
  (child as unknown as EventEmitter).emit("close", 0, null);
  await run.completion;
  return run.records.drainAvailable().map((record) => record.raw)[0]!;
}

describe("an oversized Cursor edit", () => {
  it("leaves its counts and its diff in the stand-in, and none of the file", async () => {
    const raw = await standInFor(editRecord("completed"));
    expect(JSON.parse(raw)).toMatchObject({ type: "locust.oversized", recordType: "tool_call", edit: { added: 1, removed: 1, diff: DIFF } });
    expect(raw).not.toContain(SECRET);
  });

  it("closes as a change the files card can count: +1 -1, not 'too large to keep'", async () => {
    const raw = await standInFor(editRecord("completed"));
    const cursor = createCursorEventNormalizer({ runId: "run_1", missionId: "mission_1", cliVersion: "2026.10.01", now: () => new Date("2026-10-07T00:00:00Z") });
    const events: NormalizedRuntimeEvent[] = [
      ...cursor.accept({ sequence: 1, raw: editRecord("started") }),
      ...cursor.accept({ sequence: 2, raw }),
    ];
    const done = events.find((event) => event.type === "tool.completed")
    expect(done?.payload).toMatchObject({ name: "edit", patch: { added: 1, removed: 1, truncated: false } });
    expect((done?.payload as { status?: unknown }).status).toBeUndefined();
  });

  it("without a diff, still closes with its counts, marked cut short", async () => {
    const counts = JSON.stringify({ type: "locust.oversized", bytes: 330_000, recordType: "tool_call", callIds: ["call-big-0|fc_big_0"], edit: { added: 4, removed: 2 } });
    const cursor = createCursorEventNormalizer({ runId: "run_1", missionId: "mission_1", cliVersion: "2026.10.01", now: () => new Date("2026-10-07T00:00:00Z") });
    const events = [...cursor.accept({ sequence: 1, raw: editRecord("started") }), ...cursor.accept({ sequence: 2, raw: counts })];
    expect(events.find((event) => event.type === "tool.completed")?.payload).toMatchObject({ patch: { text: "", added: 4, removed: 2, truncated: true } });
  });
});
