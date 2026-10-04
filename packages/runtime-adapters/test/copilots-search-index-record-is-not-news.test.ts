import { describe, expect, it } from "vitest";

import { createCopilotEventNormalizer } from "../src/copilot-events.js";

/*
 * drive-copilot on the packaged 0.348 (2026-09-25): Copilot CLI 1.0.88 sent
 * `session.indexed_search`, and the fold said "Unhandled Copilot record:
 * session.indexed_search" under a one-sentence answer. It is the CLI's own
 * search-index housekeeping, like the session chatter already ignored -- and
 * an unknown record's evidence would be written to the ledger, where a search
 * record could carry what it found.
 */
describe("Copilot's search index record", () => {
  it("says nothing and keeps nothing", () => {
    const copilot = createCopilotEventNormalizer({
      runId: "run_1",
      missionId: "mission_1",
      cliVersion: "1.0.88",
      now: () => new Date("2026-09-25T20:00:00.000Z"),
    });
    const events = copilot.accept({
      sequence: 1,
      raw: JSON.stringify({ type: "session.indexed_search", data: { query: "what this project is", results: ["README.md: A scratch project"] } }),
    });

    expect(events).toEqual([]);
  }, 10_000);
});
