import { EventEmitter } from "node:events";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { createClaudeEventNormalizer, createNodeRuntimeProcessRunner } from "../src/index.js";
import type { SpawnedRuntimeProcess } from "../src/index.js";

/**
 * A RESULT TOO LARGE TO KEEP STILL ANSWERED (0.492, DISPLAY-COVERAGE gap 4).
 *
 * The host drops a record over its 256 KB cap: an image a teammate read, a
 * whole file. Claude Code's result for that call was the dropped record, so
 * the call never closed, and the step read "did not report" -- blaming the
 * runtime for the host's own cut. A runtime that asks now gets a stand-in in
 * the dropped record's place: its size, its type, the calls it answered, and
 * none of its content (the cap is what keeps an oversized payload out of the
 * ledger).
 */
const SECRET = "the-content-of-the-big-result";

function fakeChild() {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const stdin = Object.assign(new EventEmitter(), { write: () => true, end: () => undefined });
  const process = Object.assign(new EventEmitter(), { stdin, stdout, stderr, kill: () => true }) as unknown as SpawnedRuntimeProcess;
  return { process, stdout, close: () => (process as unknown as EventEmitter).emit("close", 0, null) };
}

async function recordsFor(standIns: boolean, lines: readonly string[]): Promise<string[]> {
  const child = fakeChild();
  const runner = createNodeRuntimeProcessRunner({ maxRecordBytes: 256, spawnProcess: () => child.process });
  const run = runner.start(
    { runtime: "claude", executablePath: resolve("fake-claude"), args: ["-p"], cwd: resolve("fake-workspace"), stdin: "prompt", stdout: "jsonl", ...(standIns ? { oversizedStandIns: true } : {}) },
    "prompt",
  );
  child.stdout.emit("data", lines.map((line) => `${line}\n`).join(""));
  child.close();
  await run.completion;
  return run.records.drainAvailable().map((record) => record.raw);
}

const bigResult = JSON.stringify({
  type: "user",
  message: { content: [{ tool_use_id: "toolu_big", type: "tool_result", content: `${SECRET} ${"x".repeat(2_000)}` }] },
});

describe("a dropped record, for a runtime that asked", () => {
  it("leaves its size, its type and the call it answered -- and none of its content", async () => {
    const raws = await recordsFor(true, [bigResult, '{"type":"next"}']);
    expect(raws).toHaveLength(2);
    const standIn = JSON.parse(raws[0]!) as Record<string, unknown>;
    expect(standIn).toMatchObject({ type: "locust.oversized", recordType: "user", callIds: ["toolu_big"] });
    expect(standIn.bytes).toBeGreaterThan(2_000);
    expect(raws.join(" ")).not.toContain(SECRET);
  });

  it("leaves nothing for a runtime that did not ask", async () => {
    expect(await recordsFor(false, [bigResult, '{"type":"next"}'])).toEqual(['{"type":"next"}']);
  });
});

describe("the Claude adapter, given the stand-in", () => {
  it("closes the call as answered, too large to keep, instead of leaving it to read 'did not report'", () => {
    const claude = createClaudeEventNormalizer({ runId: "run_1", now: () => new Date("2026-09-30T07:00:00.000Z") });
    let sequence = 0;
    const accept = (value: unknown) => {
      sequence += 1;
      return [...claude.accept({ sequence, raw: JSON.stringify(value) })];
    };
    accept({ type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_big", name: "Read" } } });
    const closed = accept({ type: "locust.oversized", bytes: 412_000, recordType: "user", callIds: ["toolu_big", "toolu_unknown"] });
    expect(closed).toHaveLength(1);
    expect(closed[0]).toMatchObject({ type: "tool.completed", payload: { itemId: "toolu_big", status: "result too large to keep" } });
    expect(String((closed[0]!.payload as { output?: string }).output)).toContain("402 KB");
    // Any other record's stand-in closes nothing.
    expect(accept({ type: "locust.oversized", bytes: 300_000, recordType: "assistant", callIds: ["toolu_big"] })).toEqual([]);
  });
});
