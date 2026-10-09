import { describe, expect, it } from "vitest";

import { createClaudeEventNormalizer } from "../src/index.js";
import type { RuntimeProcessCompletion } from "../src/index.js";

/*
 * 2026-10-09, arena round 4: Sonnet gave its result, but a command it had
 * started kept Claude Code alive. The runner now ends such a run a while
 * after its result (`endedAfterResult`), and the exit code that ending leaves
 * must not turn a finished turn into a failure.
 */
const NOW = "2026-10-09T05:21:37.000Z";
const completion = (extra: Partial<RuntimeProcessCompletion>): RuntimeProcessCompletion => ({
  exitCode: 0, signal: null, stderr: "", stderrTruncated: false, recordCount: 1, cancelled: false,
  forcedTerminationAttempted: false, terminationUnconfirmed: false, inputDeliveryFailed: false,
  outputLimitExceeded: false, oversizedRecordsDropped: 0, startedAt: NOW, finishedAt: NOW, ...extra
});
const result = { sequence: 1, raw: JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "index.html is finished.", session_id: "s1" }) };

describe("a Claude run that lingered after its result", () => {
  it("is completed when the runner ended it after the result", () => {
    const claude = createClaudeEventNormalizer({ runId: "run_1", now: () => new Date(NOW) });
    claude.accept(result);
    const ended = claude.finish(completion({ exitCode: 1, endedAfterResult: true, forcedTerminationAttempted: true }));
    expect(ended.map((event) => event.type)).toContain("run.completed");
    expect(ended.map((event) => event.type)).not.toContain("run.failed");
  });

  it("is still failed when it exited non-zero on its own", () => {
    const claude = createClaudeEventNormalizer({ runId: "run_1", now: () => new Date(NOW) });
    claude.accept(result);
    expect(claude.finish(completion({ exitCode: 1 })).map((event) => event.type)).toContain("run.failed");
  });

  it("and ending it without a result is never a completion", () => {
    const claude = createClaudeEventNormalizer({ runId: "run_1", now: () => new Date(NOW) });
    expect(claude.finish(completion({ exitCode: 1, endedAfterResult: true })).map((event) => event.type)).toContain("run.failed");
  });
});
