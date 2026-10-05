import { describe, expect, it } from 'vitest'

import { FLASH_S, GLYPH_INK, GLYPH_SHAPES, PHOSPHOR, POWER_ON_S, blinkingDot, flashFade, glyphMotion, mixPhosphor, phosphorRgba, powerOnEyes, powerOnLight, withGlyphEyes } from './components/Bot.js'
import type { EyeGlyphs, Phosphor } from './components/Bot.js'

/**
 * A SCREEN SWITCHES ON, AND ITS DOTS BLINK (2026-10-05).
 *
 * Colin: "you can also rework the eyes if you have to, to compensate for the
 * behavior and blinking". A dot is one stroke of no length, so a blink -- which
 * squashes a glyph's places, never its weight -- had nothing to squash, and the
 * thinking dots stared. Now a shutting dot draws out into the screen's own
 * dash. And a screen face's entrance is a CRT's: a line across the glass, a
 * flash that settles, the eyes blinking open (bloub enters with its `swirl`).
 */
describe('a blinking dot', () => {
  it('is the dot open and the screen\'s own dash shut', () => {
    expect(blinkingDot(0).weight).toBe(GLYPH_SHAPES['•']?.weight)
    const [x0, y0, x1, y1] = blinkingDot(0).lines[0] ?? []
    expect(Math.hypot((x1 ?? 0) - (x0 ?? 0), (y1 ?? 0) - (y0 ?? 0))).toBeLessThan(0.05)
    expect(blinkingDot(1)).toEqual({ lines: [[-4.8, 0.4, 4.8, 0.4]], weight: GLYPH_SHAPES['-']?.weight })
    expect(GLYPH_SHAPES['-']?.lines).toEqual(blinkingDot(1).lines)
  })

  it('draws out and lightens steadily as it shuts, never thinner than the dash', () => {
    let lastWeight = Number.POSITIVE_INFINITY
    let lastLength = -1
    for (let c = 0; c <= 1.0001; c += 0.05) {
      const dot = blinkingDot(c)
      const [x0 = 0, , x1 = 0] = dot.lines[0] ?? []
      expect(dot.weight).toBeLessThanOrEqual(lastWeight)
      expect(dot.weight).toBeGreaterThanOrEqual((GLYPH_SHAPES['-']?.weight ?? 0) - 1e-9)
      expect(x1 - x0).toBeGreaterThanOrEqual(lastLength)
      lastWeight = dot.weight
      lastLength = x1 - x0
    }
  })
})

describe('a screen switching on', () => {
  it('draws a line across the glass first, then opens it into a flash that settles to dark', () => {
    expect(powerOnLight(0)).toEqual({ width: 0, height: 0, alpha: 1 })
    // The line crosses the glass in the first third, still a line.
    expect(powerOnLight(0.33).width).toBeCloseTo(1)
    expect(powerOnLight(0.3).height).toBe(0)
    // Then it opens to the glass's height and fades, gone before the eyes open.
    expect(powerOnLight(0.5).height).toBeGreaterThan(0.5)
    expect(powerOnLight(0.5).alpha).toBeLessThan(0.85)
    expect(powerOnLight(0.67).alpha).toBeCloseTo(0, 3)
    let last = 2
    for (let p = 0.34; p <= 1; p += 0.01) {
      expect(powerOnLight(p).alpha).toBeLessThanOrEqual(last + 1e-12)
      last = powerOnLight(p).alpha
    }
  })

  it('keeps the eyes shut until the flash has settled, then blinks them open', () => {
    for (const p of [0, 0.2, 0.5, 0.66]) expect(powerOnEyes(p)).toBe(0)
    expect(powerOnEyes(0.8)).toBeGreaterThan(0)
    expect(powerOnEyes(1)).toBe(1)
    let last = 0
    for (let p = 0; p <= 1; p += 0.01) {
      expect(powerOnEyes(p)).toBeGreaterThanOrEqual(last)
      last = powerOnEyes(p)
    }
    expect(POWER_ON_S).toBeLessThan(1)
  })
})

