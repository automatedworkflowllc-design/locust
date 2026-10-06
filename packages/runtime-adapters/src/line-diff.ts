/**
 * A unified diff from a file's text before and after (0.377, the ACP route).
 *
 * The Agent Client Protocol reports an edit as `{ path, oldText, newText }`
 * rather than as a patch, and a row that says only "changed app.ts" is the
 * receipt this app stopped accepting long ago (ToolPatch in codex-events.ts).
 * So the change is worked out here: the common start and end are set aside,
 * the lines between are compared exactly (longest common subsequence), and
 * the result is written as ordinary hunks with three lines of context -- the
 * text `toolPatchFrom` already reads.
 *
 * Exact up to a bound. Past MAX_COMPARED lines on either side of the changed
 * middle, that middle is written as removed-then-added: still true about what
 * the file became, only less tidy about which lines stayed.
 */

const CONTEXT = 3;
const MAX_COMPARED = 1_500;

type Op = { readonly kind: "same" | "del" | "add"; readonly text: string };

function linesOf(text: string): string[] {
  if (text.length === 0) return [];
  const lines = text.split("\n");
  // A trailing newline splits into a final empty piece that is not a line.
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** The middle, compared exactly: a longest common subsequence, walked back into operations. */
function compare(before: readonly string[], after: readonly string[]): Op[] {
  if (before.length > MAX_COMPARED || after.length > MAX_COMPARED) {
    return [...before.map((text) => ({ kind: "del" as const, text })), ...after.map((text) => ({ kind: "add" as const, text }))];
  }
  const rows = before.length + 1;
  const cols = after.length + 1;
  const table = new Uint32Array(rows * cols);
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      table[i * cols + j] = before[i] === after[j]
        ? table[(i + 1) * cols + j + 1]! + 1
        : Math.max(table[(i + 1) * cols + j]!, table[i * cols + j + 1]!);
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) {
      ops.push({ kind: "same", text: before[i]! });
      i += 1;
      j += 1;
    } else if (table[(i + 1) * cols + j]! >= table[i * cols + j + 1]!) {
      ops.push({ kind: "del", text: before[i]! });
      i += 1;
    } else {
      ops.push({ kind: "add", text: after[j]! });
      j += 1;
    }
  }
  while (i < before.length) ops.push({ kind: "del", text: before[i++]! });
  while (j < after.length) ops.push({ kind: "add", text: after[j++]! });
  return ops;
}

/**
 * The diff, as `--- a/path` / `+++ b/path` and hunks, or nothing when the
 * text did not change. `oldText` undefined or null means the file is new.
 */
export function unifiedDiffOf(path: string, oldText: string | null | undefined, newText: string): string | undefined {
  const before = linesOf(oldText ?? "");
  const after = linesOf(newText);
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start += 1;
  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore -= 1;
    endAfter -= 1;
  }
  if (start === endBefore && start === endAfter) return undefined;

  const ops: Op[] = [
    ...before.slice(0, start).map((text) => ({ kind: "same" as const, text })),
    ...compare(before.slice(start, endBefore), after.slice(start, endAfter)),
    ...before.slice(endBefore).map((text) => ({ kind: "same" as const, text })),
  ];

  // Hunks: each changed run with CONTEXT unchanged lines either side, runs
  // closer than twice the context joined into one.
  const hunks: string[] = [];
  let index = 0;
  let oldLine = 1;
  let newLine = 1;
  const positions = ops.map((op) => {
    const at = { old: oldLine, new: newLine };
    if (op.kind !== "add") oldLine += 1;
    if (op.kind !== "del") newLine += 1;
    return at;
  });
  while (index < ops.length) {
    if (ops[index]!.kind === "same") {
      index += 1;
      continue;
    }
    let first = Math.max(0, index - CONTEXT);
    let last = index;
    // Extend while another change starts within the context window.
    for (let probe = index; probe < ops.length; probe += 1) {
      if (ops[probe]!.kind !== "same") last = probe;
      else if (probe - last > CONTEXT * 2) break;
    }
    const end = Math.min(ops.length - 1, last + CONTEXT);
    const slice = ops.slice(first, end + 1);
    const oldCount = slice.filter((op) => op.kind !== "add").length;
    const newCount = slice.filter((op) => op.kind !== "del").length;
    const oldStart = oldCount === 0 ? positions[first]!.old - 1 : positions[first]!.old;
    const newStart = newCount === 0 ? positions[first]!.new - 1 : positions[first]!.new;
    hunks.push(`@@ -${String(oldStart)},${String(oldCount)} +${String(newStart)},${String(newCount)} @@`);
    for (const op of slice) hunks.push(`${op.kind === "same" ? " " : op.kind === "del" ? "-" : "+"}${op.text}`);
    index = end + 1;
    first = index;
  }
  const from = oldText === undefined || oldText === null ? "/dev/null" : side("a/", path);
  return [`--- ${from}`, `+++ ${side("b/", path)}`, ...hunks].join("\n") + "\n";
}

/**
 * Git's `a/` and `b/` go in front of a path relative to the repository. ACP
 * names files by absolute path, and one is written as it is -- which is also
 * what lets an approval card show it relative to the folder.
 */
const ABSOLUTE = /^(?:[A-Za-z]:[\\/]|[\\/])/;
function side(prefix: string, path: string): string {
  return ABSOLUTE.test(path) ? path : `${prefix}${path}`;
}

/** One hunk as Claude Code reports it in an edit's `structuredPatch`. */
export type ReportedHunk = { readonly oldStart: number; readonly oldLines: number; readonly newStart: number; readonly newLines: number; readonly lines: readonly string[] };

/**
 * A unified diff from hunks a runtime already worked out (0.672, Claude
 * Code). Its Edit reports `structuredPatch` -- the hunks with their line
 * numbers and their ` `/`-`/`+` lines -- so nothing is compared again here;
 * the hunks are only written out under the same headers `unifiedDiffOf` uses.
 */
export function unifiedDiffFromHunks(path: string, hunks: readonly ReportedHunk[]): string | undefined {
  if (hunks.length === 0) return undefined;
  const body = hunks.flatMap((hunk) => [`@@ -${String(hunk.oldStart)},${String(hunk.oldLines)} +${String(hunk.newStart)},${String(hunk.newLines)} @@`, ...hunk.lines]);
  return [`--- ${side("a/", path)}`, `+++ ${side("b/", path)}`, ...body].join("\n") + "\n";
}
