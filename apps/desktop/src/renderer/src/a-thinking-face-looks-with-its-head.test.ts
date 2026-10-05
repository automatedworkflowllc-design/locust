import type { BotAvatarPose } from 'bot-avatars'
import { BotAvatarSim } from 'bot-avatars'
import { describe, expect, it } from 'vitest'

import { EYES_VISOR, GLYPH_INK, GLYPH_SHAPES, HEAD_GLANCE_S, PHOSPHOR, THINKING_HUSH, easedValue, glanceEase, glyphMotion, screenEyeLayout, screenPose, thinkingGlance, withGlyphEyes } from './components/Bot.js'
import type { EyeGlyphs, FacePose } from './components/Bot.js'

/**
 * A THINKING FACE LOOKS ABOUT WITH ITS HEAD (2026-10-05).
 *
 * Colin, of the terminal faces' thinking dots: "it just seems to bug out a
 * little bit when its the dot eyes looking around, my initial instinct is the
 * dots shouldnt move the screen should just rotate with the body". Frame by
 * frame (_tools/look-eyes-moving.mjs, docs/FINDING-eye-motion-bloub.md) the
 * dots never held still on the glass: their loop darted them about while the
 * rig's own look slid them on a schedule of its own. Now the dots keep their
 * place and the head does the looking, moved as bloub moves its gaze: an
 * ease-out toward each target, a pure function of time, never past it -- with
 * its first frames softened, since a head is heavier than an eye (glanceEase).
 */

const CYCLE = 4.2
const MS = 0.001