/** A canvas that records what is lit: the eye strokes in the screen's glow, and the power-on's light. */
class Canvas {
  strokeStyle: unknown = '#000000'
  fillStyle: unknown = '#000000'
  lineWidth = 1
  lineCap = 'butt'
  lineJoin = 'miter'
  shadowColor = ''
  shadowBlur = 0
  globalAlpha = 1
  lit: string[] = []
  m = [1, 0, 0, 1, 0, 0]
  getTransform(): { a: number; b: number; c: number; d: number; e: number; f: number } {
    const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = this.m
    return { a, b, c, d, e, f }
  }
  setTransform(a: number | { a: number; b: number; c: number; d: number; e: number; f: number }, b = 0, c = 0, d = 1, e = 0, f = 0): void {
    this.m = typeof a === 'number' ? [a, b, c, d, e, f] : [a.a, a.b, a.c, a.d, a.e, a.f]
  }
  transform(): void {}
  translate(): void {}
  scale(): void {}
  save(): void {}
  restore(): void {}
  beginPath(): void {}
  closePath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  ellipse(): void {}
  clip(): void {}
  fill(): void {}
  stroke(): void {
    if (this.strokeStyle === PHOSPHOR.cyan.lit) this.lit.push('eye')
  }
  fillRect(): void {
    if (this.fillStyle === PHOSPHOR.cyan.lit) this.lit.push('power')
  }
  createLinearGradient(): { addColorStop: () => void } {
    return { addColorStop: () => undefined }
  }
}

/** What a screen lights in one frame at `seconds` of its clock, its power-on having begun at `bootAt`. */
function lights(eyes: EyeGlyphs, seconds: number, bootAt: number | undefined): string[] {
  const canvas = new Canvas()
  const painter = withGlyphEyes(canvas as unknown as CanvasRenderingContext2D, () => eyes, {
    ink: '#1a1a2e',
    screenOf: '#6fb7d6',
    pixelsPerUnit: 2,
    bootAt: () => bootAt
  })
  painter.frame({ yaw: 0, pitch: 0, lookX: 0, lookY: 0 }, seconds)
  ;(canvas as unknown as { clip: (path: unknown) => void }).clip({ body: true })
  for (let eye = 0; eye < 2; eye += 1) {
    canvas.translate()
    canvas.strokeStyle = GLYPH_INK
    canvas.lineWidth = 12.6
    canvas.stroke()
  }
  return canvas.lit
}

describe('a screen face', () => {
  it('is dark while it switches on: the light first, the eyes only once it has settled', () => {
    expect(lights(['o', 'o'], 10.1, 10)).toEqual(['power'])
    expect(lights(['o', 'o'], 10 + POWER_ON_S * 0.5, 10)).toEqual(['power'])
    expect(lights(['o', 'o'], 10 + POWER_ON_S * 0.9, 10)).toEqual(['eye', 'eye'])
    // Waiting its turn in a row (bootAt ahead): dark, nothing lit at all.
    expect(lights(['o', 'o'], 9.8, 10)).toEqual([])
  })

  it('is simply on once it has switched on, when it never had to, and on a still bot (reduced motion)', () => {
    expect(lights(['o', 'o'], 10 + POWER_ON_S + 0.1, 10)).toEqual(['eye', 'eye'])
    expect(lights(['o', 'o'], 10, undefined)).toEqual(['eye', 'eye'])
    expect(lights(['o', 'o'], 0, 0)).toEqual(['eye', 'eye'])
  })
})

/** A canvas that keeps the colour each lit eye is stroked in (the painter strokes through the prototype). */
class ColourCanvas extends Canvas {
  colours: string[] = []
  override stroke(): void {
    const style = String(this.strokeStyle)
    if (style !== GLYPH_INK && !style.startsWith('rgba(255,255,255')) this.colours.push(style)
  }
}

