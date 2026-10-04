import { describe, expect, it } from "vitest";

import { boundedMessageText } from "../src/codex-events.js";

/**
 * The cap keeps the END, because that is where the protocol blocks live.
 *
 * Reported 2026-09-08 by a Cursor teammate reading this source from inside
 * Locust: every teammate block -- share, memory, ask, room task -- is taught to
 * sit at the end of the reply ("end your reply with exactly this block and
 * nothing after it"), and the cap kept the head. A long answer therefore had
 * its block cut off here, and the run posted nothing to the workroom while the
 * thread showed a complete, healthy turn.
 */
const SHARE = '<locust-share to="Gem">Watch the to= attribute.</locust-share>';

describe("bounding a very long message", () => {
  it("leaves a message under the cap exactly as it is", () => {
    expect(boundedMessageText("short")).toBe("short");
    const exact = "x".repeat(16_384);
    expect(boundedMessageText(exact)).toBe(exact);
  });

  it("KEEPS a trailing protocol block on an answer far over the cap", () => {
    // THE test. This is the one that was failing in production.
    const long = `${"x".repeat(80_000)}
${SHARE}`;
    const bounded = boundedMessageText(long);
    expect(bounded).toContain(SHARE);
  });

  it("keeps the beginning too, so the answer still reads as an answer", () => {
    const long = `The short version is yes.${"x".repeat(80_000)}
${SHARE}`;
    const bounded = boundedMessageText(long);
    expect(bounded.startsWith("The short version is yes.")).toBe(true);
    expect(bounded).toContain(SHARE);
  });

  it("says where it cut, rather than splicing two halves silently", () => {
    const bounded = boundedMessageText("x".repeat(80_000));
    expect(bounded).toMatch(/truncated/);
  });

  it("still respects the ledger cap it exists to enforce", () => {
    // The control. A function that simply stopped truncating would pass every
    // test above and break the thing this cap is for.
    for (const size of [16_385, 40_000, 500_000]) {
      expect(boundedMessageText("x".repeat(size)).length).toBeLessThanOrEqual(16_384);
    }
  });
});
