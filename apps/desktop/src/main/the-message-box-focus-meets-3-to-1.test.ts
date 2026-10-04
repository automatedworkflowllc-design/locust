import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * THE MESSAGE BOX'S FOCUS EDGE MEETS 3:1 (QA-2026-09-29 round 2, R8). It was
 * a 1px white edge at 0.22, about 2:1 against the page. Read from the
 * stylesheets themselves (a renderer test's CSS import is empty), so a later
 * edit to either colour is measured, not remembered.
 */
const renderer = join(__dirname, '..', 'renderer', 'src')
const tokens = readFileSync(join(renderer, 'tokens.css'), 'utf8')
const shell = readFileSync(join(renderer, 'shell.css'), 'utf8')

type Rgb = readonly [number, number, number]
const hex = (token: string): Rgb => {
  const found = new RegExp(`${token}:\\s*#([0-9a-f]{6})`, 'i').exec(tokens)?.[1]
  expect(found, token).toBeDefined()
  return [0, 2, 4].map((at) => parseInt(found!.slice(at, at + 2), 16)) as unknown as Rgb
}
const rgba = (token: string): readonly [number, number, number, number] => {
  const found = new RegExp(`${token}:\\s*rgba\\(([^)]+)\\)`).exec(tokens)?.[1]
  expect(found, token).toBeDefined()
  return found!.split(',').map(Number) as unknown as readonly [number, number, number, number]
}
const over = ([r, g, b, a]: readonly [number, number, number, number], ground: Rgb): Rgb =>
  [r * a + ground[0] * (1 - a), g * a + ground[1] * (1 - a), b * a + ground[2] * (1 - a)]
const luminance = (colour: Rgb): number => {
  const [r, g, b] = colour.map((value) => {
    const v = value / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }) as unknown as Rgb
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a: Rgb, b: Rgb): number => {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (high! + 0.05) / (low! + 0.05)
}

describe('the message box, focused', () => {
  it('draws its edge in the box token', () => {
    const at = shell.indexOf('\n.lc-composer__box:focus-within {')
    expect(at).toBeGreaterThanOrEqual(0)
    expect(shell.slice(at, shell.indexOf('}', at))).toContain('0 0 0 1px var(--lc-focus-edge-box)')
  })

  it('is at least 3:1 against the page and against the box', () => {
    const page = hex('--lc-bg-app')
    const box = over(rgba('--lc-chat-bg'), page)
    const edge = over(rgba('--lc-focus-edge-box'), page)
    expect(contrast(edge, page)).toBeGreaterThanOrEqual(3)
    expect(contrast(edge, box)).toBeGreaterThanOrEqual(3)
  })
})
