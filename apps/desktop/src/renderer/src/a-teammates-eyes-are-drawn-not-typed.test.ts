import { describe, expect, it } from 'vitest'

import { EYES_VISOR, GLYPH_INK, GLYPH_SHAPES, fitVisor, glyphMotion, hueOf, visorOutline, SCREEN_RESTING_EYES, eyeOpenness, onSphere, outlineOf, sameHue, withGlyphEyes } from './components/Bot.js'
import type { EyeGlyphs } from './components/Bot.js'
import { eyeGlyphsFor } from './components/TeammateBot.js'
import type { FaceActivity } from './faceState.js'
import { LOCUST_BOTS } from './locustBots.js'

/**
 * A TEAMMATE'S EYES ARE DRAWN, NOT TYPED (0.560).
 *
 * Colin, 2026-10-03, beside the codex mascot's sheet: "the eyes for this one
 * look thick and filled out, not like we just gave them text for eyes". 0.559
 * set each glyph in a font; now each is round strokes the eye's own weight,
 * and the Prompt bot -- "he also seems to have a screen for a face" -- wears a
 * dark screen with lit eyes. Looked at: _tools/look-glyph-eyes.mjs.
 */

/** A canvas context that only records, its methods on its prototype as a real one's are. */
class Recorder {
  calls: string[] = []
  strokeStyle: unknown = '#000000'
  fillStyle: unknown = '#000000'
  lineWidth = 1
  lineCap = 'butt'
  lineJoin = 'miter'
  shadowColor = ''
  shadowBlur = 0
  globalAlpha = 1
  caps: string[] = []
  styles: unknown[] = []
  stroke(): void {
    this.calls.push('stroke')
    this.caps.push(this.lineCap)
    this.styles.push(this.strokeStyle)
  }
  fill(): void {
    this.calls.push('fill')
  }
  fillText(): void {
    this.calls.push('fillText')
  }
  translate(): void {
    this.calls.push('translate')
  }
  getTransform(): unknown {
    return { a: 1 }
  }
  setTransform(): void {}
  save(): void {}
  restore(): void {}
  beginPath(): void {}
  closePath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  ellipse(): void {}
  clip(): void {}
  fillRect(): void {}
  createLinearGradient(): { addColorStop: () => void } {
    return { addColorStop: () => undefined }
  }
}

function drawEyes(eyes: EyeGlyphs | undefined, screenOf?: string): Recorder {
  const context = new Recorder()
  const painter = withGlyphEyes(context as unknown as CanvasRenderingContext2D, () => eyes, {
    ink: '#1a1a2e',
    screenOf,
    pixelsPerUnit: 1
  })
  painter.frame(0, 0, 0)
  // As the rig draws each eye: a move to it, then one stroke in the face's ink, open.
  for (let eye = 0; eye < 2; eye += 1) {
    context.translate()
    context.strokeStyle = GLYPH_INK
    context.lineWidth = 12.6
    context.stroke()
  }
  return context
}

describe('a glyph eye', () => {
  it('is round strokes, never a letter', () => {
    const drawn = drawEyes(['>', '_'])
    expect(drawn.calls).not.toContain('fillText')
    expect(drawn.calls.filter((call) => call === 'stroke')).toHaveLength(2)
    expect(drawn.caps).toEqual(['round', 'round'])
    expect(drawn.styles).toEqual(['#1a1a2e', '#1a1a2e'])
  })

  it('is drawn for every glyph a state asks for, and a screen rests on one too', () => {
    const all: readonly FaceActivity[] = ['thinking', 'working', 'delegating', 'responding', 'waiting', 'receiving', 'blocked', 'done', 'idle']
    const asked = new Set([...all.flatMap((activity) => eyeGlyphsFor(activity) ?? []), ...SCREEN_RESTING_EYES])
    for (const glyph of asked) expect(GLYPH_SHAPES[glyph], glyph).toBeDefined()
  })

  it('is as heavy as the eye it stands for', () => {
    // The rig's open eye is one round stroke 12.6 across: a glyph a third of that or more reads as an eye.
    for (const [glyph, shape] of Object.entries(GLYPH_SHAPES)) expect(shape.weight, glyph).toBeGreaterThanOrEqual(3.8)
  })

  it('blinks with the eye: open at its full weight, shut at its blink weight', () => {
    expect(eyeOpenness(12.6)).toBe(1)
    expect(eyeOpenness(2.8)).toBe(0)
    expect(eyeOpenness(7.7)).toBeCloseTo(0.5)
  })
})

