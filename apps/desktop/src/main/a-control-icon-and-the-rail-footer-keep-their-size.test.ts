import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * TWO THINGS SEEN ON THE PACKAGED 0.482, BY LOOKING. The folder chip's icon
 * was squeezed to a few pixels in a tight chat box row; and in the 63px rail
 * Missions, Rooms and Routines were three 12px icons in one row, with Settings
 * alone at the left edge under them. Read from the stylesheet (a renderer
 * test's CSS import is empty).
 */
const shell = readFileSync(join(__dirname, '..', 'renderer', 'src', 'shell.css'), 'utf8')
const block = (selector: string): string => {
  const at = shell.indexOf(`\n${selector} {`)
  expect(at, selector).toBeGreaterThanOrEqual(0)
  return shell.slice(at, shell.indexOf('}', at))
}

describe('what keeps its size', () => {
  it('an icon in a control does not shrink; its words give way', () => {
    expect(block('.lc-control > svg')).toMatch(/flex:\s*none/)
  })

  it('the chat box grows with what is in it, to its most, then scrolls (0.484)', () => {
    const box = block('.lc-composer textarea')
    expect(box).toMatch(/field-sizing:\s*content/)
    expect(box).toMatch(/max-height:\s*180px/)
  })

  it('the rail stacks its footer, one centred row each', () => {
    expect(block('.lc-shell.is-compact .lc-sidebar__nav')).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\)/)
  })
})
