import type { BotAvatarPose } from 'bot-avatars'
import { BotAvatarSim } from 'bot-avatars'
import { describe, expect, it } from 'vitest'

import {
  CURIOUS_TILT,
  FLASH_S,
  GLYPH_INK,
  HEAD_GLANCE_S,
  PHOSPHOR,
  SWAP_S,
  blinkNow,
  bodyConductor,
  phosphorRgba,
  thinkingGlance,
  tiltSide,
  withGlyphEyes
} from './components/Bot.js'
import type { BodyWants, EyeGlyphs, FaceChange, Phosphor } from './components/Bot.js'

/**
 * A CHANGE IS PERFORMED IN ORDER (2026-10-05).
 *
 * Frame by frame (look-eyes-moving.mjs --sequence), a change of state was
 * several things at once. A screen blinked twice, its own swap and then the
 * rig's blink a few frames later. A finished teammate's old eyes turned green
 * as they closed, and its hop had left the ground before its new eyes were
 * open. Each new loop began wherever the bot's clock happened to be: a cursor
 * mid-blink, a head mid-turn. And a teammate deep in thought barely turned to
 * the one handing it a message. Now a change is one blink, the new eyes in
 * under the shut lids, then the state's own loops from their start, and only
 * then the body: its mood, its hop, its thinking look. A handoff glance wins.
 * bloub's rule: every change of shape hides behind one blink.
 */

const FRAME = 1 / 30

/** A canvas that keeps a real transform and records each stroke: its colour, and where its points landed. */
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
  strokes: { readonly style: string; readonly points: readonly [number, number][] }[] = []
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
    this.strokes.push({ style: String(this.strokeStyle), points: [...this.points] })
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

/** What a face is asked for at a moment: its eyes, their colour, a flash, and what it is doing. */
interface Asked {
  readonly eyes: EyeGlyphs
  readonly tone?: Phosphor
  readonly flash?: Phosphor
  readonly key?: string
}

interface Frame {
  readonly s: number
  readonly change: FaceChange
  /** The lit eyes' strokes this frame, the screen's glass left out. */
  readonly lit: Canvas['strokes']
}

/**
 * A screen face as the rig draws it, frame by frame at 30 a second from `from` to `to`, asked at each second what
 * `at` says; `rested` is how far it has settled to rest (EyePaint.restNow).
 */
function film(at: (s: number) => Asked, from: number, to: number, rested = 0): Frame[] {
  const canvas = new Canvas()
  let asked = at(from)
  const painter = withGlyphEyes(canvas as unknown as CanvasRenderingContext2D, () => asked.eyes, {
    ink: '#1a1a2e',
    screenOf: '#6fb7d6',
    pixelsPerUnit: 2,
    phosphorNow: () => asked.tone ?? 'cyan',
    flashNow: () => asked.flash,
    keyNow: () => asked.key,
    restNow: () => rested
  })
  const frames: Frame[] = []
  for (let i = 0; from + i * FRAME <= to + 1e-9; i += 1) {
    const s = from + i * FRAME
    asked = at(s)
    canvas.strokes = []
    const change = painter.change(s)
    painter.frame({ yaw: 0, pitch: 0, lookX: 0, lookY: 0 }, s)
    // As the rig draws a face: its front layer clipped, then each eye in the face's ink, wide open.
    canvas.setTransform(0.95, 0, 0, 0.95, 40, 40)
    ;(canvas as unknown as { clip: (path: unknown) => void }).clip({ body: true })
    canvas.setTransform(1, 0, 0, 1, 40, 40)
    for (let eye = 0; eye < 2; eye += 1) {
      canvas.save()
      canvas.translate(eye === 0 ? -12 : 12, 1)
      canvas.strokeStyle = GLYPH_INK
      canvas.lineWidth = 12.6
      canvas.stroke()
      canvas.restore()
    }
    frames.push({ s, change, lit: canvas.strokes.filter((stroke) => stroke.style !== GLYPH_INK && !stroke.style.startsWith('rgba(255,255,255')) })
  }
  return frames
}

const eyesOf = (frame: Frame): string => frame.change.eyes?.join('') ?? ''

/** The runs of frames a face's eyes are shut by a change: one run is one blink. */
function blinks(frames: readonly Frame[]): Frame[][] {
  const runs: Frame[][] = []
  let run: Frame[] = []
  for (const frame of frames) {
    if (frame.change.shut > 0) run.push(frame)
    else if (run.length > 0) {
      runs.push(run)
      run = []
    }
  }
  if (run.length > 0) runs.push(run)
  return runs
}

