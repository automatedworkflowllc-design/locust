import { describe, expect, it } from 'vitest'

import { BLINK_GAP_S, FLASH_S, PHOSPHOR, SWAP_S, faceChanges, glyphMotion, mixPhosphor } from './components/Bot.js'
import type { EyeGlyphs, GlyphMotion, ShownFace } from './components/Bot.js'
import {
  EYES_REST_S,
  PET_BLINK_S,
  glassUnits,
  lookOf,
  paintGlass,
  paintScreenEyes,
  petBlinkShut,
  petScreenConductor
} from './components/PetSprite.js'
import type { PetScreenAsk } from './components/PetSprite.js'
import { eyeGlyphsFor } from './components/TeammateBot.js'
import { BUDDY_MOMENTS, CHIN_UP, RESTING, STUCK, WORKOUT, buddyMoveFor } from './petRoutines.js'
import type { Beat } from './petRoutines.js'
import { CODEX_BUDDY, screenAt } from './petScreens.js'
import type { ScreenRect } from './petScreens.js'

/**
 * HIS FACE CHANGES AS A BOT'S SCREEN DOES (2026-10-05).
 *
 * The screen on Codex Buddy's face is a bot's: the same eyes (Bot's
 * GLYPH_SHAPES), placed as a bot screen's are, in the same light, and a change
 * performed as a bot performs it (faceChanges, the one both share) -- one
 * blink, the new eyes under the shut lids, they open, and only then does the
 * body answer: here, with his next move. Asked to keep still, he finishes his
 * move, his eyes ease to rest, and his clock may stop.
 */

const FRAME = 1 / 30
/** Two of a glyph's moments, the same to within rounding. */
const sameMotion = (a: GlyphMotion, b: GlyphMotion): void => {
  for (const key of ['dx', 'dy', 'sx', 'sy'] as const) expect(a[key]).toBeCloseTo(b[key], 9)
  expect(a.shown).toBe(b.shown)
}
const at = (cell: { readonly row: number; readonly column: number }): string => `${String(cell.row)},${String(cell.column)}`
const ask = (key: string, extra: Partial<PetScreenAsk> = {}): PetScreenAsk => ({
  eyes: key === 'idle' ? undefined : eyeGlyphsFor(key as Parameters<typeof eyeGlyphsFor>[0]),
  phosphor: key === 'waiting' ? 'amber' : key === 'blocked' ? 'red' : 'cyan',
  ...(key === 'done' ? { flash: 'green' as const } : {}),
  key,
  move: buddyMoveFor(key),
  rests: key === 'idle' || key === 'blocked',
  ...extra
})

/** A face of his on a clock, asked for what `now` holds. */
function buddy(start: PetScreenAsk, seed = 0.3): { asking: { now: PetScreenAsk; turned?: 'left' | 'right' }; frame: (s: number) => ReturnType<ReturnType<typeof petScreenConductor>['frame']> } {
  const asking: { now: PetScreenAsk; turned?: 'left' | 'right' } = { now: start }
  const conductor = petScreenConductor(CODEX_BUDDY, seed, () => asking.now, () => asking.turned)
  return { asking, frame: conductor.frame }
}

