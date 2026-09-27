import { describe, expect, it } from "vitest";

import { toolPatchFrom } from "../src/codex-events.js";
import { unifiedDiffOf } from "../src/line-diff.js";

/**
 * A DIFF FROM BEFORE AND AFTER (0.377, the ACP route). ACP reports an edit as
 * old and new text; the row needs a real patch, with counts that match it.
 */
const lines = (count: number, from = 1): string => Array.from({ length: count }, (_, index) => `line ${String(from + index)}`).join("\n") + "\n";

describe("a diff from before and after", () => {
  it("is nothing when nothing changed", () => {
    expect(unifiedDiffOf("a.ts", "x\n", "x\n")).toBeUndefined();
  });

  it("writes one changed line with three lines of context either side", () => {
    const before = lines(10);
    const after = before.replace("line 5\n", "line five\n");
    expect(unifiedDiffOf("src/a.ts", before, after)).toBe(
      ["--- a/src/a.ts", "+++ b/src/a.ts", "@@ -2,7 +2,7 @@", " line 2", " line 3", " line 4", "-line 5", "+line five", " line 6", " line 7", " line 8", ""].join("\n"),
    );
  });

  it("names an absolute path as it is, with no git prefix in front of a drive letter", () => {
    const diff = unifiedDiffOf("C:\\work\\pebble\\app.js", "a\n", "b\n")!;
    expect(diff.split("\n").slice(0, 2)).toEqual(["--- C:\\work\\pebble\\app.js", "+++ C:\\work\\pebble\\app.js"]);
    expect(unifiedDiffOf("/home/p/app.js", "a\n", "b\n")!.split("\n")[1]).toBe("+++ /home/p/app.js");
  });

  it("a new file is all added, from /dev/null", () => {
    expect(unifiedDiffOf("kept.txt", undefined, "kept\n")).toBe(["--- /dev/null", "+++ b/kept.txt", "@@ -0,0 +1,1 @@", "+kept", ""].join("\n"));
  });

  it("keeps two distant changes as two hunks, and the counts are what the text says", () => {
    const before = lines(40);
    const after = before.replace("line 3\n", "line three\n").replace("line 35\n", "line thirty-five\n");
    const diff = unifiedDiffOf("b.ts", before, after)!;
    expect([...diff.matchAll(/^@@/gm)]).toHaveLength(2);
    expect(toolPatchFrom(diff)).toMatchObject({ added: 2, removed: 2, truncated: false });
  });

  it("finds the lines that stayed, not a rewrite of everything between", () => {
    const before = ["a", "b", "c", "d", "e"].join("\n") + "\n";
    const after = ["a", "x", "c", "y", "e"].join("\n") + "\n";
    const patch = toolPatchFrom(unifiedDiffOf("c.ts", before, after)!);
    expect(patch).toMatchObject({ added: 2, removed: 2 });
    expect(unifiedDiffOf("c.ts", before, after)).toContain("\n c\n");
  });

  it("an insertion and a deletion count exactly", () => {
    expect(toolPatchFrom(unifiedDiffOf("d.ts", lines(5), lines(5).replace("line 3\n", "line 3\nextra\n"))!)).toMatchObject({ added: 1, removed: 0 });
    expect(toolPatchFrom(unifiedDiffOf("d.ts", lines(5), lines(5).replace("line 3\n", ""))!)).toMatchObject({ added: 0, removed: 1 });
  });
});