describe('a change, on a screen', () => {
  it('is one blink: the eyes shut, the new ones come in under the shut lids, they open, and only then does its state begin', () => {
    const frames = film((s) => (s < 10 ? { eyes: ['•', '•'], key: 'thinking' } : { eyes: ['>', '▮'], key: 'working' }), 9.5, 11)
    const [blink, ...more] = blinks(frames)
    expect(more).toHaveLength(0)
    expect(blink).toBeDefined()
    const run = blink ?? []
    // Down to shut and back up, once: never opening part way and shutting again.
    const deepest = run.reduce((at, frame, i) => ((frame.change.shut > (run[at]?.change.shut ?? 0)) ? i : at), 0)
    for (let i = 1; i < run.length; i += 1) {
      const step = (run[i]?.change.shut ?? 0) - (run[i - 1]?.change.shut ?? 0)
      if (i <= deepest) expect(step, `shutting at ${String(run[i]?.s)}`).toBeGreaterThan(0)
      else expect(step, `opening at ${String(run[i]?.s)}`).toBeLessThan(0)
    }
    expect(run[deepest]?.change.shut).toBeGreaterThan(0.9)
    // The new eyes come in once, while the lids are nearly shut.
    const swapped = frames.findIndex((frame) => eyesOf(frame) === '>▮')
    expect(frames.slice(swapped).every((frame) => eyesOf(frame) === '>▮')).toBe(true)
    expect(frames[swapped]?.change.shut).toBeGreaterThan(0.9)
    // Not open while it is under way, from the frame it begins; open before and after. Its state begins as they open.
    const begun = frames.find((frame) => frame.change.count > 0)?.s ?? Number.NaN
    expect(begun).toBeCloseTo(10, 9)
    for (const frame of frames) expect(frame.change.open, `at ${frame.s.toFixed(3)}`).toBe(frame.s < begun - 1e-9 || frame.s >= begun + SWAP_S - 1e-9)
    expect(frames.at(-1)?.change.since).toBeCloseTo(begun + SWAP_S, 9)
    expect((frames.at(-1)?.change.count ?? 0) - (frames[0]?.change.count ?? 0)).toBe(1)
  })

  it('blinks once for a change of what it is doing, its eyes and their colour the same; and not at all with no change', () => {
    const changed = film((s) => ({ eyes: ['o', 'o'], tone: 'amber', key: s < 10 ? 'waiting' : 'receiving' }), 9.5, 11)
    expect(blinks(changed)).toHaveLength(1)
    expect(changed.at(-1)?.change.count).toBe(1)
    const unchanged = film(() => ({ eyes: ['o', 'o'], tone: 'amber', key: 'waiting' }), 9.5, 11)
    expect(blinks(unchanged)).toHaveLength(0)
    expect(unchanged.at(-1)?.change.count).toBe(0)
  })

  it('asked for again mid-change, goes on from where its lids are: never springing open to shut again', () => {
    // A frame's worth of a blink: the farthest the lids move between two frames.
    const most = FRAME / (SWAP_S / 2) + 1e-9
    for (const again of [0.06, 0.2]) {
      const frames = film((s) => ({ eyes: s < 10 ? ['•', '•'] : s < 10 + again ? ['>', '▮'] : ['^', '^'] }), 9.5, 11)
      // One blink, however many changes went into it: the lids never reopen between them.
      expect(blinks(frames), `again at +${String(again)}`).toHaveLength(1)
      for (let i = 1; i < frames.length; i += 1) {
        expect(Math.abs((frames[i]?.change.shut ?? 0) - (frames[i - 1]?.change.shut ?? 0)), `at ${String(frames[i]?.s)}`).toBeLessThanOrEqual(most)
      }
      expect(eyesOf(frames.at(-1) as Frame)).toBe('^^')
      expect(frames.at(-1)?.change.count).toBe(2)
    }
    // Asked again while still shutting, the eyes it was shutting to are never shown.
    const early = film((s) => ({ eyes: s < 10 ? ['•', '•'] : s < 10.06 ? ['>', '▮'] : ['^', '^'] }), 9.5, 11)
    expect(early.some((frame) => eyesOf(frame) === '>▮')).toBe(false)
  })

  it('brings its flash in with its new eyes, never on the old ones as they shut, and fades from there', () => {
    const frames = film((s) => (s < 10 ? { eyes: ['>', '▮'], key: 'working' } : { eyes: ['^', '^'], flash: 'green', key: 'done' }), 9.5, 12)
    const green = phosphorRgba(PHOSPHOR.green.lit).slice(0, 3)
    const rgb = (style: string): readonly number[] => (style.startsWith('rgba') ? style.slice(5, -1).split(',').map(Number).slice(0, 3) : phosphorRgba(style).slice(0, 3))
    const swapped = frames.findIndex((frame) => eyesOf(frame) === '^^')
    expect(swapped).toBeGreaterThan(0)
    // The old eyes, shutting, keep their own light.
    for (const frame of frames.slice(0, swapped)) for (const stroke of frame.lit) expect(stroke.style, `at ${frame.s.toFixed(3)}`).toBe(PHOSPHOR.cyan.lit)
    // The new ones come in green, and hold it a moment...
    for (const stroke of frames[swapped]?.lit ?? []) expect(rgb(stroke.style)).toEqual(green)
    // ...then fade to their own light by FLASH_S after they came in (the lids' midpoint), and stay there.
    const cameIn = 10 + SWAP_S / 2
    for (const frame of frames.filter((f) => f.s >= cameIn + FLASH_S + FRAME)) for (const stroke of frame.lit) expect(stroke.style).toBe(PHOSPHOR.cyan.lit)
  })

  it("starts its state's loops as the eyes open on it, on its own clock: the eyes are the loop's, from its start", () => {
    // Whenever the change comes, the new eyes are drawn as a face that had just begun them would draw them.
    for (const at of [10, 10.4, 10.8, 11.2, 11.6]) {
      const frames = film((s) => ({ eyes: s < at ? ['•', '•'] : ['^', '^'] }), at - 0.5, at + 2)
      const opened = frames.filter((frame) => frame.change.open && eyesOf(frame) === '^^')
      expect(opened.length).toBeGreaterThan(40)
      for (const frame of opened) {
        // The same pair on a face that never changed, drawn at the state's own second: its loop, from its start.
        const own = film(() => ({ eyes: ['^', '^'] }), frame.s - frame.change.since, frame.s - frame.change.since)[0]
        expect(frame.lit.map((stroke) => stroke.points), `changed at ${String(at)}, drawn at ${frame.s.toFixed(3)}`).toEqual(own?.lit.map((stroke) => stroke.points))
      }
    }
  })

  it('performs nothing on a still bot (reduced motion): the eyes asked for, at once, open', () => {
    let eyes: EyeGlyphs = ['•', '•']
    const painter = withGlyphEyes(new Canvas() as unknown as CanvasRenderingContext2D, () => eyes, { ink: '#1a1a2e', screenOf: '#6fb7d6', pixelsPerUnit: 2 })
    expect(painter.change(0)).toEqual({ since: 0, open: true, shut: 0, quiet: true, count: 0, eyes: ['•', '•'] })
    eyes = ['>', '▮']
    expect(painter.change(0)).toEqual({ since: 0, open: true, shut: 0, quiet: true, count: 0, eyes: ['>', '▮'] })
  })
})

