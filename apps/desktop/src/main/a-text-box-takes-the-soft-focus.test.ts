import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

/**
 * A TEXT BOX TAKES THE SOFT FOCUS, NEVER THE LIME RING (0.369).
 *
 * tokens.css rings every `input:focus-visible` in lime for the keyboard, and
 * `input:focus-visible` outranks `.lc-input`'s own `outline: none`. A text box
 * counts as focus-visible on a click as well, and the New teammate dialog
 * focuses its name box as it opens -- so it opened with a lime ring, where the
 * design gives a box you type in the soft treatment: the edge and the glow,
 * no hue (the 0.368 sweep's new-teammate-fit frames).
 */
const css = readFileSync(new URL('../renderer/src/shell.css', import.meta.url), 'utf8')
// Found without writing a brace here (the check that every test asserts
// something reads test bodies by their braces).
const CLOSE = String.fromCharCode(125)
const at = css.indexOf('\n.lc-input:focus-visible ')
const rule = at < 0 ? '' : css.slice(at, css.indexOf(CLOSE, at))

describe('a text box, focused', () => {
  it('takes the edge and the glow, and puts the lime ring out', () => {
    expect(rule).toContain('outline: none;')
    expect(rule).toContain('border-color: var(--lc-focus-edge);')
    expect(rule).toContain('box-shadow: 0 0 0 3px var(--lc-focus-glow);')
    expect(rule).not.toContain('--lc-focus-ring')
  })
})
