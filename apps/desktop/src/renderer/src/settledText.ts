/**
 * What has SETTLED in a streaming reply, and what is still arriving.
 *
 * Colin, 2026-09-10: "the text seems to come out rather aggressively or
 * glitchy." The other half of that -- after cadence -- is reflow. Every
 * delta re-parsed the whole reply, and a delta that completed a Markdown
 * token (the closing `*`, the closing fence) reclassified text already on
 * screen: a sentence a person had read as plain turned bold, a paragraph
 * became a code block. Text changing shape after it was read is the thing
 * that feels glitchy, and nothing about any single frame looks wrong.
 *
 * Claude Code's renderer does not do this: formatting lands when a block
 * closes, and what is above the cursor stays put. So, while streaming, only
 * the settled prefix is parsed as Markdown; the tail is drawn as plain text
 * until it settles. A paragraph is settled at the blank line that ends it. A
 * fence is settled when it closes -- an open fence is never split, because
 * half a code block parsed as prose is the reflow this exists to prevent.
 *
 * The split moves only forward, so nothing settled ever un-settles; and it
 * costs at most one paragraph of un-formatted text at the very end, which is
 * exactly the part that is still being written.
 */

export interface SettledSplit {
  /** Parse this as Markdown. Ends at a paragraph boundary, or is empty. */
  readonly settled: string
  /** Draw this as plain text. May be empty. */
  readonly tail: string
}

const FENCE = /^[ \t]*`{3,}/

// The parser's own line shapes (agentText.ts), for the blocks that settle a line at a time.
const BULLET = /^[ \t]*[-*+][ \t]+\S/
const NUMBERED = /^[ \t]*\d+[.)][ \t]+\S/
const HEADING = /^[ \t]{0,3}#{1,6}[ \t]+\S/
const RULE = /^[ \t]{0,3}(-{3,}|\*{3,}|_{3,})[ \t]*$/
const QUOTE = /^[ \t]{0,3}>/
const TABLE_ROW = /^[ \t]{0,3}\|?[^\n]*\|[^\n]*$/
const TABLE_RULE = /^[ \t]{0,3}\|?[ \t]*:?-+:?[ \t]*(\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/

/**
 * Where the blocks that settle a LINE at a time end, from `start`.
 *
 * Colin, 2026-10-02: a long table "takes a long time to adjust to format
 * because it only formats after the whole block sends" -- a table, a list
 * and a run of headings have no blank line inside them, so the paragraph
 * rule kept a whole report as raw pipes until it ended. Their finished lines
 * never change shape when another line arrives: a row joins the table under
 * it, an item joins the list. So each settles when its line is complete. A
 * table settles from its rule on, never its header alone, because a header
 * row without the rule beneath it is still prose. Only complete lines count
 * (the last element of `lines` is the one still being written), and the end
 * only moves forward as lines arrive. Returns -1 when nothing settles here.
 */
function lineBlocksEnd(lines: readonly string[], start: number): number {
  const complete = lines.length - 1
  let at = Math.max(0, start)
  let end = -1
  while (at < complete) {
    const line = lines[at]!
    if (BULLET.test(line) || NUMBERED.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line)) {
      at += 1
    } else if (TABLE_ROW.test(line) && !TABLE_RULE.test(line)) {
      if (at + 1 >= complete || !TABLE_RULE.test(lines[at + 1]!)) break
      at += 2
      while (at < complete && TABLE_ROW.test(lines[at]!) && !TABLE_RULE.test(lines[at]!)) at += 1
    } else {
      break
    }
    end = at
  }
  return end
}

export function splitSettled(text: string): SettledSplit {
  const normalised = text.replace(/\r\n/g, '\n')
  const lines = normalised.split('\n')
  let inFence = false
  let lastBoundary = -1
  let fenceOpenedAt = -1
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!
    if (FENCE.test(line)) {
      if (inFence) {
        inFence = false
        // The line after a closing fence is a boundary of its own: a fence
        // ends a block whether or not a blank line follows.
        lastBoundary = index + 1
        fenceOpenedAt = -1
      } else {
        inFence = true
        fenceOpenedAt = index
      }
      continue
    }
    // Only a finished line is a boundary: the last one is still being written.
    if (!inFence && line.trim().length === 0 && index < lines.length - 1) lastBoundary = index
  }
  // An open fence is never split. Everything from its opener onward is tail,
  // however many blank lines it holds.
  const cut = inFence ? fenceOpenedAt : Math.max(lastBoundary, lineBlocksEnd(lines, lastBoundary < 0 ? 0 : (lines[lastBoundary] ?? "").trim().length === 0 ? lastBoundary + 1 : lastBoundary))
  if (cut <= 0) return { settled: '', tail: normalised }
  return {
    settled: lines.slice(0, cut).join('\n'),
    tail: lines.slice(cut).join('\n')
  }
}
