import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * Nothing in the composer's control row may paint outside its own box.
 *
 * Colin, 2026-09-14, looking at a live window: *"text bleeding off model
 * picker"*. Measured in the DOM at two window sizes, with the row in the
 * state that actually breaks — a conversation that has a cost in it:
 *
 * | width | before | after |
 * | --- | --- | --- |
 * | 1477 | `effort · fixed` and the swarm mark OVERLAP by 44px | clear by 19px |
 * | 1120 | OVERLAP by 83px | clear by 19px |
 *
 * Two causes, and I owned one of them. The row is capped at 760px and does
 * not wrap, on a documented measurement from 2026-09-06 (about 808px of
 * controls into 760); `min-width: 0` is what lets the folder and model names
 * truncate. But it applies to EVERY child, so a box with no truncation of
 * its own shrinks below its text and the text paints over its neighbour.
 * Only the two names are meant to give.
 *
 * The other cause was mine: 0.123.0 put the conversation's running total
 * into that row, which was already at capacity. The design ruling had sent
 * it to the context ring; only Claude Code reports a context window, so I
 * added a text fallback for every other runtime — into the one row in the
 * app documented as having no space. It is withdrawn, and where a
 * conversation-scoped number lives on a runtime with no ring is back with
 * the design pass rather than answered by me in the tightest row available.
 *
 * FIRST CONTROL I GOT WRONG, worth recording: I checked for the overlap in a
 * profile with no missions. No missions means no cost, no cost means the
 * token was not rendered, and the DOM said "no overlap" — of a premise that
 * was not the reported one. Colin's screenshot was the correction.
 */

const CSS = readFileSync(fileURLToPath(new URL('../renderer/src/shell.css', import.meta.url)), 'utf8')
const COMPOSER = readFileSync(
  fileURLToPath(new URL('../renderer/src/components/Composer.tsx', import.meta.url)),
  'utf8'
)

const block = (selector: string): string => {
  const at = CSS.indexOf(selector)
  expect(at, `${selector} should exist`).toBeGreaterThan(-1)
  return CSS.slice(at, CSS.indexOf('}', at))
}

describe('the composer control row', () => {
  it('keeps the static effort label at its own size', () => {
    expect(block('.lc-control__effort {')).toContain('flex: none')
  })

  it('keeps every static chip at its own size', () => {
    // `is-static` is the label species: something that states a fact and
    // cannot be pressed. There is nothing in it to truncate, so it must not
    // be asked to.
    expect(block('.lc-control.is-static {')).toContain('flex: none')
  })

  it('still lets the two names that CAN truncate do so', () => {
    // The fix must not become "nothing shrinks", or the row wraps and the
    // bar reads as broken — which is the defect the no-wrap rule prevents.
    expect(block('.lc-composer__group {')).toContain('min-width: 0')
    expect(CSS).toContain('.lc-control__model')
  })

  it('does not carry the conversation total, which put it over capacity', () => {
    expect(COMPOSER).not.toContain('ConversationSpend')
    expect(CSS).not.toContain('lc-composer__spend')
  })

  it('keeps the row from wrapping, which is deliberate and measured', () => {
    expect(block('.lc-composer__controls {')).not.toContain('flex-wrap: wrap')
  })
})