describe('a change', () => {
  it('shuts his eyes, brings the new ones in under the lids, opens them, and only then moves his body', () => {
    const face = buddy(ask('idle'))
    let s = 100
    expect(at(face.frame(s).cell)).toBe('0,0')
    face.asking.now = ask('working')
    const began = s + FRAME
    let opened: number | undefined
    for (s = began; s < began + 1; s += FRAME) {
      const now = face.frame(s)
      const p = (s - began) / SWAP_S
      if (p < 0.5) {
        // Shutting on the old eyes.
        expect(now.pair.join(''), `p ${p.toFixed(2)}`).toBe('||')
        if (p > 0) expect(now.squash).toBeLessThan(1)
      } else if (p < 1) {
        // The new eyes, under lids that open.
        expect(now.pair.join('')).toBe('>▮')
      }
      if (p < 1) {
        // His body holds where it was until his eyes are open.
        expect(at(now.cell), `p ${p.toFixed(2)}`).toBe('0,0')
      } else if (at(now.cell) !== '0,0') {
        opened ??= s
      }
    }
    // Then his workout, from the lift his seed picks.
    expect(opened).toBeDefined()
    expect((opened ?? 0) - began).toBeGreaterThanOrEqual(SWAP_S - 1e-9)
    expect((opened ?? 0) - began).toBeLessThan(SWAP_S + 2 * FRAME)
    expect(face.frame(began + 1).move).toBe('workout')
  })

  it('flashes a finish green as his new eyes come in, never on the old ones, and fades back', () => {
    const face = buddy(ask('working'))
    face.frame(100)
    face.asking.now = ask('done')
    const began = 100 + FRAME
    for (let s = began; s < began + SWAP_S / 2 - 1e-6; s += FRAME / 4) {
      const now = face.frame(s)
      expect(now.pair.join('')).toBe('>▮')
      expect(now.light.lit).toBe(PHOSPHOR.cyan.lit)
    }
    const arriving = face.frame(began + SWAP_S / 2 + 0.01)
    expect(arriving.pair.join('')).toBe('^^')
    expect(arriving.light.lit).toBe(mixPhosphor(PHOSPHOR.green.lit, PHOSPHOR.cyan.lit, 0))
    expect(face.frame(began + SWAP_S / 2 + FLASH_S + 0.05).light.lit).toBe(PHOSPHOR.cyan.lit)
    // And he chins up once his eyes are open.
    expect(face.frame(began + SWAP_S + 0.05).move).toBe(CHIN_UP.name)
  })

  it('is his at once on a still face: the move’s still drawing, its eyes at rest, settled', () => {
    for (const key of ['idle', 'thinking', 'working', 'waiting', 'done', 'blocked', 'receiving']) {
      const face = buddy(ask('idle'))
      face.frame(0)
      face.asking.now = ask(key)
      const now = face.frame(0)
      expect(at(now.cell), key).toBe(at(buddyMoveFor(key).still))
      expect(now.squash, key).toBe(1)
      expect(now.settled, key).toBe(true)
      sameMotion(now.motions[0], glyphMotion(now.pair.join(''), 0, 0))
    }
  })
})

describe('asked to keep still', () => {
  it('he finishes his move, his eyes ease to rest, and he is settled: stuck under the bar', () => {
    const face = buddy(ask('working'))
    face.frame(100)
    face.asking.now = ask('blocked')
    let settledAt: number | undefined
    for (let s = 100 + FRAME; s < 106; s += FRAME) {
      const now = face.frame(s)
      if (now.settled) {
        settledAt ??= s
        expect(at(now.cell)).toBe('5,6')
      } else {
        settledAt = undefined
      }
    }
    const playing = SWAP_S + STUCK.beats.reduce((sum, beat) => sum + beat.ms, 0) / 1000
    expect(settledAt).toBeDefined()
    expect((settledAt ?? 0) - 100).toBeGreaterThanOrEqual(playing + EYES_REST_S - 2 * FRAME)
    // Settled, nothing on him changes: his eyes at their loop's rest.
    const last = face.frame(106)
    sameMotion(last.motions[0], glyphMotion('><', 0, 0))
    expect(last.squash).toBe(1)
  })

  it('at rest he does not blink on his own; moving, he does', () => {
    const resting = buddy(ask('idle'))
    const moving = buddy(ask('working'))
    let restingBlinks = 0
    let movingBlinks = 0
    for (let s = 100; s < 130; s += FRAME) {
      if (resting.frame(s).squash < 1) restingBlinks += 1
      if (moving.frame(s).squash < 1) movingBlinks += 1
    }
    expect(restingBlinks).toBe(0)
    expect(movingBlinks).toBeGreaterThan(0)
  })
})

describe('his workout', () => {
  it('starts each time from the next lift', () => {
    const face = buddy(ask('idle'), 0.62)
    // Each set's lift, by the drawings in it.
    const liftOf = (start: number, end: number): string => [...new Set(WORKOUT.beats.slice(start, end).map(at))].sort().join(' ')
    const sets = WORKOUT.sets ?? []
    const lifts = sets.map((start, i) => liftOf(start, sets[i + 1] ?? WORKOUT.beats.length))
    const begun: number[] = []
    let s = 100
    face.frame(s)
    for (let round = 0; round < 3; round += 1) {
      face.asking.now = ask('working')
      // His first drawing of work, once his eyes are open: the first of a set.
      let first: string | undefined
      for (const until = s + 1; s < until; s += FRAME) {
        const now = face.frame(s)
        if (now.move === 'workout' && first === undefined) first = at(now.cell)
      }
      begun.push(lifts.findIndex((lift, i) => lift.split(' ').includes(first ?? '') && WORKOUT.beats[sets[i] ?? 0] !== undefined && at(WORKOUT.beats[sets[i] ?? 0] as Beat) === first))
      face.asking.now = ask('idle')
      for (const until = s + 2; s < until; s += FRAME) face.frame(s)
    }
    // Three sets in turn, each the one after the last.
    expect(begun.every((set) => set >= 0)).toBe(true)
    expect(begun[1]).toBe(((begun[0] ?? 0) + 1) % sets.length)
    expect(begun[2]).toBe(((begun[0] ?? 0) + 2) % sets.length)
  })
})