/** The rig's pose, held still: a body standing facing you, so whatever moves is the answer. */
const rest = (overrides: Partial<BotAvatarPose> = {}): BotAvatarPose => ({
  yaw: 0, pitch: 0, roll: 0.03, x: 0, y: 0, sx: 1, sy: 1, eyeOpen: 1, blinkL: 0, blinkR: 0,
  lookX: 0, lookY: 0, breath: 0, laugh: 0, whirl: 0, whirlAngle: 0, w: [1, 0, 0], ...overrides
}) as BotAvatarPose

interface Answered {
  readonly s: number
  readonly change: FaceChange
  readonly pose: BotAvatarPose
  readonly blink: boolean
  readonly hop: boolean
  readonly rest: number
  readonly settled: boolean
}

/**
 * A body answering what its face does, frame by frame at 30 a second: the face's change from a painter of its
 * own (asked by `at`), the body asked for `wants` -- a hop it takes once, as the rig does.
 */
function answer(
  screen: boolean,
  at: (s: number) => Asked,
  wants: (s: number) => Omit<BodyWants, 'hop' | 'resting'> & { readonly hop?: boolean; readonly resting?: boolean },
  from: number,
  to: number,
  options: { readonly heading?: number; readonly seed?: number; readonly restingAtStart?: boolean } = {}
): Answered[] {
  let asked = at(from)
  const painter = withGlyphEyes(new Canvas() as unknown as CanvasRenderingContext2D, () => asked.eyes, {
    ink: '#1a1a2e',
    screenOf: screen ? '#6fb7d6' : undefined,
    pixelsPerUnit: 2,
    keyNow: () => asked.key
  })
  const body = bodyConductor(options.seed ?? 0.4, screen, false, options.restingAtStart ?? false)
  let hopTaken = false
  const frames: Answered[] = []
  for (let i = 0; from + i * FRAME <= to + 1e-9; i += 1) {
    const s = from + i * FRAME
    asked = at(s)
    const change = painter.change(s)
    const wanted = wants(s)
    const frame = body.frame(s, change, rest({ yaw: options.heading ?? 0 }), options.heading ?? 0, {
      ...wanted,
      hop: (wanted.hop ?? false) && !hopTaken,
      resting: wanted.resting ?? false
    })
    if (frame.hop) hopTaken = true
    frames.push({ s, change, ...frame })
  }
  return frames
}

