import { describe, expect, it } from "vitest";

import { parseEffortChoices } from "../src/commands.js";

/*
 * A B4 lead from the code review, settled: Copilot's effort levels never
 * reached the composer. Its 1.0.88 help writes them in square brackets, which
 * the reader did not match, and Copilot's fixed model hints then replaced
 * whatever had been read with none. These are copilot 1.0.88's own lines.
 */
const COPILOT_1_0_88 = [
  "      --reasoning-effort <level>",
  "          Set the reasoning effort level [possible values: none, minimal, low, medium, high, xhigh, max]",
  "      --context <tier>",
].join("\n");

describe("Copilot's effort levels", () => {
  it("are read from its 1.0.88 help", () => {
    expect(parseEffortChoices(COPILOT_1_0_88)).toEqual(["none", "minimal", "low", "medium", "high", "xhigh", "max"]);
  });

  it("are still read from the older parenthesised shape", () => {
    expect(parseEffortChoices('--effort, --reasoning-effort <level>  Set the effort (choices: "low", "high")')).toEqual(["low", "high"]);
  });
});
