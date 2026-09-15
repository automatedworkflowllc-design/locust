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

describe('the conversation row reserves room for its menu', () => {
  /*
   * `.lc-teammate__missionmenu` is absolutely positioned at `right: 4px` and
   * invisible until the row is hovered, so the row's own content ran all the
   * way underneath it — and the turn count, being last in the row, sat
   * exactly where the `...` lands. Colin twice: the count "blending with the
   * dots", then "that random 15 is still hovering near the triple dots".
   *
   * The first attempt added a gap to the count, which treated the symptom.
   * The cause is that a control which is always present and usually
   * invisible had no space reserved for it at all.
   *
   * Asserted as arithmetic because it IS arithmetic: whatever the row ends
   * with must stop before the menu begins.
   */
  /*
   * Built with `String.raw`, because a plain template literal eats the
   * backslash: `\s` becomes the letter s and the pattern quietly stops
   * matching. That is the same trap `embedded-scripts-parse` guards the
   * harnesses against, and it bit here on the first try.
   */
  const px = (block: string, property: string): number => {
    const match = new RegExp(String.raw`${property}:\s*([0-9]+)px`).exec(block)
    expect(match, `${property} should be a px value`).not.toBeNull()
    return Number(match?.[1])
  }

  it('ends its content before the menu starts', () => {
    const menu = block('.lc-teammate__missionmenu {')
    /*
     * Anchored at the start of a line, because `.lc-teammate__mission {`
     * also occurs INSIDE `.lc-teammate__missionrow > .lc-teammate__mission {`
     * a few rules earlier -- a block with no padding in it at all. A guard
     * that reads the wrong rule fails for a reason that has nothing to do
     * with the thing it is guarding.
     */
    const row = block(String.fromCharCode(10) + '.lc-teammate__mission {')
    const menuFootprint = px(menu, 'right') + px(menu, 'width')

    // `padding: 5px 32px 5px var(--lc-space-4)` — the right value is the one
    // holding the menu's space open.
    const padding = /padding:\s*[^;]*?\s(\d+)px\s/.exec(row)
    expect(padding, 'the row should reserve a right padding').not.toBeNull()
    expect(Number(padding?.[1])).toBeGreaterThanOrEqual(menuFootprint)
  })

  it('does not hide the count to solve it', () => {
    // A count that disappears on hover would be the row answering a layout
    // question by withholding information.
    expect(CSS).not.toContain('.lc-teammate__missionrow:hover .lc-teammate__turns')
  })
})