describe('a glance at a teammate', () => {
  it('turns him that way while it lasts, and he is not settled while it does', () => {
    const face = buddy(ask('idle'))
    for (let s = 100; s < 101; s += FRAME) face.frame(s)
    face.asking.turned = 'left'
    const turned = face.frame(101)
    expect(at(turned.cell)).toBe('2,6')
    expect(turned.look).toBe(-1)
    expect(turned.settled).toBe(false)
    face.asking.turned = 'right'
    expect(at(face.frame(101.5).cell)).toBe('1,6')
    face.asking.turned = undefined
    expect(at(face.frame(102).cell)).toBe('0,0')
  })
})

describe('his own blinks', () => {
  it('come no sooner after a change than a bot’s, and no more than 5 s apart', () => {
    for (const seed of [0, 0.4, 0.93]) {
      const shut: number[] = []
      for (let s = 50; s < 120; s += 0.01) {
        if (petBlinkShut(s, 50, seed) > 0.5) shut.push(s)
      }
      const blinks = shut.filter((s, i) => i === 0 || s - (shut[i - 1] ?? 0) > PET_BLINK_S)
      expect(blinks.length).toBeGreaterThan(10)
      expect((blinks[0] ?? 0) - 50).toBeGreaterThanOrEqual(BLINK_GAP_S)
      for (let i = 1; i < blinks.length; i += 1) {
        const gap = (blinks[i] ?? 0) - (blinks[i - 1] ?? 0)
        expect(gap).toBeGreaterThanOrEqual(BLINK_GAP_S - 0.02)
        expect(gap).toBeLessThanOrEqual(5.02)
      }
    }
  })

  it('are none on a still face, and the same every time', () => {
    expect(petBlinkShut(0, 0, 0.5)).toBe(0)
    expect(petBlinkShut(4321.234, 12, 0.5)).toBe(petBlinkShut(4321.234, 12, 0.5))
  })
})

/** A canvas that records the paths it is asked to stroke and fill: their points where they land, and their weights. */
class Canvas {
  fillStyle: unknown = '#000'
  strokeStyle: unknown = '#000'
  lineWidth = 1
  lineCap = 'butt'
  lineJoin = 'miter'
  shadowColor = ''
  shadowBlur = 0
  globalAlpha = 1
  private origin: [number, number] = [0, 0]
  private stack: [number, number][] = []
  private points: [number, number][] = []
  strokes: { readonly width: number; readonly points: readonly [number, number][] }[] = []
  fills: { readonly style: unknown; readonly points: readonly [number, number][] }[] = []
  save(): void {
    this.stack.push([...this.origin])
  }
  restore(): void {
    this.origin = this.stack.pop() ?? [0, 0]
  }
  translate(x: number, y: number): void {
    this.origin = [this.origin[0] + x, this.origin[1] + y]
  }
  beginPath(): void {
    this.points = []
  }
  moveTo(x: number, y: number): void {
    this.points.push([this.origin[0] + x, this.origin[1] + y])
  }
  lineTo(x: number, y: number): void {
    this.moveTo(x, y)
  }
  arcTo(x1: number, y1: number): void {
    this.moveTo(x1, y1)
  }
  ellipse(x: number, y: number, rx: number, ry: number): void {
    for (const [dx, dy] of [[rx, 0], [-rx, 0], [0, ry], [0, -ry]] as const) this.moveTo(x + dx, y + dy)
  }
  closePath(): void {}
  clip(): void {}
  fill(): void {
    this.fills.push({ style: this.fillStyle, points: [...this.points] })
  }
  stroke(): void {
    this.strokes.push({ width: this.lineWidth, points: [...this.points] })
  }
  fillRect(): void {}
  createLinearGradient(): { addColorStop: () => void } {
    return { addColorStop: () => undefined }
  }
}

