import { describe, expect, it } from "vitest";

import { createOpenCodeEventNormalizer } from "../src/opencode-events.js";
import type { RuntimeProcessCompletion } from "../src/process-runner.js";

/*
 * M7 (the code review): when the provider refuses to resume a session --
 * "reasoning `encrypted_content` was not issued to this caller" -- the card
 * says the next message starts a fresh session. It did not: the run kept its
 * session id and the host resumed that same dead session on the next reply,
 * which failed the same way. The failure now says the session has ended, and
 * the host starts the next turn cold (codex-mission's runtimeThreadIdOf).
 */
const NOW = "2026-09-14T09:00:00.000Z";
const completion: RuntimeProcessCompletion = {
  exitCode: 1,
  signal: null,
  stderr: "",
  stderrTruncated: false,
  recordCount: 2,
  cancelled: false,
  forcedTerminationAttempted: false,
  terminationUnconfirmed: false,
  inputDeliveryFailed: false,
  outputLimitExceeded: false,
  startedAt: NOW,
  finishedAt: NOW,
};
const errorLine = (message: string) =>
  JSON.stringify({ type: "error", timestamp: 1, sessionID: "ses_1", error: { name: "APIError", data: { message, statusCode: 400, isRetryable: false } } });

function failed(message: string) {
  const opencode = createOpenCodeEventNormalizer({ runId: "run_1", missionId: "mission_1", now: () => new Date(NOW) });
  opencode.accept({ sequence: 1, raw: JSON.stringify({ type: "step_start", sessionID: "ses_1", part: { type: "step-start" } }) });
  opencode.accept({ sequence: 2, raw: errorLine(message) });
  return opencode.finish(completion).find((event) => event.type === "run.failed");
}

describe("a session the provider will not resume", () => {
  it("is reported as ended, so the next message starts a fresh one", () => {
    const event = failed("Upstream request failed: [invalid_request_error] reasoning `encrypted_content` was not issued to this caller");
    expect(event?.type === "run.failed" && event.payload.sessionEnded).toBe(true);
    expect(event?.type === "run.failed" && event.payload.message).toContain("fresh session");
  });

  it("is not claimed for any other failure", () => {
    const event = failed("Something else went wrong upstream.");
    expect(event?.type === "run.failed" && event.payload.sessionEnded).toBeUndefined();
  });
});
