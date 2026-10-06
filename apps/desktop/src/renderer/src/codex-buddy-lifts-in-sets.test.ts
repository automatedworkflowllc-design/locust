import { describe, expect, it } from 'vitest'

import { REST_ARM, armJoints } from './buddyRig.js'
import type { RigTarget } from './buddyRig.js'
import { LOOK_ABOUT_S, THINKING_CYCLE_S } from './components/Bot.js'
import { IDLE_MOMENTS } from './faceLife.js'
import {
  BUDDY_MOMENTS,
  FLEX,
  LOOKING,
  POSES,
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
  glanceLook,
  momentMove,
  movePoseAt
} from './petRoutines.js'
import type { Move } from './petRoutines.js'

/**
 * HIS LIFTS, IN SETS (2026-10-05), ON HIS OWN RIG.
 *
 * Colin: *"maybe has more lifting animations"*, then *"we can figure out a way
 * to cycle in all his lifting animations as well"*. Working he goes round
 * every lift he has, in sets with a breather after each; at rest his moments
 * are a short set of each in turn. Since his own rig (buddyRig.ts) a move is a
 * pose at every moment, not a row of drawings.
 */

const KEYS = ['idle', 'thinking', 'working', 'delegating', 'responding', 'receiving', 'waiting', 'done', 'blocked', 'idle:noticed', 'idle:listening', 'idle:look']
const MOMENT_KEYS = BUDDY_MOMENTS.map((moment) => `idle:${moment.name}`)
const ALL: readonly Move[] = [WORKOUT, WORKOUT_STANDING, THINK, WAIT, WAVE, FLEX, STUCK, RESTING, ...[...KEYS, ...MOMENT_KEYS].map((key) => buddyMoveFor(key, -1)), buddyMoveFor('idle:look', 1)]

/** Where his hand is, the picture's left or right, for a target. */
const hand = (target: RigTarget, side: -1 | 1): { readonly x: number; readonly y: number; readonly z: number } => armJoints(side < 0 ? target.pose.left : target.pose.right, side, target.pose.dip).hand
const atRest = (target: RigTarget): boolean => JSON.stringify(target) === JSON.stringify(REST)