describe('the body, answering a change', () => {
  it('blinks a face of plastic once a change, as the change begins; never a screen, whose swap is its blink', () => {
    const doing = (s: number): Asked => ({ eyes: ['•', '•'], key: s < 10 ? 'thinking' : s < 11 ? 'working' : 'done' })
    const plastic = answer(false, doing, () => ({ mood: undefined, glancing: false }), 9.5, 12)
    const blinked = plastic.filter((frame) => frame.blink)
    expect(blinked.map((frame) => frame.change.count)).toEqual([1, 2])
    // Each as its change begins: the first frame its lids start to shut.
    for (const frame of blinked) expect(frame.change.open).toBe(false)
    expect(blinked[0]?.s).toBeCloseTo(10, 9)
    const screen = answer(true, doing, () => ({ mood: undefined, glancing: false }), 9.5, 12)
    expect(screen.filter((frame) => frame.blink)).toHaveLength(0)
  })

  it("counts a change's blink as the rig's own: the rig's next blink waits as after any of its blinks, so a change never blinks twice", () => {
    type Private = { readonly blink: { readonly active: boolean }; readonly blinkAt: number; readonly t: number }
    for (const fire of [true, false]) {
      for (const seed of [0.11, 0.26, 0.4, 0.57, 0.83]) {
        const sim = new BotAvatarSim(seed, 'default')
        const rig = sim as unknown as Private
        // Up to a moment the rig is about to blink of its own accord, a third of a second off, and a change lands.
        let steps = 0
        while (!(rig.blinkAt - rig.t < 0.3 && rig.blinkAt - rig.t > 0.1 && !rig.blink.active) && steps < 3000) {
          sim.update(FRAME)
          steps += 1
        }
        expect(steps).toBeLessThan(3000)
        expect(blinkNow(sim, fire)).toBe(true)
        // Two seconds on: one blink if the change fired one (a face of plastic), none if it blinked its own (a screen).
        let blinksSeen = rig.blink.active ? 1 : 0
        let was = rig.blink.active
        for (let i = 0; i < 60; i += 1) {
          sim.update(FRAME)
          if (rig.blink.active && !was) blinksSeen += 1
          was = rig.blink.active
        }
        expect(blinksSeen, `seed ${String(seed)}, ${fire ? 'fired' : 'a screen'}`).toBe(fire ? 1 : 0)
      }
    }
  })

  it('wears a new mood only once its eyes are open: through the blink its head holds, then it tips', () => {
    for (const screen of [false, true]) {
      const frames = answer(
        screen,
        (s) => ({ eyes: ['o', 'o'], key: s < 10 ? 'working' : 'waiting' }),
        (s) => ({ mood: s < 10 ? undefined : 'curious', glancing: false }),
        9.5,
        11.5
      )
      const tipped = 0.03 + tiltSide(0.4) * CURIOUS_TILT
      for (const frame of frames) {
        if (frame.s < 10 + SWAP_S - 1e-9) expect(frame.pose.roll, `${screen ? 'screen' : 'plastic'} at ${frame.s.toFixed(3)}`).toBeCloseTo(0.03, 12)
      }
      const after = frames.filter((frame) => frame.s >= 10 + SWAP_S - 1e-9)
      // From where it was, all the way over, and never back.
      expect(after[0]?.pose.roll).toBeCloseTo(0.03, 12)
      for (let i = 1; i < after.length; i += 1) expect(Math.abs(tipped - (after[i]?.pose.roll ?? 0))).toBeLessThanOrEqual(Math.abs(tipped - (after[i - 1]?.pose.roll ?? 0)) + 1e-12)
      expect(frames.find((frame) => frame.s >= 10 + SWAP_S + HEAD_GLANCE_S)?.pose.roll).toBeCloseTo(tipped, 9)
    }
  })

  it('hops once its eyes are open on the change that asked for it, and not before', () => {
    for (const screen of [false, true]) {
      const frames = answer(
        screen,
        (s) => ({ eyes: s < 10 ? ['>', '▮'] : ['^', '^'], key: s < 10 ? 'working' : 'done' }),
        (s) => ({ mood: s < 10 ? undefined : 'glad', glancing: false, hop: s >= 10 }),
        9.5,
        11
      )
      const hops = frames.filter((frame) => frame.hop)
      expect(hops).toHaveLength(1)
      expect(hops[0]?.change.open).toBe(true)
      // The first frame its eyes are open on the change.
      expect(hops[0]?.s).toBeCloseTo(frames.find((frame) => frame.s >= 10 + SWAP_S - 1e-9)?.s ?? Number.NaN, 9)
    }
  })

  it("begins its thinking look as its dots open, from where the rig has the head, on the thinking's own clock", () => {
    for (const at of [10, 10.5, 11.3]) {
      const frames = answer(true, (s) => ({ eyes: s < at ? ['>', '▮'] : ['•', '•'], key: s < at ? 'working' : 'thinking' }), () => ({ mood: undefined, glancing: false }), at - 0.5, at + 2)
      const open = at + SWAP_S
      // Facing you until its dots are open on it, the rig's own head throughout the blink.
      for (const frame of frames.filter((f) => f.s < open - 1e-9)) expect(frame.pose.yaw).toBe(0)
      // Then it looks up and to the left, the first of its glances, wherever its clock had got to: the look's own start.
      const settled = frames.find((frame) => frame.s >= open + 1)
      expect(settled?.pose.yaw).toBeCloseTo(thinkingGlance(1).yaw, 2)
      expect(settled?.pose.pitch).toBeCloseTo(thinkingGlance(1).pitch, 2)
    }
  })

  it('gives its head to a handoff glance: the thinking look fades while the glance holds, and comes back after it', () => {
    // A thinking face, its dots long since open, glanced at from 20 for GLANCE_HOLD_MS: the rig's heading turns to it.
    const glancing = (s: number): boolean => s >= 20 && s < 21.5
    const heading = 0.5
    const frames = answer(true, () => ({ eyes: ['•', '•'], key: 'thinking' }), (s) => ({ mood: undefined, glancing: glancing(s) }), 18, 23.4, { heading })
    // Looking about before it, as a thinking face does: not where the rig's heading is.
    const before = frames.find((frame) => frame.s >= 19.9)
    expect(Math.abs((before?.pose.yaw ?? heading) - heading)).toBeGreaterThan(0.1)
    // Once the look has faded (HEAD_GLANCE_S), the head is the rig's, turned to the glance, until the glance ends.
    for (const frame of frames.filter((f) => f.s >= 20 + HEAD_GLANCE_S && f.s < 21.5)) expect(frame.pose.yaw, `at ${frame.s.toFixed(3)}`).toBeCloseTo(heading, 9)
    // Never a jump on the way, out or back in: no faster than the look's own glances.
    for (let i = 1; i < frames.length; i += 1) expect(Math.abs((frames[i]?.pose.yaw ?? 0) - (frames[i - 1]?.pose.yaw ?? 0))).toBeLessThan(0.12)
    // And the look comes back after it, its loop run on meanwhile.
    const after = frames.filter((frame) => frame.s >= 21.5 + HEAD_GLANCE_S)
    expect(after.some((frame) => Math.abs(frame.pose.yaw - heading) > 0.1)).toBe(true)
  })
})

