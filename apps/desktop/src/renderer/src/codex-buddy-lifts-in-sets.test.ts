import { describe, expect, it } from 'vitest'

import { LOOK_ABOUT_S, THINKING_CYCLE_S } from './components/Bot.js'
import { IDLE_MOMENTS } from './faceLife.js'
import {
  BUDDY_MOMENTS,
  CHIN_UP,
  LOOKING,
  REST,
  RESTING,
  STUCK,
  THINK,
  WAIT,
  WAVE,
  WORKOUT,
  WORKOUT_STANDING,
  buddyMoment,
  buddyMoveFor,
  glanceBeat,
  moveCellAt,
  moveMs
} from './petRoutines.js'
import type { Beat, Move } from './petRoutines.js'
import { CODEX_BUDDY, screenAt } from './petScreens.js'

/**
 * HIS LIFTS, IN SETS (2026-10-05).
 *
 * Colin: *"maybe has more lifting animations"*, then *"we can figure out a way
 * to cycle in all his lifting animations as well"*. Each of his rows played
 * round and round for one state is gone: his drawings are read as reps, in
 * sets, and working he goes round every lift he has; at rest his moments are
 * a short set of each in turn.
 */

const at = (beat: Beat): string => `${String(beat.row)},${String(beat.column)}`
const KEYS = ['idle', 'thinking', 'working', 'delegating', 'responding', 'receiving', 'waiting', 'done', 'blocked', 'idle:noticed', 'idle:listening', 'idle:look']
const MOMENT_KEYS = BUDDY_MOMENTS.map((moment) => `idle:${moment.name}`)
const ALL: readonly Move[] = [WORKOUT, WORKOUT_STANDING, THINK, WAIT, WAVE, CHIN_UP, STUCK, RESTING, ...[...KEYS, ...MOMENT_KEYS].map((key) => buddyMoveFor(key, -1)), buddyMoveFor('idle:look', 1)]

/** Which lift a drawing is, by the row and column his maker drew it in. */
function liftOf(beat: Beat): string | undefined {
  if (beat.row === 7) return 'press'
  if (beat.row === 8 && beat.column >= 1 && beat.column <= 4) return 'curls'
  if (beat.row === 6 && beat.column === 2) return 'squats'
  if (beat.row === 6 && beat.column >= 3) return 'hammer'
  if (beat.row === 5) return 'bench'
  if (beat.row === 4) return 'pull-ups'
  if (beat.row === 1 || beat.row === 2) return 'carry'
  return undefined
}

describe('his moves', () => {
  it('are made of his own drawings, each with a screen on it', () => {
    for (const move of ALL) {
      for (const beat of [...move.beats, move.still]) {
        expect(beat.row, `${move.name} ${at(beat)}`).toBeLessThan(CODEX_BUDDY.counts.length)
        expect(beat.column, `${move.name} ${at(beat)}`).toBeLessThan(CODEX_BUDDY.counts[beat.row] ?? 0)
        expect(screenAt(CODEX_BUDDY, beat.row, beat.column), `${move.name} ${at(beat)}`).toBeDefined()
      }
    }
    expect(screenAt(CODEX_BUDDY, REST.row, REST.column)).toBeDefined()
  })

  it('working, go round every lift he has, a breather after each', () => {
    const lifts = new Set(WORKOUT.beats.map(liftOf).filter((lift) => lift !== undefined))
    expect(lifts).toEqual(new Set(['press', 'curls', 'squats', 'hammer', 'bench', 'pull-ups', 'carry']))
    expect(WORKOUT.loops).toBe(true)
    // Each set begins after a breather (or the loop's own end, one), standing, the dumbbells at his sides.
    const sets = WORKOUT.sets ?? []
    expect(sets).toHaveLength(7)
    for (const start of sets) {
      const before = WORKOUT.beats[(start - 1 + WORKOUT.beats.length) % WORKOUT.beats.length] as Beat
      expect(at(before), `before the set at beat ${String(start)}`).toBe('8,0')
    }
    // Long enough to see, short enough that a long task shows them all: about half a minute round.
    expect(moveMs(WORKOUT)).toBeGreaterThan(20_000)
    expect(moveMs(WORKOUT)).toBeLessThan(35_000)
  })

  it('beside a name, keep to the lifts he does standing, so he stays where he stands', () => {
    expect(buddyMoveFor('working', undefined, 'subtle')).toBe(WORKOUT_STANDING)
    expect(buddyMoveFor('responding', undefined, 'subtle')).toBe(WORKOUT_STANDING)
    expect(buddyMoveFor('working', undefined, 'full')).toBe(WORKOUT)
    const lifts = new Set(WORKOUT_STANDING.beats.map(liftOf).filter((lift) => lift !== undefined))
    expect(lifts).toEqual(new Set(['press', 'curls', 'hammer']))
    // Never on the bench, at the bar, squatting or walking.
    expect(WORKOUT_STANDING.beats.some((beat) => [1, 2, 4, 5].includes(beat.row) || (beat.row === 6 && beat.column === 2))).toBe(false)
  })

  it('lift in reps: a press goes up, locks out, and comes down again', () => {
    const press = WORKOUT.beats.slice(WORKOUT.sets?.[0] ?? 0, WORKOUT.sets?.[1] ?? 0).map(at)
    // Up from the chest, pressed, locked out, pressed, back to the shoulders: three times.
    expect(press.filter((cell) => cell === '7,3')).toHaveLength(3)
    expect(press[0]).toBe('7,0')
    expect(press.at(-2)).toBe('7,5')
  })

  it('think in time with the dots: turned one way and the other while they look about', () => {
    expect(moveMs(THINK)).toBeCloseTo(2 * THINKING_CYCLE_S * 1000, 6)
    for (const loop of [0, 1]) {
      for (const t of [0.05, LOOK_ABOUT_S / 2 - 0.05, LOOK_ABOUT_S / 2 + 0.05, LOOK_ABOUT_S - 0.05]) {
        const cell = moveCellAt(THINK, (loop * THINKING_CYCLE_S + t) * 1000)
        expect([1, 2], `${String(loop)} ${String(t)}`).toContain(cell.row)
      }
      const bouncing = moveCellAt(THINK, (loop * THINKING_CYCLE_S + LOOK_ABOUT_S + 0.1) * 1000)
      expect([1, 2]).not.toContain(bouncing.row)
    }
  })

  it('finish with one chin-up, held over the bar, then rest', () => {
    expect(CHIN_UP.loops).toBe(false)
    const longest = CHIN_UP.beats.reduce((most, beat) => (beat.ms > most.ms ? beat : most))
    expect(at(longest)).toBe('4,2')
    expect(moveCellAt(CHIN_UP, moveMs(CHIN_UP) + 1)).toMatchObject({ row: 0, column: 0, settled: true })
  })

  it('get stuck under the bench press’s bar, and stay there until someone helps', () => {
    expect(STUCK.holds).toBe(true)
    expect(STUCK.beats.every((beat) => beat.row === 5)).toBe(true)
    expect(moveCellAt(STUCK, 60_000)).toMatchObject({ row: 5, column: 6, settled: true })
    expect(at(STUCK.still)).toBe('5,6')
  })

  it('wave at a message, or at your pointer, then rest', () => {
    expect(buddyMoveFor('receiving')).toBe(WAVE)
    expect(buddyMoveFor('idle:noticed')).toBe(WAVE)
    expect(WAVE.beats.every((beat) => beat.row === 3)).toBe(true)
    expect(moveCellAt(WAVE, moveMs(WAVE) + 1)).toMatchObject({ row: 0, column: 0, settled: true })
  })

  it('answer each face', () => {
    expect(buddyMoveFor('working')).toBe(WORKOUT)
    expect(buddyMoveFor('delegating')).toBe(WORKOUT)
    expect(buddyMoveFor('responding')).toBe(WORKOUT)
    expect(buddyMoveFor('thinking')).toBe(THINK)
    expect(buddyMoveFor('waiting')).toBe(WAIT)
    expect(buddyMoveFor('done')).toBe(CHIN_UP)
    expect(buddyMoveFor('blocked')).toBe(STUCK)
    expect(buddyMoveFor('idle')).toBe(RESTING)
    expect(buddyMoveFor('idle:listening')).toBe(RESTING)
    expect(at(buddyMoveFor('idle:look', -1).beats[0] as Beat)).toBe(at(LOOKING.left))
    expect(at(buddyMoveFor('idle:look', 1).beats[0] as Beat)).toBe(at(LOOKING.right))
    expect(glanceBeat('left')).toBe(LOOKING.left)
    expect(glanceBeat('up')).toBeUndefined()
  })
})