/** The colour a screen's eyes are lit in, in a frame at each of `seconds`, with `flash` asked for by the moment. */
function litAt(seconds: readonly number[], flash: (s: number) => Phosphor | undefined): string[] {
  const canvas = new ColourCanvas()
  let clock = 0
  const painter = withGlyphEyes(canvas as unknown as CanvasRenderingContext2D, () => ['^', '^'], {
    ink: '#1a1a2e',
    screenOf: '#6fb7d6',
    pixelsPerUnit: 2,
    flashNow: () => flash(clock)
  })
  const colours: string[] = []
  for (const s of seconds) {
    clock = s
    canvas.colours = []
    painter.frame({ yaw: 0, pitch: 0, lookX: 0, lookY: 0 }, s)
    ;(canvas as unknown as { clip: (path: unknown) => void }).clip({ body: true })
    canvas.translate()
    canvas.strokeStyle = GLYPH_INK
    canvas.lineWidth = 12.6
    // As the rig strokes an eye: the painter's own stroke, set on this context, draws both of a screen's eyes.
    ;(canvas as unknown as { stroke: () => void }).stroke()
    colours.push(canvas.colours[0] ?? '')
  }
  return colours
}

describe('a finished face', () => {
  /*
   * Colin: "dont make the eye color lime please just white, if you want work
   * that into a color change flash or something you can but not the entire
   * static color".
   */
  it('flashes green as it finishes and settles back to its own light', () => {
    const at = (s: number): number => 5 + s
    const colours = litAt([0.1, 0.25, 0.7, FLASH_S + 0.1, 3].map(at), (s) => (s >= 5 ? 'green' : undefined))
    const green = phosphorRgba(PHOSPHOR.green.lit)
    const cyan = phosphorRgba(PHOSPHOR.cyan.lit)
    const rgb = (css: string): readonly number[] => (css.startsWith('rgba') ? css.slice(5, -1).split(',').map(Number) : phosphorRgba(css))
    // Green while it comes in (through the blink that brings `^ ^`), between the two as it fades, its own light after.
    expect(rgb(colours[0] ?? '').slice(0, 3)).toEqual(green.slice(0, 3))
    expect(rgb(colours[1] ?? '').slice(0, 3)).toEqual(green.slice(0, 3))
    const mid = rgb(colours[2] ?? '')
    expect(mid[0]).toBeGreaterThan(green[0])
    expect(mid[0]).toBeLessThan(cyan[0])
    expect(colours[3]).toBe(PHOSPHOR.cyan.lit)
    expect(colours[4]).toBe(PHOSPHOR.cyan.lit)
  })

  it('is its own light on a still bot (reduced motion), and the flash fades smoothly to nothing', () => {
    expect(litAt([0], () => 'green')).toEqual([PHOSPHOR.cyan.lit])
    let last = -1
    for (let t = 0; t <= FLASH_S + 0.2; t += 0.01) {
      expect(flashFade(t)).toBeGreaterThanOrEqual(last)
      last = flashFade(t)
    }
    expect(flashFade(0)).toBe(0)
    expect(flashFade(FLASH_S)).toBe(1)
    expect(mixPhosphor(PHOSPHOR.green.lit, PHOSPHOR.cyan.lit, 1)).toBe(`rgba(${phosphorRgba(PHOSPHOR.cyan.lit).slice(0, 3).join(', ')}, 1)`)
  })
})

describe('a stuck face', () => {
  it('winces with its shudder as `> <`, and stays within the reach a screen leaves it', () => {
    let pinched = 1
    for (let t = 0.001; t < 6; t += 0.01) {
      const m = glyphMotion('><', 0, t)
      pinched = Math.min(pinched, m.sx)
      expect(Math.abs(m.dx)).toBeLessThanOrEqual(2)
      expect(m.sy).toBeLessThanOrEqual(1.16)
    }
    expect(pinched).toBeLessThan(0.9)
    // The crosses it replaced, should any face still wear them, keep their shudder and nothing more.
    for (let t = 0.001; t < 6; t += 0.05) expect(glyphMotion('xx', 0, t).sx).toBe(1)
  })
})
