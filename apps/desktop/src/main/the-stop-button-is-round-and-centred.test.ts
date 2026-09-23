import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * THE STOP BUTTON IS LIBRARIES.DEV'S ROUND ICON BUTTON, AND EVERY GLYPH SITS
 * ON WHOLE PIXELS.
 *
 * Colin, 2026-09-23, with a frame of the beam page's round button: "use this
 * exact same design just ignore the rainbow hue and just slightly raise the
 * intensity for the current mono beam", and "all the buttons are kind off
 * center, send, stop, and the +". Measured (drive-composer-buttons): the row
 * sits at fractional pixels, so an odd glyph in an even box (the 15px arrow,
 * the 9px square, both in 28px) was drawn half a pixel right and down; the
 * 14px + in its 26px box was already true. And the beam's travelling light
 * (drive-stop-beam-frames) peaked at 35 of 255 against the background.
 */
const read = (path: string): string => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const shell = read('../renderer/src/shell.css')
const composer = read('../renderer/src/components/Composer.tsx')
const rule = (selector: string): string => {
  const start = shell.indexOf(`${selector} {`)
  return start < 0 ? '' : shell.slice(start, shell.indexOf('}', start))
}
const px = (text: string, property: string): number => Number(new RegExp(`${property}:\\s*(\\d+(?:\\.\\d+)?)px`).exec(text)?.[1] ?? NaN)

describe('the stop button', () => {
  it('is a disc with no border, its ring and glow drawn inside the edge', () => {
    const stop = rule('.lc-send.is-stop')
    expect(stop).toContain('border: 0')
    expect(stop).toContain('border-radius: 999px')
    expect(stop).toContain('inset 0 0 0 1px')
    expect(stop).toContain('var(--lc-stop-glow)')
  })

  it("holds libraries.dev's square, scaled to this slot -- 12 of 36 is 10 of 30", () => {
    const square = rule('.lc-stopsquare')
    expect(px(square, 'width')).toBe(10)
    expect(px(square, 'height')).toBe(10)
    expect(px(square, 'border-radius')).toBe(2)
  })

  it('wears a beam lifted past the package mono, by its own per-layer hooks', () => {
    const beam = rule('.lc-stopbeam')
    for (const layer of ['stroke', 'inner', 'bloom']) {
      const lift = Number(new RegExp(`--beam-${layer}-opacity:\\s*(\\d+(?:\\.\\d+)?)`).exec(beam)?.[1] ?? NaN)
      expect(lift, layer).toBeGreaterThan(1)
    }
    expect(composer).toMatch(/<Beam size="sm" strength=\{1\}[^>]*className="lc-stopbeam">/)
  })
})

describe('every round button glyph', () => {
  const send = rule('.lc-send')
  const box = px(send, 'width')
  const border = Number(/border:\s*(\d+)px solid/.exec(send)?.[1] ?? NaN)

  it('is even in an even box, so it lands on whole pixels wherever the row does', () => {
    expect(box).toBe(30)
    // Send: the arrow inside the 1px border.
    for (const size of [...composer.matchAll(/<Icon name="arrow-up" size=\{(\d+)\} \/>/g)].map((match) => Number(match[1]))) {
      expect((box - 2 * border - size) % 2, `arrow ${String(size)}`).toBe(0)
    }
    // Stop: the square inside a borderless disc.
    expect((box - px(rule('.lc-stopsquare'), 'width')) % 2).toBe(0)
    // Attach: its 14px + in the 28px control with a 1px border.
    expect(composer).toContain('<Icon name="plus" size={14} />')
  })
})
