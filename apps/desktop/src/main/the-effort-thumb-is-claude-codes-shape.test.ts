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

const slider = readFileSync(fileURLToPath(new URL('../renderer/src/components/EffortSlider.tsx', import.meta.url)), 'utf8')

describe("the effort thumb", () => {
  it("is Claude Code's: a white rounded rectangle, 16 x 20, 4px corners -- painted by the liquid", () => {
    const thumb = rule('.lc-effortpanel__thumb')
    expect(px(thumb, 'width')).toBe(16)
    expect(px(thumb, 'height')).toBe(20)
    expect(px(thumb, 'border-radius')).toBe(4)
    // The liquid paints this box, white, from the token; the box itself is not painted.
    expect(slider).toContain("fill: style.getPropertyValue('--lc-effort-thumb')")
    expect(token('--lc-effort-thumb')).toBe('#ffffff')
  })

  it("fills the track's height, as Claude Code's does", () => {
    expect(px(rule('.lc-effortpanel__scale'), 'height')).toBe(20)
    expect(px(rule('.lc-effortpanel__thumb'), 'height')).toBe(px(rule('.lc-effortpanel__scale'), 'height'))
  })

  it('is ONE thing (Colin, 2026-09-26: "a rectangle with no gooey with a gooey circle behind it, we gotta pick one")', () => {
    // No drop under it, and nothing but the liquid paints it: a background
    // or a box-shadow here would be the crisp rectangle over the goo again.
    expect(rule('.lc-effortpanel__drop')).toBe('')
    const thumb = rule('.lc-effortpanel__thumb')
    expect(thumb).not.toMatch(/(?:^|[\s;{])background\s*:/)
    expect(thumb).not.toMatch(/box-shadow\s*:/)
    // Claude Code's soft lift goes with it, onto the liquid.
    expect(slider).toContain("'--lc-effort-thumb-lift'")
  })

  it("sits on a fill that shows, as Claude Code's does", () => {
    const alpha = Number(/rgba\(255, 255, 255, ([\d.]+)\)/.exec(token('--lc-effort-fill'))?.[1])
    expect(alpha).toBeGreaterThanOrEqual(0.3)
  })
})