describe('a thinking face', () => {
  it('eases toward each glance: from rest, never past it or back, slowing all the way to its landing, then held', () => {
    // The second glance, up and to the right, leaves where the first landed: across the head's turn and tilt.
    for (const loop of [0, 3]) {
      const at = (t: number): ReturnType<typeof thinkingGlance> => thinkingGlance(loop * CYCLE + 1.05 + t)
      const start = at(0)
      const end = at(HEAD_GLANCE_S)
      expect(end.yaw - start.yaw).toBeGreaterThan(0.3)
      let last = start
      const speeds: number[] = []
      for (let t = MS; t <= HEAD_GLANCE_S + 1e-9; t += MS) {
        const now = at(t)
        for (const axis of ['yaw', 'pitch'] as const) {
          // Between where it left and where it lands, the whole way: no overshoot, no step back.
          expect(now[axis], `${axis} at ${t.toFixed(3)}`).toBeGreaterThanOrEqual(Math.min(start[axis], end[axis]) - 1e-12)
          expect(now[axis], `${axis} at ${t.toFixed(3)}`).toBeLessThanOrEqual(Math.max(start[axis], end[axis]) + 1e-12)
          expect(Math.sign(now[axis] - last[axis]) * Math.sign(end[axis] - start[axis]), `${axis} turns back at ${t.toFixed(3)}`).toBeGreaterThanOrEqual(0)
        }
        speeds.push(Math.hypot(now.yaw - last.yaw, now.pitch - last.pitch))
        last = now
      }
      const quickest = speeds.indexOf(Math.max(...speeds))
      // From rest: its first frame's worth (a 30th of a second) goes a twentieth of the way or less, not the third an
      // unsoftened ease-out goes; at its quickest within the first quarter; then only ever slower, to a standstill.
      expect(Math.hypot(at(1 / 30).yaw - start.yaw, at(1 / 30).pitch - start.pitch)).toBeLessThan(0.05 * Math.hypot(end.yaw - start.yaw, end.pitch - start.pitch))
      expect(quickest).toBeLessThan(speeds.length / 4)
      for (let i = quickest + 1; i < speeds.length; i += 1) expect(speeds[i], `speeds up at ${((i + 1) * MS).toFixed(3)}`).toBeLessThanOrEqual((speeds[i - 1] ?? 0) + 1e-12)
      expect(speeds[speeds.length - 1]).toBeLessThan(1e-6)
      // Landed, and held until the face gives the head back.
      expect(at(1.0).yaw).toBeCloseTo(end.yaw, 9)
    }
  })

  it('takes the head as the loop begins and gives it back before the dots are halfway through their bounce', () => {
    let last = thinkingGlance(CYCLE * 2 + MS).mix
    for (let t = 2 * MS; t < CYCLE; t += MS) {
      const mix = thinkingGlance(CYCLE * 2 + t).mix
      expect(mix).toBeGreaterThanOrEqual(0)
      expect(mix).toBeLessThanOrEqual(1)
      // Rising while the face looks about, falling once the dots bounce: never back the other way.
      if (t < 2.1) expect(mix, `at ${t.toFixed(3)}`).toBeGreaterThanOrEqual(last - 1e-12)
      else expect(mix, `at ${t.toFixed(3)}`).toBeLessThanOrEqual(last + 1e-12)
      last = mix
    }
    expect(thinkingGlance(CYCLE * 2 + 1).mix).toBe(1)
    for (const t of [2.1 + HEAD_GLANCE_S, 3, 3.5, 4.19]) expect(thinkingGlance(CYCLE * 2 + t).mix).toBe(0)
  })

  it('looks up, and to both sides, as the dots used to', () => {
    const looks = Array.from({ length: 210 }, (_, i) => thinkingGlance(CYCLE * 5 + i / 100))
    const looking = looks.filter((look) => look.mix > 0.99)
    expect(Math.min(...looking.map((look) => look.yaw))).toBeLessThan(-0.2)
    expect(Math.max(...looking.map((look) => look.yaw))).toBeGreaterThan(0.2)
    expect(looking.every((look) => look.pitch > 0)).toBe(true)
  })

  it('is at rest on a still bot, drawn at second 0 (reduced motion holds still): the head where the rig has it, the dots where they hold', () => {
    expect(thinkingGlance(0).mix).toBe(0)
    // Before its thinking has begun (its dots still opening), the same.
    expect(thinkingGlance(-0.1).mix).toBe(0)
    expect(glyphMotion('••', 0, 0)).toEqual(glyphMotion('••', 0, 1))
    expect(glyphMotion('••', 1, 0)).toEqual(glyphMotion('••', 0, 0))
  })

  it('replaces the rig\'s heading as its mix rises, rather than adding a second turn to it', () => {
    const rig = { yaw: 0.5, pitch: -0.2, roll: 0, x: 0, y: 0, sx: 1, sy: 1, eyeOpen: 1, blinkL: 0, blinkR: 0, lookX: 0, lookY: 0, breath: 0, laugh: 0, whirl: 0, whirlAngle: 0, w: [1, 0, 0] } as unknown as BotAvatarPose
    const look = { yaw: -0.3, pitch: 0.12 }
    expect(screenPose(rig, 0.5, { ...look, mix: 0 }).yaw).toBeCloseTo(0.5)
    expect(screenPose(rig, 0.5, { ...look, mix: 1 }).yaw).toBeCloseTo(-0.3)
    expect(screenPose(rig, 0.5, { ...look, mix: 1 }).pitch).toBeCloseTo(0.12)
    expect(screenPose(rig, 0.5, { ...look, mix: 0.5 }).yaw).toBeCloseTo(0.1)
    // Its glances sit well inside the turn a screen can show.
    for (let t = MS; t < CYCLE; t += 0.01) expect(Math.abs(thinkingGlance(t).yaw)).toBeLessThan(0.75)
  })

  it("holds the rig's own turning back meanwhile, so no turn of the head is faster than its glances (the real rig)", () => {
    // Ten seconds of a thinking face at 30 frames a second, on the rig itself: its heading wanders up to 0.6 either way.
    const fastest = (hush: number): number => {
      const sim = new BotAvatarSim(0.26, 'default')
      let last: number | undefined
      let most = 0
      for (let frame = 1; frame <= 300; frame += 1) {
        sim.update(1 / 30)
        const glance = thinkingGlance(CYCLE * 7 + frame / 30)
        const heading = (sim as unknown as { readonly baseYaw: number }).baseYaw
        const yaw = screenPose(sim.pose, heading, { ...glance, wander: 1 - hush }).yaw
        if (last !== undefined) most = Math.max(most, Math.abs(yaw - last))
        last = yaw
      }
      return most
    }
    // The glances' own quickest frame: two of them 0.44 apart, over HEAD_GLANCE_S.
    let glancing = 0
    for (let t = 0; t < CYCLE; t += 1 / 30) glancing = Math.max(glancing, Math.abs(thinkingGlance(CYCLE + t + 1 / 30).yaw * thinkingGlance(CYCLE + t + 1 / 30).mix - thinkingGlance(CYCLE + t).yaw * thinkingGlance(CYCLE + t).mix))
    expect(fastest(THINKING_HUSH)).toBeLessThan(glancing * 1.6)
    // Kept whole, the rig's heading is handed back from as far as it wandered: faster than any glance.
    expect(fastest(0)).toBeGreaterThan(fastest(THINKING_HUSH))
  })

  it('fades its look in and out from wherever it is, gliding on when changed midway', () => {
    const thinking = easedValue(0, HEAD_GLANCE_S)
    thinking.set(1, 10)
    const midway = thinking.at(10.1)
    expect(midway).toBeCloseTo(glanceEase(0.1 / HEAD_GLANCE_S))
    expect(midway).toBeGreaterThan(0)
    // Stopped thinking midway: it falls from where it is, never jumping back to 1 or to 0 first.
    thinking.set(0, 10.1)
    expect(thinking.at(10.1)).toBeCloseTo(midway)
    let last = midway
    for (let t = 10.1 + MS; t < 10.1 + HEAD_GLANCE_S; t += MS) {
      const now = thinking.at(t)
      expect(now).toBeLessThanOrEqual(last + 1e-12)
      expect(now).toBeGreaterThanOrEqual(0)
      last = now
    }
    expect(thinking.at(11)).toBe(0)
    // Between changes, the same moment always reads the same.
    expect(thinking.at(10.3)).toBe(thinking.at(10.3))
  })
})