describe('a screen for a face', () => {
  it('is the Prompt bot\'s, and no other shape\'s', () => {
    expect(outlineOf('prompt').screen).toBe(true)
    for (const type of Object.keys(LOCUST_BOTS).filter((type) => type !== 'prompt')) {
      expect(outlineOf(type as keyof typeof LOCUST_BOTS).screen, type).toBe(false)
    }
    expect(outlineOf('droid').screen).toBe(false)
  })

  it('is drawn once a frame, under the eyes, and the eyes are lit in the teammate\'s own hue', () => {
    const drawn = drawEyes(['>', '_'], '#6fb7d6')
    // The visor's fill, its rim, then each eye.
    expect(drawn.calls.filter((call) => call === 'fill')).toHaveLength(1)
    expect(drawn.calls.indexOf('fill')).toBeLessThan(drawn.calls.lastIndexOf('stroke'))
    const lit = drawn.styles.slice(-2)
    expect(lit[0]).toBe(sameHue('#6fb7d6', 0.95, 0.8))
    expect(lit[1]).toBe(lit[0])
  })

  it('keeps the hue it is given', () => {
    expect(sameHue('#ff0000', 1, 0.5)).toBe('hsla(0, 100%, 50%, 1)')
    expect(sameHue('#6fb7d6', 0.95, 0.8)).toMatch(/^hsla\(19[0-9], 95%, 80%, 1\)$/)
  })

  it('turns with the head, and holds at its edge past it', () => {
    // Facing ahead, a point on the face's midline is where it is; off it, the rig's own projection.
    expect(onSphere(10, 0, 0, 0)[0]).toBeCloseTo(10)
    expect(onSphere(0, 4, 0, 0)[1]).toBeCloseTo(4)
    expect(onSphere(0, 0, 0.5, 0)[0]).toBeCloseTo(30 * Math.sin(0.5))
    // Turned right round, a point of the face sits at the sphere's edge, never back across it.
    expect(onSphere(20, 0, 3, 0)[0]).toBeCloseTo(30)
  })
})

/**
 * AND ALIVE. Colin, 2026-10-03, of 0.559: "it looks like the eyes are just
 * staying as flat lines on not cycling through any effects so they dont look
 * alive". Each pair has its own loop on the rig's clock.
 */
describe('eyes that are alive', () => {
  const over = (pair: string, eye: 0 | 1): ReturnType<typeof glyphMotion>[] =>
    Array.from({ length: 240 }, (_, i) => glyphMotion(pair, eye, 1 + i / 30))

  it('move, every pair a state asks for, over a few seconds', () => {
    for (const pair of ['>_', '--', '^^', 'xx']) {
      const seen = new Set(over(pair, 1).map((m) => `${m.dx.toFixed(2)},${m.dy.toFixed(2)},${m.sx.toFixed(2)},${m.shown}`))
      expect(seen.size, pair).toBeGreaterThan(4)
    }
  })

  it('at work, the cursor blinks and the prompt stays lit', () => {
    expect(over('>_', 1).some((m) => !m.shown)).toBe(true)
    expect(over('>_', 1).some((m) => m.shown)).toBe(true)
    expect(over('>_', 0).every((m) => m.shown)).toBe(true)
  })

  it('in thought, now and then pull in to dots', () => {
    expect(Math.min(...over('--', 0).map((m) => m.sx))).toBeLessThan(0.5)
  })

  it('rest on a still bot, which is drawn at second 0', () => {
    for (const pair of ['>_', '--', '^^', 'xx', '||']) expect(glyphMotion(pair, 1, 0)).toEqual({ dx: 0, dy: 0, sx: 1, sy: 1, shown: true })
  })

  it('stay small: a glyph never wanders off its eye', () => {
    for (const pair of ['>_', '--', '^^', 'xx']) {
      for (const m of [...over(pair, 0), ...over(pair, 1)]) {
        expect(Math.abs(m.dx), pair).toBeLessThanOrEqual(2)
        expect(Math.abs(m.dy), pair).toBeLessThanOrEqual(2)
      }
    }
  })
})

/**
 * EVERY SHAPE'S OWN SCREEN (0.561), Terminal faces on: fitted to the body.
 */
describe('a fitted screen', () => {
  // A body that is a circle of radius 30 about 50, 50, in the outline's own units.
  const circle = (x: number, y: number): boolean => Math.hypot(x - 50, y - 50) <= 30

  it('keeps its full size where the body has room', () => {
    const roomy = (x: number, y: number): boolean => x > 0 && x < 100 && y > 0 && y < 100
    expect(fitVisor(roomy, 50, 50, 1, EYES_VISOR)).toEqual(EYES_VISOR)
  })

  it('shrinks until it sits inside the body with a margin', () => {
    const fitted = fitVisor(circle, 50, 50, 1, EYES_VISOR)
    expect(fitted.halfWidth).toBeLessThan(EYES_VISOR.halfWidth)
    // Every point of its outline is inside the body; a size bigger by a step would not be.
    for (const [x, y] of visorOutline(fitted)) expect(circle(50 + x, 50 + y)).toBe(true)
    const bigger = { ...fitted, halfWidth: fitted.halfWidth * 1.1 + 3, halfHeight: fitted.halfHeight * 1.1 + 3, corner: fitted.corner * 1.1 + 3 }
    expect(visorOutline(bigger).every(([x, y]) => circle(50 + x, 50 + y))).toBe(false)
  })

  it('reads the hue of whatever colour the plastic hands it', () => {
    expect(hueOf('hsl(219.7 89.7% 64.7%)')).toBeCloseTo(219.7)
    expect(hueOf('#ff0000')).toBe(0)
    expect(hueOf('rgb(0, 0, 255)')).toBe(240)
  })
})