describe('a face asked to keep still', () => {
  it('settles to rest once its eyes are open on the change, facing you, and only then may rest', () => {
    for (const screen of [false, true]) {
      const heading = 0.4
      const frames = answer(
        screen,
        (s) => ({ eyes: s < 10 ? ['^', '^'] : ['|', '|'], key: s < 10 ? 'done' : 'idle' }),
        (s) => ({ mood: undefined, glancing: false, resting: s >= 10 }),
        9.5,
        11.5,
        { heading }
      )
      const open = frames.find((frame) => frame.s >= 10 + SWAP_S - 1e-9)?.s ?? Number.NaN
      for (const frame of frames.filter((f) => f.s < open - 1e-9)) {
        // Through the blink, the body holds what it was doing, and does not rest.
        expect(frame.rest, `${screen ? 'screen' : 'plastic'} at ${frame.s.toFixed(3)}`).toBe(0)
        expect(frame.pose.yaw).toBeCloseTo(heading, 12)
      }
      const after = frames.filter((frame) => frame.s >= open - 1e-9)
      // Then it eases round to face you, never back, and is settled only once it does.
      for (let i = 1; i < after.length; i += 1) {
        expect(after[i]?.rest ?? 0).toBeGreaterThanOrEqual(after[i - 1]?.rest ?? 0)
        expect(Math.abs(after[i]?.pose.yaw ?? 0)).toBeLessThanOrEqual(Math.abs(after[i - 1]?.pose.yaw ?? 0) + 1e-12)
      }
      const rested = frames.filter((frame) => frame.s >= open + HEAD_GLANCE_S)
      expect(rested.length).toBeGreaterThan(5)
      for (const frame of rested) {
        expect(frame.rest).toBe(1)
        expect(frame.pose.yaw).toBeCloseTo(0, 12)
        expect(frame.settled).toBe(true)
      }
      // From the moment it is asked to keep still until it faces you, never settled: it may not rest part way round.
      expect(frames.filter((frame) => frame.settled && frame.s >= 10 && frame.s < open + HEAD_GLANCE_S - FRAME)).toHaveLength(0)
    }
  })

  it('wakes on the same rig: its eyes perform the change while it rests, then its body eases back out', () => {
    const heading = 0.4
    const frames = answer(
      true,
      (s) => ({ eyes: s < 10 ? ['|', '|'] : ['•', '•'], key: s < 10 ? 'idle' : 'thinking' }),
      (s) => ({ mood: undefined, glancing: false, resting: s < 10 }),
      9.5,
      11.5,
      { heading, restingAtStart: true }
    )
    // One change, one blink: the bars out and the dots in, under the shut lids.
    expect(blinks(frames as unknown as Frame[])).toHaveLength(1)
    expect(frames.at(-1)?.change.count).toBe(1)
    const open = frames.find((frame) => frame.s >= 10 + SWAP_S - 1e-9)?.s ?? Number.NaN
    // At rest, facing you, until its eyes are open on the dots...
    for (const frame of frames.filter((f) => f.s < open - 1e-9)) {
      expect(frame.rest).toBe(1)
      expect(frame.pose.yaw).toBeCloseTo(0, 12)
    }
    // ...then its own again, easing out, never back.
    const after = frames.filter((frame) => frame.s >= open - 1e-9)
    for (let i = 1; i < after.length; i += 1) expect(after[i]?.rest ?? 1).toBeLessThanOrEqual(after[i - 1]?.rest ?? 1)
    expect(frames.find((frame) => frame.s >= open + HEAD_GLANCE_S)?.rest).toBe(0)
  })

  it('is never settled mid-blink, so it never rests with its eyes half shut', () => {
    const painter = withGlyphEyes(new Canvas() as unknown as CanvasRenderingContext2D, () => ['|', '|'], { ink: '#1a1a2e', screenOf: '#6fb7d6', pixelsPerUnit: 2 })
    const body = bodyConductor(0.4, true, false, true)
    const wants = { mood: undefined, hop: false, glancing: false, resting: true }
    expect(body.frame(10, painter.change(10), rest(), 0, wants).settled).toBe(true)
    expect(body.frame(10 + FRAME, painter.change(10 + FRAME), rest({ blinkL: 0.5, blinkR: 0.5 }), 0, wants).settled).toBe(false)
    expect(body.frame(10 + 2 * FRAME, painter.change(10 + 2 * FRAME), rest(), 0, wants).settled).toBe(true)
  })

  it("draws its eyes' loops at their rest: a resting face never freezes mid-wince", () => {
    const still = film(() => ({ eyes: ['>', '<'] }), 0, 0)[0]?.lit.map((stroke) => stroke.points)
    const resting = film(() => ({ eyes: ['>', '<'] }), 10, 16, 1)
    for (const frame of resting) expect(frame.lit.map((stroke) => stroke.points), `at ${frame.s.toFixed(3)}`).toEqual(still)
    // Moving, the same face winces now and then: what resting holds still.
    const moving = film(() => ({ eyes: ['>', '<'] }), 10, 16)
    expect(moving.some((frame) => JSON.stringify(frame.lit.map((stroke) => stroke.points)) !== JSON.stringify(still))).toBe(true)
  })
})