/** A canvas that keeps a real transform and records each glyph stroke: where its points landed and how it was weighted. */
class Canvas {
  strokeStyle: unknown = '#000000'
  fillStyle: unknown = '#000000'
  lineWidth = 1
  lineCap = 'butt'
  lineJoin = 'miter'
  shadowColor = ''
  shadowBlur = 0
  globalAlpha = 1
  m = [1, 0, 0, 1, 0, 0]
  stack: number[][] = []
  points: [number, number][] = []
  strokes: { readonly style: unknown; readonly lineWidth: number; readonly m: readonly number[]; readonly points: readonly [number, number][] }[] = []
  getTransform(): { a: number; b: number; c: number; d: number; e: number; f: number } {
    const [a, b, c, d, e, f] = this.m as [number, number, number, number, number, number]
    return { a, b, c, d, e, f }
  }
  setTransform(a: number | { a: number; b: number; c: number; d: number; e: number; f: number }, b = 0, c = 0, d = 1, e = 0, f = 0): void {
    this.m = typeof a === 'number' ? [a, b, c, d, e, f] : [a.a, a.b, a.c, a.d, a.e, a.f]
  }
  transform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    const [A, B, C, D, E, F] = this.m as [number, number, number, number, number, number]
    this.m = [A * a + C * b, B * a + D * b, A * c + C * d, B * c + D * d, A * e + C * f + E, B * e + D * f + F]
  }
  translate(x: number, y: number): void {
    this.transform(1, 0, 0, 1, x, y)
  }
  scale(x: number, y: number): void {
    this.transform(x, 0, 0, y, 0, 0)
  }
  save(): void {
    this.stack.push([...this.m])
  }
  restore(): void {
    this.m = this.stack.pop() ?? this.m
  }
  beginPath(): void {
    this.points = []
  }
  moveTo(x: number, y: number): void {
    this.lineTo(x, y)
  }
  lineTo(x: number, y: number): void {
    const [a, b, c, d, e, f] = this.m as [number, number, number, number, number, number]
    this.points.push([a * x + c * y + e, b * x + d * y + f])
  }
  stroke(): void {
    this.strokes.push({ style: this.strokeStyle, lineWidth: this.lineWidth, m: [...this.m], points: [...this.points] })
  }
  closePath(): void {}
  fill(): void {}
  clip(): void {}
  ellipse(): void {}
  fillRect(): void {}
  createLinearGradient(): { addColorStop: () => void } {
    return { addColorStop: () => undefined }
  }
}

