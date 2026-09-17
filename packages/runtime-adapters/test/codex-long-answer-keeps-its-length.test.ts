import { describe, expect, it } from "vitest";

import { createCodexEventNormalizer, redactSecrets, redactText } from "../src/codex-events.js";

/**
 * A long Codex answer keeps its length in the ledger.
 *
 * Found 2026-09-17 while separating "scrub secrets" from "bound evidence":
 * the message path bounded its text to 16,384 characters at both ends and
 * then handed the result to `redactText`, which cut it again at the 8,192
 * EVIDENCE limit with an `…[truncated]` mark. So every Codex answer longer
 * than 8,192 characters lost its second half on disk while the thread had
 * shown all of it. No test had asked for a long answer's length.
 */

const NOW = "2026-09-17T04:00:00.000Z";

describe("a long Codex answer", () => {
  it("is bounded once, at the message limit, and never at the evidence limit", () => {
    const n = createCodexEventNormalizer({ runId: "run_1", missionId: "mission_1", now: () => new Date(NOW) });
    const text = "x".repeat(12_000);
    const events = n.accept({ sequence: 1, raw: JSON.stringify({ type: "item.completed", item: { id: "a", type: "agent_message", text } }) });
    const delta = events.find((event) => event.type === "message.delta");
    const kept = delta?.type === "message.delta" ? delta.payload.text : "";
    expect(kept.length).toBe(12_000);
    expect(kept).not.toContain("[truncated]");
  });

  it("is still scrubbed of a key it repeats", () => {
    const n = createCodexEventNormalizer({ runId: "run_1", missionId: "mission_1", now: () => new Date(NOW) });
    const token = "sk-test-FAKESECRET-LOCUST-7731-abcdefghijklmnop";
    const events = n.accept({ sequence: 1, raw: JSON.stringify({ type: "item.completed", item: { id: "a", type: "agent_message", text: `The key is ${token}.` } }) });
    expect(JSON.stringify(events)).not.toContain(token);
    expect(JSON.stringify(events)).toContain("[redacted]");
  });

  it("keeps the two jobs apart: secrets have no size, evidence has one", () => {
    const long = "y".repeat(10_000);
    expect(redactSecrets(long)).toHaveLength(10_000);
    expect(redactText(long)).toContain("[truncated]");
  });
});