describe('his screen, drawn', () => {
  /** His glass on a drawing, in canvas pixels at a size: as the canvas fits him by his height. */
  const glassAt = (row: number, column: number, size: number): ScreenRect => {
    const rect = screenAt(CODEX_BUDDY, row, column) as ScreenRect
    const k = size / 208
    return { x: (size - (size * 192) / 208) / 2 + rect.x * k, y: rect.y * k, w: rect.w * k, h: rect.h * k }
  }
  const pairs: EyeGlyphs[] = [['|', '|'], ['•', '•'], ['>', '▮'], ['^', '^'], ['o', 'o'], ['>', '<'], ['c', 'c'], ...BUDDY_MOMENTS.map((moment) => moment.eyes)]

  it('keeps every eye inside its glass, however it moves and wherever he faces, on every drawing', () => {
    const outside: string[] = []
    let drawn = 0
    for (const [row, counts] of CODEX_BUDDY.counts.entries()) {
      for (let column = 0; column < counts; column += 1) {
        const glass = glassAt(row, column, 96)
        for (const pair of pairs) {
          for (const t of [0, 0.4, 1.1, 2.3, 2.6, 3.1, 3.9]) {
            const canvas = new Canvas()
            const motions: readonly [GlyphMotion, GlyphMotion] = [glyphMotion(pair.join(''), 0, t), glyphMotion(pair.join(''), 1, t)]
            paintScreenEyes(canvas as unknown as CanvasRenderingContext2D, glass, pair, motions, 1, 1, PHOSPHOR.cyan, lookOf(row))
            for (const stroke of canvas.strokes) {
              drawn += 1
              const half = stroke.width / 2
              for (const [x, y] of stroke.points) {
                if (x - half < glass.x - 0.01 || x + half > glass.x + glass.w + 0.01 || y - half < glass.y - 0.01 || y + half > glass.y + glass.h + 0.01) {
                  outside.push(`${String(row)},${String(column)} ${pair.join('')} at ${String(t)}`)
                }
              }
            }
          }
        }
      }
    }
    expect(drawn).toBeGreaterThan(5000)
    expect(outside.slice(0, 5)).toEqual([])
  })

  it('draws his eyes as a bot screen’s, sized to the glass in the units a bot’s screen has', () => {
    const glass = glassAt(0, 0, 96)
    const canvas = new Canvas()
    paintScreenEyes(canvas as unknown as CanvasRenderingContext2D, glass, ['|', '|'], [glyphMotion('||', 0, 0), glyphMotion('||', 1, 0)], 1, 1, PHOSPHOR.cyan, 0)
    expect(canvas.strokes).toHaveLength(2)
    // Two bars, one each side of the glass's middle, the same height.
    const [left, right] = canvas.strokes.map((stroke) => stroke.points)
    const middle = glass.x + glass.w / 2
    expect(Math.max(...(left ?? []).map(([x]) => x))).toBeLessThan(middle)
    expect(Math.min(...(right ?? []).map(([x]) => x))).toBeGreaterThan(middle)
    // Its glass is a bot screen's width in face units (EYES_VISOR's 54).
    expect(glassUnits(glass) * glass.w).toBeCloseTo(54, 6)
  })

  it('puts his ink round the glass first, then the glass inside it', () => {
    const glass = glassAt(0, 0, 96)
    const canvas = new Canvas()
    paintGlass(canvas as unknown as CanvasRenderingContext2D, glass, CODEX_BUDDY, 1, 1 / glassUnits(glass))
    expect(canvas.fills[0]?.style).toBe(CODEX_BUDDY.ink)
    const xs = (points: readonly [number, number][]): readonly number[] => points.map(([x]) => x)
    expect(Math.min(...xs(canvas.fills[0]?.points ?? []))).toBeLessThan(Math.min(...xs(canvas.fills[1]?.points ?? [])))
    expect(Math.max(...xs(canvas.fills[0]?.points ?? []))).toBeGreaterThan(Math.max(...xs(canvas.fills[1]?.points ?? [])))
  })
})

describe('one way a face changes', () => {
  it('is the bots’ and his: faceChanges, read frame by frame', () => {
    let wanted: ShownFace = { pair: ['|', '|'], tone: 'cyan', key: 'idle' }
    const changes = faceChanges(() => wanted, () => undefined)
    expect(changes.at(10).open).toBe(true)
    wanted = { pair: ['>', '▮'], tone: 'cyan', key: 'working' }
    const shutting = changes.at(10 + FRAME)
    expect(shutting.open).toBe(false)
    expect(changes.coming()?.key).toBe('working')
    expect(changes.shown().key).toBe('idle')
    const open = changes.at(10 + FRAME + SWAP_S + 0.001)
    expect(open.open).toBe(true)
    expect(open.since).toBeCloseTo(10 + FRAME + SWAP_S, 9)
    expect(changes.shown().key).toBe('working')
    expect(open.count).toBe(1)
  })

  it('rests his eyes as it rests a still bot’s: a still face changes at once', () => {
    let wanted: ShownFace = { pair: undefined, tone: 'cyan', key: 'idle' }
    const changes = faceChanges(() => wanted, () => 'green')
    wanted = { pair: ['^', '^'], tone: 'cyan', key: 'done' }
    const still = changes.at(0)
    expect(still).toMatchObject({ open: true, shut: 0, quiet: true, since: 0, eyes: ['^', '^'] })
    expect(changes.flash()).toBeUndefined()
    expect(RESTING.beats).toHaveLength(1)
  })
})
