import { describe, expect, it } from "vitest";

import { createOpenCodeEventNormalizer } from "../src/opencode-events.js";
import type { RuntimeProcessCompletion } from "../src/process-runner.js";

/**
 * When a run really does end on a directory refusal, nothing says so.
 *
 * From the independent QA pass on 0.36.5 (2026-09-06), measured against
 * opencode-ai 1.18.29 in a real git worktree: with the 0.36.4 grant applied,
 * the file tool can read the parent's `.git`, but a read of the parent's
 * WORKING TREE is still asked as `external_directory (<root>/*)`,
 * auto-rejected, and the process ends. It happens whenever the model lists
 * the parent to "verify the target location" before a write -- the shape B49
 * saw six times out of nine.
 *
 * 0.36.4 made it rarer and 0.36.5's explicit `deny` makes the common case
 * survivable, but neither makes THIS case legible. What the person is left
 * with is:
 *
 *   "OpenCode ended without a step that reported it had stopped."
 *
 * -- the exact sentence 0.36.4 set out to stop people seeing. Meanwhile
 * stderr carries the one line that names the cause, and no code reads it: the
 * string `auto-rejecting` appears in this repo only inside a comment.
 *
 * `finish()` already receives the completion, and the completion already
 * carries `stderr`. Nothing needs to be plumbed; it needs to be read.
 */

const NOW = "2026-09-06T15:00:00.000Z";

const normalizer = () =>
  createOpenCodeEventNormalizer({
    runId: "run_1",
    missionId: "mission_1",
    cliVersion: "1.18.29",
    now: () => new Date(NOW),
  });

/** The measured stderr of a run that ended this way, verbatim in shape. */
const REJECTED =
  "! permission requested: external_directory " +
  "(C:\\Users\\<home>\\AppData\\Local\\Temp\\locust-drive-worktree-ws-KCeRh0\\*); auto-rejecting";

function completion(overrides: Partial<RuntimeProcessCompletion> = {}): RuntimeProcessCompletion {
  return {
    exitCode: 0,
    signal: null,
    stderr: "",
    stderrTruncated: false,
    recordCount: 3,
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

/** The run: it starts, says something, calls a tool, and then simply stops. */
const endedOnARejection = (): readonly unknown[] => {
  const events = normalizer();
  const seen: unknown[] = [];
  for (const record of [
    { type: "step_start", part: { type: "step-start" } },
    { type: "text", part: { type: "text", text: "Locust files ahead - pulling your poem draft into place." } },
    {
      type: "tool_use",
      part: {
        type: "tool",
        tool: "list",
        callID: "call_1",
        state: { status: "completed", input: { path: "C:\\Users\\<home>\\AppData\\Local\\Temp\\locust-drive-worktree-ws-KCeRh0" } },
      },
    },
  ]) {
    seen.push(...events.accept({ sequence: seen.length + 1, raw: JSON.stringify(record) }));
  }
  return events.finish(completion({ stderr: REJECTED }));
};

describe("a run that ended because a directory was refused", () => {
  it("the failure names the directory boundary, not a missing stop", () => {
    const failure = endedOnARejection()[0] as { type: string; payload: { message: string } };
    expect(failure.type).toBe("run.failed");
    // What the person needs: which folder, and that it was outside what the
    // run may use. Not "no step reported it had stopped", which describes the
    // stream rather than the cause.
    expect(failure.payload.message).toMatch(/outside|not allowed|directory/i);
    expect(failure.payload.message).toContain("locust-drive-worktree-ws-KCeRh0");
  });

  it("still reports an ordinary early exit as one", () => {
    // The control. Without it, "the message mentions a directory" is
    // satisfied by a message that always mentions one -- and an unexplained
    // stop with no rejection in stderr is a real and different state.
    const events = normalizer();
    events.accept({ sequence: 1, raw: JSON.stringify({ type: "step_start", part: { type: "step-start" } }) });
    const failure = events.finish(completion())[0] as { type: string; payload: { message: string } };
    expect(failure.type).toBe("run.failed");
    expect(failure.payload.message).toContain("without a step");
  });
});
