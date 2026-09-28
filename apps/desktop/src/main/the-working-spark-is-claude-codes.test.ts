import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * THE WORKING SPARK (0.392): a running conversation's mark in the sidebar is
 * Claude Code's own spinner.
 *
 * Colin, 2026-09-27: "you got any better ideas for a 'working/busy' icon for
 * sidebar, i think the one i suggested is getting outdated". Six options
 * were drawn side by side; this one shipped. It is pure CSS -- the frames are
 * a pseudo-element's `content` -- so these read the stylesheet (renderer
 * tests cannot: a `?raw` CSS import is empty there).
 */
const SRC = fileURLToPath(new URL('../renderer/src/', import.meta.url))
const css = readFileSync(`${SRC}shell.css`, 'utf8')
const tokens = readFileSync(`${SRC}tokens.css`, 'utf8')
const rule = (selector: string): string => {
  const at = css.indexOf(`${selector} {`)
  return at < 0 ? '' : css.slice(at, css.indexOf('\n}', at) + 2)
}
const keyframes = css.slice(css.indexOf('@keyframes lc-spark {'), css.indexOf('\n}', css.indexOf('@keyframes lc-spark {')) + 2)
const frames = [...keyframes.matchAll(/(\d+(?:\.\d+)?)% \{ content: '([^']*)'; \}/g)].map((match) => [Number(match[1]), match[2]] as const)
const glyph = (escaped: string): string => escaped.replace(/\\([0-9A-Fa-f]{4})/g, (_whole, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))

describe('the working spark', () => {
  it("turns through Claude Code's glyphs and back, one every 120 ms", () => {
    const shown = frames.map(([, content]) => glyph(content).replace('︎', ''))
    expect(shown).toEqual(['·', '✢', '✳', '✶', '✻', '✽', '✽', '✻', '✶', '✳', '✢', '·', '·'])
    // Twelve slots, evenly: 1.44 s is 12 x 120 ms.
    expect(frames.map(([at]) => Math.round(at * 12 / 100))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    expect(rule('.lc-spark::before')).toContain('animation: lc-spark 1.44s steps(1, end) infinite;')
  })

  it('asks for the text form of every dingbat, or Windows draws ✳ as an emoji', () => {
    for (const [, content] of frames) {
      if (content === '\\00B7') continue
      expect(content, content).toMatch(/\\FE0E$/)
    }
    expect(rule('.lc-spark::before')).toContain("content: '\\273B\\FE0E';")
  })

  it("is monochrome, from a symbol face named ahead of any emoji face", () => {
    // Colin, 2026-09-28: lime was the one green thing in the sidebar (0.429).
    const before = rule('.lc-spark::before')
    expect(before).toContain('color: var(--lc-text-primary);')
    expect(before).not.toContain('lime')
    expect(before).toContain('font-family: var(--lc-font-symbol);')
    expect(tokens).toMatch(/--lc-font-symbol: 'Segoe UI Symbol', 'Apple Symbols'/)
  })

  it("keeps the finished dot's footprint, so a run starting never moves the row", () => {
    const box = rule('.lc-spark')
    expect(box).toContain('width: 6px;')
    expect(box).toContain('height: 6px;')
    expect(box).toContain('overflow: visible;')
  })

  it('stands still for a person who asked for less motion', () => {
    const still = css.slice(css.indexOf('/* Still, for a person who asked for less motion: the spark at rest. */'))
    expect(still.slice(0, 200)).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.lc-spark::before \{\s*animation: none;/)
  })
})
