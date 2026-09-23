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
 * sat at fractional pixels, so an odd glyph in an even box (a 15px arrow, a
 * 9px square, both in 28px) was drawn half a pixel right and down. And the
 * beam's travelling light (drive-stop-beam-frames) peaked at 35 of 255.
 *
 * Since the metal composer the buttons are the page's sizes -- the send and
 * the stop a 40px disc, the + a 36px circle -- and the rule is the same.
 */
const read = (path: string): string => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const shell = read('../renderer/src/shell.css')
const composer = read('../renderer/src/components/Composer.tsx')
const glyphs = read('../renderer/src/components/ChatGlyphs.tsx')
/** The LAST rule for a selector: the composer's own restyles come last in the file. */
const rule = (selector: string): string => {
  const start = shell.lastIndexOf(`${selector} {`)
  return start < 0 ? '' : shell.slice(start, shell.indexOf('}', start))
}
/** A rule written at the start of a line: the base rule, not a scoped one that ends in it. */
const baseRule = (selector: string): string => {
  const start = shell.indexOf(`\n${selector} {`)
  return start < 0 ? '' : shell.slice(start, shell.indexOf('}', start))
}
const px = (text: string, property: string): number => Number(new RegExp(`${property}:\\s*(\\d+(?:\\.\\d+)?)px`).exec(text)?.[1] ?? NaN)
const glyphSize = (name: string): number => {
  const body = glyphs.slice(glyphs.indexOf(`export function ${name}`))
  return Number(/width="(\d+)"/.exec(body)?.[1] ?? NaN)
}

describe('the stop button', () => {
  it('is a disc with no border, its ring and glow drawn inside the edge', () => {
    const stop = baseRule('.lc-send.is-stop')
    expect(stop).toContain('border: 0')
    expect(stop).toContain('border-radius: 999px')
    expect(stop).toContain('inset 0 0 0 1px')
    expect(stop).toContain('var(--lc-stop-glow)')
  })

  it("holds libraries.dev's square, scaled to the send's seat -- 12 of 36 is about 14 of 40", () => {
    const square = rule('.lc-composer__controls .lc-stopsquare')
    expect(px(square, 'width')).toBe(14)
    expect(px(square, 'height')).toBe(14)
    expect(px(rule('.lc-composer__controls .lc-send'), 'width')).toBe(40)
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
  it('is even in an even box, so it lands on whole pixels wherever the row does', () => {
    // Send: the page's 16px arrow inside the 40px disc's 1px border.
    const send = rule('.lc-composer__controls .lc-send')
    const border = Number(/border:\s*(\d+)px solid/.exec(send)?.[1] ?? NaN)
    expect((px(send, 'width') - 2 * border - glyphSize('ArrowUpGlyph')) % 2).toBe(0)
    expect(composer).toContain('<ArrowUpGlyph />')
    // Stop: the square inside the borderless disc.
    expect((px(send, 'width') - px(rule('.lc-composer__controls .lc-stopsquare'), 'width')) % 2).toBe(0)
    // The +: the page's 16px plus in the gooey menu's 36px button.
    expect((px(rule('.lc-plusmenu__button'), 'width') - glyphSize('PlusGlyph')) % 2).toBe(0)
    expect(read('../renderer/src/components/PlusMenu.tsx')).toContain('<PlusGlyph />')
  })
})
