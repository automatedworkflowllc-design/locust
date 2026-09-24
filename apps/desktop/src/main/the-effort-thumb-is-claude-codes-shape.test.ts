import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * THE EFFORT THUMB IS CLAUDE CODE'S SHAPE -- the half of
 * `the-effort-control-is-claude-codes.test.tsx` that markup cannot show.
 *
 * Colin, 2026-09-24, with frames of ours at Medium and Claude Code's at Max:
 * "our white ball/square is off and not quite right, cc for reference".
 * Measured off the two frames, at one scale: Claude Code's thumb is a pure
 * white rounded rectangle, 16 x 20 with 4px corners, the full height of a
 * 20px track, on a fill at luminance 125; ours was a ball about 10px across
 * -- the liquid's blob under a 6px goo blur -- on a fill at 68.
 */
const read = (name: string): string => readFileSync(fileURLToPath(new URL(`../renderer/src/${name}`, import.meta.url)), 'utf8')
const shell = read('shell.css')
const tokens = read('tokens.css')
const rule = (selector: string): string => {
  const start = shell.indexOf(`${selector} {`)
  return start < 0 ? '' : shell.slice(start, shell.indexOf('}', start))
}
const px = (block: string, property: string): number => {
  const found = new RegExp(`(?:^|[\\s;{])${property}:\\s*(\\d+(?:\\.\\d+)?)px`).exec(block)
  return found === null ? Number.NaN : Number(found[1])
}
const token = (name: string): string => new RegExp(`${name}:\\s*([^;]+);`).exec(tokens)?.[1]?.trim() ?? ''

describe("the effort thumb", () => {
  it("is Claude Code's: a white rounded rectangle, 16 x 20, 4px corners", () => {
    const thumb = rule('.lc-effortpanel__thumb')
    expect(px(thumb, 'width')).toBe(16)
    expect(px(thumb, 'height')).toBe(20)
    expect(px(thumb, 'border-radius')).toBe(4)
    expect(thumb).toContain('background: var(--lc-effort-thumb)')
    expect(token('--lc-effort-thumb')).toBe('#ffffff')
  })

  it("fills the track's height, as Claude Code's does", () => {
    expect(px(rule('.lc-effortpanel__scale'), 'height')).toBe(20)
    expect(px(rule('.lc-effortpanel__thumb'), 'height')).toBe(px(rule('.lc-effortpanel__scale'), 'height'))
  })

  it('covers its liquid at rest: the drop the goo is made from is smaller than the thumb', () => {
    const drop = rule('.lc-effortpanel__drop')
    const thumb = rule('.lc-effortpanel__thumb')
    expect(px(drop, 'width')).toBeLessThan(px(thumb, 'width'))
    expect(px(drop, 'height')).toBeLessThan(px(thumb, 'height'))
    // Centred under it: its top inset is half of what it is shorter by.
    expect(px(drop, 'top')).toBe((px(thumb, 'height') - px(drop, 'height')) / 2)
  })

  it("sits on a fill that shows, as Claude Code's does", () => {
    const alpha = Number(/rgba\(255, 255, 255, ([\d.]+)\)/.exec(token('--lc-effort-fill'))?.[1])
    expect(alpha).toBeGreaterThanOrEqual(0.3)
  })
})
