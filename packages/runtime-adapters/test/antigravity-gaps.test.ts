import { describe, expect, it } from "vitest";

import { antigravityMessageStep, hasAntigravityGap, restoreTruncated, withRestoredGaps } from "../src/antigravity-events.js";
import type { NormalizedRuntimeEvent } from "../src/types.js";

/*
 * ANTIGRAVITY'S GAPS, FILLED FROM ITS OWN SERVER (0.389).
 *
 * Colin, 2026-09-27, over a Chief of Staff answer on Antigravity's Flash cut
 * at "forced-colors: acti" / "1066 bytes the runtime did not keep" /
 * "/kill-switch recommendations": "slight bug". The transcript Antigravity
 * writes drops the middle of a long record; its server keeps the step whole.
 */
const BEFORE = "3. Accessibility & Engine Core: Implements Windows High Contrast mode (`forced-colors: acti";
const MISSING = "ve`) across the shell, and keeps the kill-switch ready for the fall review. The team also owns the";
const AFTER = "/kill-switch recommendations due 2026-11-16 and municipal AI hearing developments.";
const WHOLE = `${BEFORE}${MISSING}${AFTER}`;
const GAPPED = `${BEFORE}\n<truncated 1066 bytes>\n${AFTER}`;

describe("a gap restored", () => {
  it("comes back whole from the step that holds it", () => {
    expect(restoreTruncated(GAPPED, ["An unrelated answer.", WHOLE])).toBe(WHOLE);
  });

  it("is never filled from a different step: the words on both sides must be that step's", () => {
    expect(restoreTruncated(GAPPED, [`${BEFORE} something else entirely.`])).toBeUndefined();
    expect(restoreTruncated(GAPPED, [`Something else. ${AFTER}`])).toBeUndefined();
    // Long enough to hold both ends, starting right -- and ending elsewhere.
    expect(restoreTruncated(GAPPED, [`${BEFORE}${MISSING}${MISSING}${MISSING}${MISSING}`])).toBeUndefined();
    // A candidate that is itself cut short fills nothing.
    expect(restoreTruncated(GAPPED, [`${BEFORE}\n<truncated 12 bytes>\n${AFTER}`])).toBeUndefined();
  });

  it("holds every piece between two gaps, in order", () => {
    const twice = `start ${MISSING} middle ${MISSING} end`;
    expect(restoreTruncated("start \n<truncated 90 bytes>\n middle \n<truncated 90 bytes>\n end", [twice])).toBe(twice);
    expect(restoreTruncated("start \n<truncated 90 bytes>\n elsewhere \n<truncated 90 bytes>\n end", [twice])).toBeUndefined();
  });

  it("leaves a text with no gap alone", () => {
    expect(restoreTruncated("no gap here", [WHOLE])).toBeUndefined();
  });
});

const delta = (text: string, itemId = "msg_12"): NormalizedRuntimeEvent =>
  ({
    schemaVersion: 1,
    eventId: "e1",
    runId: "run_1",
    missionId: "m1",
    sequence: 5,
    occurredAt: "2026-09-27T05:00:00.000Z",
    sourceAdapter: "antigravity",
    type: "message.delta",
    payload: { itemId, operation: "replace", text, final: true, evidence: { recordType: "PLANNER_RESPONSE" } },
  }) as unknown as NormalizedRuntimeEvent;

describe("the events a run records", () => {
  it("carry the whole answer where the server had it, and everything else as it came", () => {
    const other = delta("A short, whole answer.", "msg_3");
    const [restored, kept] = withRestoredGaps([delta(GAPPED), other], [WHOLE]);
    expect(restored?.type === "message.delta" && restored.payload.text).toBe(WHOLE);
    // Only the text changes: its place in the record is the same.
    expect(restored?.sequence).toBe(5);
    expect(kept).toBe(other);
  });

  it("keep the gap when the server did not have the step", () => {
    const [event] = withRestoredGaps([delta(GAPPED)], ["Nothing like it."]);
    expect(event?.type === "message.delta" && event.payload.text).toBe(GAPPED);
  });

  it("scrub the restored text as every recorded text is scrubbed, matching the scrubbed transcript", () => {
    const key = "sk-ant-api03-abcdefghijklmnop1234";
    const whole = `Set the key: ${key}. ${MISSING}${AFTER}`;
    const gapped = `Set the key: [redacted]. \n<truncated 40 bytes>\n${AFTER}`;
    const [event] = withRestoredGaps([delta(gapped)], [whole]);
    const text = event?.type === "message.delta" ? event.payload.text : "";
    expect(text).not.toContain(key);
    expect(text).toContain(MISSING);
  });

  it("know a gap when they see one, and the step a message came from", () => {
    expect(hasAntigravityGap(delta(GAPPED))).toBe(true);
    expect(hasAntigravityGap(delta("whole"))).toBe(false);
    expect(antigravityMessageStep("msg_12")).toBe(12);
    expect(antigravityMessageStep("m1")).toBeUndefined();
  });
});