/** The widest and narrowest a round stroke is drawn: its weight through the transform it is stroked under. */
function drawnWeight(stroke: Canvas['strokes'][number]): readonly [number, number] {
  const [a, b, c, d] = stroke.m as [number, number, number, number]
  // The singular values of the transform's linear part.
  const s = a * a + b * b + c * c + d * d
  const root = Math.sqrt(Math.max(0, s * s - 4 * (a * d - b * c) ** 2))
  return [stroke.lineWidth * Math.sqrt((s + root) / 2), stroke.lineWidth * Math.sqrt(Math.max(0, (s - root) / 2))]
}

/** One frame of a screen face as the rig draws it: its front layer (turned by `yaw`), then each eye in the face's ink. */
function frame(eyes: EyeGlyphs, pose: FacePose, seconds: number, options: { yaw?: number; open?: number } = {}): Canvas['strokes'] {
  const canvas = new Canvas()
  const painter = withGlyphEyes(canvas as unknown as CanvasRenderingContext2D, () => eyes, { ink: '#1a1a2e', screenOf: '#6fb7d6', pixelsPerUnit: 2 })
  // The painter keeps its swap and lag from frame to frame; a frame at second `seconds`, drawn fresh each time.
  painter.frame(pose, seconds)
  const yaw = options.yaw ?? 0
  canvas.setTransform(Math.cos(yaw) * 0.95, 0, 0, 0.95, 40, 40)
  ;(canvas as unknown as { clip: (path: unknown) => void }).clip({ body: true })
  canvas.setTransform(1, 0, 0, 1, 40, 40)
  for (let eye = 0; eye < 2; eye += 1) {
    canvas.save()
    canvas.translate(eye === 0 ? -12 : 12, 1)
    canvas.strokeStyle = GLYPH_INK
    // The rig's eye weight says how open it is: 12.6 open, 2.8 shut.
    canvas.lineWidth = 2.8 + 9.8 * (options.open ?? 1)
    canvas.stroke()
    canvas.restore()
  }
  return canvas.strokes.filter((stroke) => stroke.style === PHOSPHOR.cyan.lit)
}

const still = (lookX: number, lookY: number): FacePose => ({ yaw: 0, pitch: 0, lookX, lookY })

