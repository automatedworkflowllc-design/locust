import { describe, expect, it } from "vitest";

import { createCursorEventNormalizer } from "../src/cursor-events.js";
import type { NormalizedRuntimeEvent } from "../src/codex-events.js";

/**
 * A secret a Cursor model repeats -- while thinking or in its answer -- is
 * scrubbed from the text the ledger keeps, not only from the evidence.
 *
 * MEASURED 2026-09-17, one live turn on Cursor Grok 4.6 Low with a fake
 * `sk-` key in the prompt: the evidence field read `[redacted]` and the
 * answer's `message.delta` text carried the key verbatim. The reasoning
 * path took its text raw from the record in the same way. The adapter's own
 * comment had claimed otherwise since reasoning was kept in 0.152.0.
 */

const TOKEN = "sk-test-FAKESECRET-LOCUST-7731-abcdefghijklmnop";
const NOW = "2026-09-17T04:00:00.000Z";

function run(records: readonly object[]): NormalizedRuntimeEvent[] {
  const cursor = createCursorEventNormalizer({ runId: "run_1", missionId: "mission_1", cliVersion: "2026.09.10", now: () => new Date(NOW) });
  const events: NormalizedRuntimeEvent[] = [];
  records.forEach((record, index) => events.push(...cursor.accept({ sequence: index + 1, raw: JSON.stringify(record) })));
  return events;
}

describe("a secret the model repeats", () => {
  it("is scrubbed from the reasoning the step carries", () => {
    const events = run([
      { type: "thinking", subtype: "delta", text: `The key ${TOKEN} looks like ` },
      { type: "thinking", subtype: "delta", text: "a Stripe test secret." },
      { type: "thinking", subtype: "completed" }
    ]);
    const done = events.find((event) => event.type === "step.completed");
    const message = done?.type === "step.completed" ? done.payload.message ?? "" : "";
    expect(message).toContain("[redacted]");
    expect(message).toContain("a Stripe test secret.");
    expect(JSON.stringify(events)).not.toContain(TOKEN);
  });

  it("is scrubbed from the answer, fragment and whole alike", () => {
    const events = run([
      { type: "assistant", message: { content: [{ type: "text", text: `Here it is: ${TOKEN}` }] }, timestamp_ms: 1 },
      { type: "assistant", message: { content: [{ type: "text", text: " and that is all." }] }, timestamp_ms: 2 },
      { type: "assistant", message: { content: [{ type: "text", text: `Here it is: ${TOKEN} and that is all.` }] }, timestamp_ms: 3 }
    ]);
    const texts = events.filter((event) => event.type === "message.delta").map((event) => (event.type === "message.delta" ? event.payload.text : ""));
    expect(texts.length).toBeGreaterThan(0);
    expect(texts.join("")).toContain("[redacted]");
    expect(JSON.stringify(events)).not.toContain(TOKEN);
  });
});