describe('his moves', () => {
  it('ask only for poses his rig can take: every joint a number, every pass a length', () => {
    for (const move of ALL) {
      for (let t = 0; t <= move.ms; t += 50) {
        const target = move.at(t)
        for (const value of [...Object.values(target.pose.left), ...Object.values(target.pose.right), target.pose.dip, target.look]) expect(Number.isFinite(value), `${move.name} ${String(t)}`).toBe(true)
      }
      expect(move.ms, move.name).toBeGreaterThanOrEqual(0)
    }
  })

  it('working, go round every lift he has, a breather after each', () => {
    expect(WORKOUT.lifts).toEqual(['press', 'curls', 'alternating', 'hammer'])
    expect(WORKOUT.loops).toBe(true)
    const sets = WORKOUT.sets ?? []
    expect(sets).toHaveLength(4)
    // Each set begins after a breather (or the loop's own end, one), standing, the weights at his sides.
    for (const start of sets) expect(atRest(WORKOUT.at((start - 1 + WORKOUT.ms) % WORKOUT.ms)), `before the set at ${String(start)} ms`).toBe(true)
    // Long enough to see, short enough that a long task shows them all: under a minute round.
    expect(WORKOUT.ms).toBeGreaterThan(18_000)
    expect(WORKOUT.ms).toBeLessThan(50_000)
  })

  it('all standing, beside a name or not: no squat, his body never dipping more than a rep’s effort', () => {
    expect(buddyMoveFor('working', undefined, 'subtle')).toBe(WORKOUT_STANDING)
    expect(buddyMoveFor('working', undefined, 'full')).toBe(WORKOUT)
    expect(WORKOUT_STANDING).toBe(WORKOUT)
    for (const move of ALL) for (let t = 0; t < move.ms; t += 20) expect(move.at(t).pose.dip, move.name).toBeLessThan(3.5)
  })

  it('lift in reps: a press goes up over his head and back to his shoulders, three times', () => {
    const [from = 0, to = 0] = WORKOUT.sets ?? []
    let lockouts = 0
    let up = false
    for (let t = from; t < to; t += 10) {
      const y = hand(WORKOUT.at(t), -1).y
      if (!up && y < 60) {
        lockouts += 1
        up = true
      }
      if (y > 78) up = false
    }
    expect(lockouts).toBe(3)
  })

  it('curl toward you: at the top his weight is nearer you than his shoulder, and higher than it hangs', () => {
    const hanging = armJoints(REST_ARM, -1, 0).hand
    const curled = armJoints(POSES.curl, -1, 0).hand
    expect(curled.z).toBeGreaterThan(10)
    expect(curled.y).toBeLessThan(hanging.y - 30)
  })

  it('think in time with the dots: his eyes one way and the other while they look about', () => {
    expect(THINK.ms).toBeCloseTo(2 * THINKING_CYCLE_S * 1000, 6)
    for (const loop of [0, 1]) {
      const lookAt = (s: number): number => movePoseAt(THINK, (loop * THINKING_CYCLE_S + s) * 1000).target.look
      expect(lookAt(LOOK_ABOUT_S * 0.3)).toBeLessThan(-0.5)
      expect(lookAt(LOOK_ABOUT_S * 0.75)).toBeGreaterThan(0.5)
      // While the dots bounce, his eyes ahead and a weight up.
      const busy = movePoseAt(THINK, (loop * THINKING_CYCLE_S + LOOK_ABOUT_S + (THINKING_CYCLE_S - LOOK_ABOUT_S) / 2) * 1000).target
      expect(busy.look).toBe(0)
      expect(Math.min(hand(busy, -1).y, hand(busy, 1).y)).toBeLessThan(115)
    }
  })

  it('finish with a flex, the weights up by his head, then rest', () => {
    expect(buddyMoveFor('done')).toBe(FLEX)
    expect(FLEX.loops).toBe(false)
    const top = movePoseAt(FLEX, FLEX.ms / 2).target
    expect(hand(top, -1).y).toBeLessThan(95)
    expect(hand(top, 1).y).toBeLessThan(95)
    expect(movePoseAt(FLEX, FLEX.ms + 1)).toEqual({ target: REST, settled: true })
  })

  it('get stuck under a press that will not go up, and stay there until someone helps', () => {
    expect(buddyMoveFor('blocked')).toBe(STUCK)
    expect(STUCK.holds).toBe(true)
    // It never gets over his head.
    for (let t = 0; t < STUCK.ms; t += 10) expect(hand(STUCK.at(t), -1).y, String(t)).toBeGreaterThan(70)
    const held = movePoseAt(STUCK, 60_000)
    expect(held.settled).toBe(true)
    expect(held.target).toEqual(STUCK.at(STUCK.ms))
    expect(held.target.pose.dip).toBeGreaterThan(2)
    expect(STUCK.still).toEqual(held.target)
  })

  it('wave at a message, or at your pointer, with one arm, then rest', () => {
    expect(buddyMoveFor('receiving')).toBe(WAVE)
    expect(buddyMoveFor('idle:noticed')).toBe(WAVE)
    let swings = 0
    let last = 0
    let lastSign = 0
    for (let t = 0; t < WAVE.ms; t += 10) {
      const target = WAVE.at(t)
      expect(target.pose.left).toEqual(REST_ARM)
      const x = hand(target, 1).x
      const sign = Math.sign(x - last)
      if (t > 0 && sign !== 0 && lastSign !== 0 && sign !== lastSign) swings += 1
      if (sign !== 0) lastSign = sign
      last = x
    }
    expect(swings).toBeGreaterThanOrEqual(5)
    expect(movePoseAt(WAVE, WAVE.ms + 1)).toEqual({ target: REST, settled: true })
  })

  it('answer each face', () => {
    expect(buddyMoveFor('working')).toBe(WORKOUT)
    expect(buddyMoveFor('delegating')).toBe(WORKOUT)
    expect(buddyMoveFor('responding')).toBe(WORKOUT)
    expect(buddyMoveFor('thinking')).toBe(THINK)
    expect(buddyMoveFor('waiting')).toBe(WAIT)
    expect(buddyMoveFor('idle')).toBe(RESTING)
    expect(buddyMoveFor('idle:listening')).toBe(RESTING)
    expect(movePoseAt(buddyMoveFor('idle:look', -1), 900).target.look).toBe(LOOKING.left)
    expect(movePoseAt(buddyMoveFor('idle:look', 1), 900).target.look).toBe(LOOKING.right)
    expect(glanceLook('left')).toBe(LOOKING.left)
    expect(glanceLook('right')).toBe(LOOKING.right)
    expect(glanceLook('up')).toBeUndefined()
  })
})

describe('a move at a moment', () => {
  it('goes round when it loops, from the set it was begun at', () => {
    const start = WORKOUT.sets?.[3] ?? 0
    expect(movePoseAt(WORKOUT, 0, start)).toEqual({ target: WORKOUT.at(start), settled: false })
    expect(movePoseAt(WORKOUT, WORKOUT.ms + 250, start).target).toEqual(WORKOUT.at(start + 250))
  })

  it('is its still pose on a still face', () => {
    for (const move of ALL) expect(movePoseAt(move, 12_345, 0, true)).toEqual({ target: move.still, settled: true })
  })

  it('is rest, settled, once a move played once is done', () => {
    expect(movePoseAt(RESTING, 0)).toEqual({ target: REST, settled: true })
    expect(movePoseAt(buddyMoveFor('idle:curls'), 60_000)).toEqual({ target: REST, settled: true })
  })
})

describe('his moments at rest', () => {
  it('go round every lift he has, in turn, within one round of moments', () => {
    for (const seed of [0, 0.31, 0.77]) {
      const names = Array.from({ length: BUDDY_MOMENTS.length }, (_, count) => buddyMoment(seed, count).name)
      expect(new Set(names).size).toBe(BUDDY_MOMENTS.length)
      for (const lift of WORKOUT.lifts ?? []) expect(names, lift).toContain(lift)
    }
  })

  it('show only faces a face shows at rest: never busy, never stuck, never the green', () => {
    const shown = new Set([...IDLE_MOMENTS.map((moment) => moment.eyes.join('')), 'oo', '^^', 'cc'])
    for (const moment of BUDDY_MOMENTS) {
      expect(shown.has(moment.eyes.join('')), moment.name).toBe(true)
      expect(['••', '>▮', '><']).not.toContain(moment.eyes.join(''))
    }
  })

  it('last as long as the set they show', () => {
    for (const moment of BUDDY_MOMENTS) {
      const move = momentMove(moment.name)
      if (move === undefined) continue
      expect(moment.seconds * 1000, moment.name).toBeGreaterThanOrEqual(move.ms)
    }
  })
})
