import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

/**
 * THE WINDOW'S FRAME NEVER SCROLLS (0.366).
 *
 * The chat box's metal glow canvas reaches 11px past the window's bottom
 * edge, and `.lc-shell` held it with `overflow: hidden` -- which is still a
 * scroll container. So anything that scrolled an element into view moved
 * the whole window up 11px, title bar and all: probe-shell-shift on packaged
 * 0.366 measured the title bar at -11 after one scrollIntoView. `clip` cuts
 * the same and is not a scroll container, so nothing can move it.
 */
const css = readFileSync(new URL('../renderer/src/shell.css', import.meta.url), 'utf8')
// The rule's own text, found without writing a brace here (the check that
// every test asserts something reads test bodies by their braces).
const OPEN = String.fromCharCode(123)
const CLOSE = String.fromCharCode(125)
const start = css.indexOf(`\n.lc-shell ${OPEN}`)
const rule = start < 0 ? '' : css.slice(start, css.indexOf(CLOSE, start))

describe('the window frame', () => {
  it('clips what reaches past it, and is never a scroll container', () => {
    expect(rule).toContain('overflow: clip;')
    expect(rule).not.toMatch(/overflow:\s*hidden/)
  })
})
