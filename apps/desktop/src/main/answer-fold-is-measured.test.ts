import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * A long answer folds by RENDERED LINES, not by newlines.
 *
 * Found by the design agent hours after I shipped it, and my own fixture is
 * what hid it. The first version split the answer on newlines: a
 * three-paragraph prose reply has TWO newlines, so `3 <= 12` and it rendered
 * whole — seventeen or more rendered lines of it. The test I wrote used 40
 * newlines, which is the counting workload from the cap probe, and the one
 * shape that folds perfectly. **Every real answer is the case that did not
 * fold.**
 *
 * Their words: "Bound the height instead — line-clamp or max-height of 12
 * line boxes, with scrollHeight > clientHeight deciding whether the control
 * draws at all."
 *
 * So the clamp is CSS, because rendered line boxes are the only number that
 * was ever meant and only the browser knows it. The stylesheet is now the
 * single place the twelve lives — a second copy in TypeScript that nothing
 * read would have been drift waiting to happen — which is why this test is
 * here rather than beside the component.
 *
 * The label lost its count with the newline split. "28 more lines" is a
 * number worth defending, and it was only ever knowable in the case that
 * needed folding least.
 */

const CSS = readFileSync(fileURLToPath(new URL('../renderer/src/shell.css', import.meta.url)), 'utf8')
const COMPONENT = readFileSync(
  fileURLToPath(new URL('../renderer/src/components/RoomScreen.tsx', import.meta.url)),
  'utf8'
)

describe('the fold on a room answer', () => {
  it('is bounded by rendered lines', () => {
    const clamp = /\.lc-roomanswer__text\.is-folded\s*\{[^}]*-webkit-line-clamp:\s*(\d+)/.exec(CSS)
    expect(clamp, 'the fold is no longer bounded by rendered lines').not.toBeNull()
    // Twelve, and it should not shrink: eight answers at any readable height
    // already exceed a 700px scroll area, so a smaller fold costs the preview
    // and buys nothing.
    expect(Number(clamp?.[1])).toBe(12)
  })

  it('never counts newlines again', () => {
    /*
     * THE regression, named as the shape rather than the symptom. Splitting
     * the text is how the wrong number gets computed, and it looks perfectly
     * reasonable in a diff.
     */
    expect(COMPONENT, 'the fold is counting newlines again').not.toMatch(/text\.split\(/)
  })

  it('draws the control only when the text actually overflows', () => {
    // Measured against the element, not guessed from the string. Without
    // this the control appears on answers that fit, which is the same defect
    // pointing the other way.
    expect(COMPONENT).toContain('scrollHeight')
    expect(COMPONENT).toContain('clientHeight')
    expect(COMPONENT).toContain('Show the rest')
  })
})
