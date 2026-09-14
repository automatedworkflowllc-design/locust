import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * The boot screen's stylesheet, and the three ways it is known to go wrong.
 *
 * Lives beside the main-process guards rather than the renderer ones only
 * because reading a file needs node types, and the renderer config has none.
 * What it asserts is entirely about the screen.
 */

const CSS = readFileSync(fileURLToPath(new URL('../renderer/src/shell.css', import.meta.url)), 'utf8')
const block = (selector: string): string => {
  const index = CSS.indexOf(selector)
  expect(index, `${selector} should exist`).toBeGreaterThan(-1)
  return CSS.slice(index, CSS.indexOf('}', index))
}

describe('the two ways the reference got this wrong', () => {
  it('gives every row flex: none, so max-height is not overruled by flex-shrink', () => {
    /*
     * Learned the hard way in the reference: the rows are flex items in a
     * column container, so when the log overflowed the browser redistributed
     * height -- collapsed rows kept their 19px while a LIVE row was squashed
     * to zero, and the settle left the preamble on screen.
     *
     * Rows collapse because they are told to, never because space ran out.
     */
    expect(block('.lc-boot__pre,')).toContain('flex: none')
    for (const row of ['.lc-boot__pre', '.lc-boot__row', '.lc-boot__caret', '.lc-boot__summary']) {
      expect(CSS.slice(CSS.indexOf('.lc-boot__pre,'), CSS.indexOf('.lc-boot__pre {'))).toContain(row)
    }
  })

  it('scrolls the terminal and does not clip it', () => {
    // Clipping hides the newest line, which on a boot log is the only one
    // anybody is waiting for.
    const terminal = block('.lc-boot__terminal {')
    expect(terminal).toContain('overflow-y: auto')
    expect(terminal).not.toContain('overflow: hidden')
  })

  it('centres the settled table rather than leaving it hanging from the top', () => {
    expect(block('.lc-boot__terminal.is-settled {')).toContain('justify-content: center')
  })
})

describe('the ways this goes wrong', () => {
  it('stops every infinite animation when the screen dissolves', () => {
    // An infinite animation on a screen that has gone is a background
    // repaint that costs battery for nothing.
    const stopped = CSS.slice(CSS.indexOf('.lc-boot.is-dissolving .lc-boot__screen,'))
    expect(stopped.slice(0, 300)).toContain('animation: none')
  })

  it('makes reduced motion instant, not absent', () => {
    /*
     * The end state is information -- what is installed, and what needs you.
     * A person with vestibular sensitivity still needs to know it. So the
     * flicker, sweep and pulse go and the phase change stays.
     */
    const reduced = CSS.slice(CSS.indexOf('@media (prefers-reduced-motion: reduce)', CSS.indexOf('.lc-boot {')))
    expect(reduced).toContain('.lc-boot__screen')
    expect(reduced).toContain('animation: none')
    expect(reduced).toContain('transition: none')
    // And it must not simply hide the screen.
    expect(reduced.slice(0, 900)).not.toContain('display: none')
  })

  it('does not let an absence shine', () => {
    expect(block('.lc-boot__row.is-missing .lc-boot__dot {')).toContain('box-shadow: none')
  })
})