describe("a screen's eyes", () => {
  it('keep their place on the glass while the rig looks about: its look turns the head, not the dots', () => {
    const at = (lookX: number, lookY: number, seconds: number): string =>
      JSON.stringify(frame(['•', '•'], still(lookX, lookY), seconds).map((stroke) => stroke.points.map(([x, y]) => [x.toFixed(6), y.toFixed(6)])))
    for (const seconds of [0.3, 0.9, 1.6]) {
      const ahead = at(0, 0, seconds)
      for (const [x, y] of [[4.5, 0], [-4.5, 3], [3.6, -2.4], [-9, 7]] as const) expect(at(x, y, seconds), `look ${x},${y} at ${seconds}`).toBe(ahead)
    }
  })

  it('share one gaze: at any moment the two are the same distance apart, and level', () => {
    let spread: number | undefined
    for (let i = 0; i < 126; i += 1) {
      const seconds = CYCLE * 2 + i / 30
      const strokes = frame(['•', '•'], still(0, 0), seconds)
      expect(strokes).toHaveLength(2)
      const [left, right] = strokes.map((stroke) => stroke.points[0] ?? [0, 0]) as [[number, number], [number, number]]
      const motion = [glyphMotion('••', 0, seconds), glyphMotion('••', 1, seconds)]
      if (seconds % CYCLE < 2.1) {
        // While the face looks about, the two dots are one gaze: level, and the same distance apart every frame.
        expect(motion[0]).toEqual(motion[1])
        expect(right[1] - left[1]).toBeCloseTo(0, 9)
        spread ??= right[0] - left[0]
        expect(right[0] - left[0]).toBeCloseTo(spread, 9)
      }
    }
    expect(spread).toBeGreaterThan(0)
  })

  it('never thin in a blink: every stroke keeps its weight, open, blinking or shut', () => {
    for (const eyes of [['>', '▮'], ['^', '^'], ['>', '<'], ['x', 'x'], ['|', '|']] as const) {
      const open = frame(eyes, still(0, 0), 1, { open: 1 }).map(drawnWeight)
      for (const openness of [0.6, 0.3, 0.05]) {
        const blinking = frame(eyes, still(0, 0), 1, { open: openness }).map(drawnWeight)
        expect(blinking, `${eyes.join('')} at ${openness}`).toEqual(open)
      }
    }
  })

  it('blink, dots too: a dot, with no length to squash, closes into the screen\'s dash and never thinner (2026-10-05)', () => {
    const { scale } = screenEyeLayout(EYES_VISOR, ['•', '•'], { x: 0, y: 0 }, 1)
    const px = scale * 2 * 0.95
    const dot = (GLYPH_SHAPES['•']?.weight ?? 0) * px
    const dash = (GLYPH_SHAPES['-']?.weight ?? 0) * px
    let last = Number.POSITIVE_INFINITY
    for (const openness of [1, 0.8, 0.6, 0.4, 0.2, 0.05]) {
      const strokes = frame(['•', '•'], still(0, 0), 1, { open: openness })
      for (const stroke of strokes) {
        const [wide, narrow] = drawnWeight(stroke)
        // Round however far it has shut, as heavy as the dash at the least, and lighter only as it shuts.
        expect(narrow).toBeCloseTo(wide, 9)
        expect(wide).toBeGreaterThanOrEqual(dash - 1e-9)
        expect(wide).toBeLessThanOrEqual(dot + 1e-9)
        expect(wide).toBeLessThanOrEqual(last + 1e-9)
      }
      last = Math.min(...strokes.map((stroke) => drawnWeight(stroke)[0]))
    }
    // Shut, it is a dash: level, and as wide as the screen's own `-`.
    const shut = frame(['•', '•'], still(0, 0), 1, { open: 0 })[0]
    const [a, b] = shut?.points ?? []
    expect(Math.abs((b?.[1] ?? 0) - (a?.[1] ?? 0))).toBeLessThan(1e-6)
    // Its ends lie in the front plane (this canvas's front layer is 0.95 of a unit): the dash's 9.6 units across.
    expect(Math.abs((b?.[0] ?? 0) - (a?.[0] ?? 0))).toBeCloseTo(9.6 * scale * 0.95, 3)
  })

  it('never thin as the head turns: a round dot is drawn round, the same size, however far it is turned', () => {
    const facing = frame(['•', '•'], still(0, 0), 1, { yaw: 0 }).map(drawnWeight)
    // Round, and as heavy as the dot's own weight on this screen.
    const { scale } = screenEyeLayout(EYES_VISOR, ['•', '•'], { x: 0, y: 0 }, 1)
    for (const [wide, narrow] of facing) {
      expect(narrow).toBeCloseTo(wide, 9)
      expect(wide).toBeCloseTo((GLYPH_SHAPES['•']?.weight ?? 0) * scale * 2 * 0.95, 6)
    }
    for (const yaw of [0.3, 0.6, 0.75]) expect(frame(['•', '•'], still(0, 0), 1, { yaw }).map(drawnWeight), `turned ${yaw}`).toEqual(facing)
  })
})
