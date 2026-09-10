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
    if (!inFence && line.trim().length === 0) lastBoundary = index
  }
  // An open fence is never split. Everything from its opener onward is tail,
  // however many blank lines it holds.
  const cut = inFence ? fenceOpenedAt : lastBoundary
  if (cut <= 0) return { settled: '', tail: normalised }
  return {
    settled: lines.slice(0, cut).join('\n'),
    tail: lines.slice(cut).join('\n')
  }
}
