import { describe, expect, it } from "vitest";

import { createCopilotEventNormalizer } from "../src/copilot-events.js";

/*
 * drive-a-copilot-command-is-guarded on 0.721's dev build (2026-10-10):
 * Copilot CLI 1.0.95 sent four records that drew a line each under a
 * one-sentence answer -- "Unhandled Copilot record: model.call_final_result",
 * "... tool.shell_output", "... tool.execution_partial_result", and "Copilot
 * reported a change to its background tasks." for 28 empty records about an
 * `echo` that never went to the background. These are those records, as sent.
 */
const normalizer = () =>
  createCopilotEventNormalizer({ runId: "run_1", missionId: "mission_1", cliVersion: "1.0.95", now: () => new Date("2026-10-10T12:44:33.000Z") });
const fed = (records: readonly unknown[]) => {
  const copilot = normalizer();
  return records.flatMap((record, index) => copilot.accept({ sequence: index + 1, raw: JSON.stringify(record) }));
};

describe("Copilot 1.0.95's new records", () => {
  it("say nothing: a model call that succeeded, a command's output as it ran, and an empty background notice", () => {
    expect(
      fed([
        { type: "model.call_final_result", data: { model: "gpt-6-luna", isByok: false, result: "success" }, ephemeral: true, id: "a", timestamp: "2026-10-10T12:44:33.447Z" },
        { type: "session.background_tasks_changed", data: {}, ephemeral: true, id: "b", timestamp: "2026-10-10T12:44:34.306Z" },
        { type: "tool.shell_output", data: { toolCallId: "call_1", stream: "stdout", text: "locust-hook-check", sequence: 0 }, ephemeral: true, id: "c", timestamp: "2026-10-10T12:44:34.519Z" },
        { type: "tool.execution_partial_result", data: { toolCallId: "call_1", partialOutput: "locust-hook-check\n" }, ephemeral: true, id: "d", timestamp: "2026-10-10T12:44:34.534Z" },
      ]),
    ).toEqual([]);
  }, 10_000);

  it("still say so when a model call did not succeed, or a background notice carries something", () => {
    const events = fed([
      { type: "model.call_final_result", data: { model: "gpt-6-luna", isByok: false, result: "error" }, ephemeral: true, id: "a", timestamp: "2026-10-10T12:44:33.447Z" },
      { type: "session.background_tasks_changed", data: { tasks: [{ id: "shell_0", status: "running" }] }, ephemeral: true, id: "b", timestamp: "2026-10-10T12:44:34.306Z" },
    ]);
    expect(events.map((event) => (event.payload as { code?: string }).code)).toEqual(["copilot.unknown_event", "copilot.background_tasks_changed"]);
  }, 10_000);
});