describe('a move at a moment', () => {
  it('goes round when it loops, from the set it was begun at', () => {
    const start = WORKOUT.sets?.[3] ?? 0
    expect(moveCellAt(WORKOUT, 0, start)).toMatchObject({ row: (WORKOUT.beats[start] as Beat).row, column: (WORKOUT.beats[start] as Beat).column, settled: false })
    const round = moveMs(WORKOUT)
    expect(moveCellAt(WORKOUT, round + 1, start)).toMatchObject({ row: (WORKOUT.beats[start] as Beat).row, column: (WORKOUT.beats[start] as Beat).column })
  })

  it('is its still drawing on a still face', () => {
    for (const move of ALL) expect(moveCellAt(move, 12_345, 0, true)).toMatchObject({ row: move.still.row, column: move.still.column, settled: true })
  })

  it('is rest, settled, once a move played once is done', () => {
    expect(moveCellAt(RESTING, 0)).toMatchObject({ row: 0, column: 0, settled: true })
    expect(moveCellAt(buddyMoveFor('idle:curls'), 60_000)).toMatchObject({ row: 0, column: 0, settled: true })
  })
})

describe('his moments at rest', () => {
  it('go round every lift he has, in turn, within one round of moments', () => {
    for (const seed of [0, 0.31, 0.77]) {
      const names = Array.from({ length: BUDDY_MOMENTS.length }, (_, count) => buddyMoment(seed, count).name)
      expect(new Set(names).size).toBe(BUDDY_MOMENTS.length)
      const lifts = new Set(names.flatMap((name) => buddyMoveFor(`idle:${name}`, 1).beats.map(liftOf)).filter((lift) => lift !== undefined))
      expect(lifts).toEqual(new Set(['press', 'curls', 'squats', 'hammer', 'bench', 'pull-ups', 'carry']))
    }
  })

  it('show only faces a face shows at rest: never busy, never stuck, never the green', () => {
    const atRest = new Set([...IDLE_MOMENTS.map((moment) => moment.eyes.join('')), 'oo', '^^', 'cc'])
    for (const moment of BUDDY_MOMENTS) {
      expect(atRest.has(moment.eyes.join('')), moment.name).toBe(true)
      expect(['••', '>▮', '><']).not.toContain(moment.eyes.join(''))
    }
  })

  it('last as long as the set they show', () => {
    for (const moment of BUDDY_MOMENTS) {
      const move = buddyMoveFor(`idle:${moment.name}`, 1)
      expect(moment.seconds * 1000, moment.name).toBeGreaterThanOrEqual(moveMs(move))
    }
  })
})
