import type { BotAvatarPose } from 'bot-avatars'
import { BotAvatarSim, botAvatarJumpDefaults } from 'bot-avatars'
import { describe, expect, it } from 'vitest'

import { CURIOUS_TILT, GLAD_HOP, PERK_LIFT, blinkNow, moodPose, tiltSide } from './components/Bot.js'
import { moodFor } from './components/TeammateBot.js'
import type { FaceActivity } from './faceState.js'

/**
 * A TEAMMATE WEARS HOW IT FEELS (2026-10-05).
 *
 * Colin, of bloub's catalog: "we can take all your suggestions". Waiting on
 * you, the head tips to one side (bloub: "it is the roll that carries
 * curiosity"); a message just in, it perks up; just finished, it smiles with
 * its eyes as it hops, and lands with a bounce. And every change of state is
 * masked by a blink, as each of bloub's is.
 */
const rest = (overrides: Partial<BotAvatarPose> = {}): BotAvatarPose => ({
  yaw: 0.2, pitch: -0.05, roll: 0.03, x: 0, y: 0, sx: 1, sy: 1, eyeOpen: 1, blinkL: 0, blinkR: 0,
  lookX: 0, lookY: 0, breath: 0, laugh: 0, whirl: 0, whirlAngle: 0, w: [1, 0, 0], ...overrides
}) as BotAvatarPose
const none = { curious: 0, perked: 0, glad: 0 }

describe('a mood', () => {
  it('is worn for what a teammate is doing: curious waiting on you, perked as a message lands, glad when done', () => {
    const all: readonly FaceActivity[] = ['thinking', 'working', 'delegating', 'responding', 'waiting', 'receiving', 'blocked', 'done', 'idle']
    expect(Object.fromEntries(all.map((activity) => [activity, moodFor(activity) ?? null]))).toEqual({
      thinking: null, working: null, delegating: null, responding: null, waiting: 'curious', receiving: 'perked', blocked: null, done: 'glad', idle: null
    })
  })

  it('tips a curious head to its own side by the tilt, in proportion to how far the mood has come in', () => {
    for (const side of [1, -1] as const) {
      expect(moodPose(rest(), { ...none, curious: 1 }, side, false).roll).toBeCloseTo(0.03 + side * CURIOUS_TILT)
      expect(moodPose(rest(), { ...none, curious: 0.5 }, side, true).roll).toBeCloseTo(0.03 + side * CURIOUS_TILT * 0.5)
    }
    // About bloub's 15 degrees, a little less on a body.
    expect(CURIOUS_TILT * (180 / Math.PI)).toBeGreaterThan(10)
    expect(CURIOUS_TILT * (180 / Math.PI)).toBeLessThan(15)
  })

  it('tips each teammate the same way every time, and not every teammate the same way', () => {
    const sides = Array.from({ length: 40 }, (_, i) => tiltSide(i / 40 + 0.0123))
    expect(new Set(sides)).toEqual(new Set([1, -1]))
    for (const seed of [0.15, 0.37, 0.81]) expect(tiltSide(seed)).toBe(tiltSide(seed))
  })

  it('lifts a perked head up a little', () => {
    expect(moodPose(rest(), { ...none, perked: 1 }, 1, false).pitch).toBeCloseTo(-0.05 + PERK_LIFT)
    expect(PERK_LIFT).toBeGreaterThan(0)
  })

  it('smiles with the rig\'s own laugh on a face of plastic, lending it the working weight for the eyes alone', () => {
    const glad = moodPose(rest(), { ...none, glad: 1 }, 1, false)
    expect(glad.laugh).toBe(1)
    // The rig draws its laugh in proportion to the working weight: all of it now, and the weights still add to one.
    expect(glad.w[1]).toBeCloseTo(1)
    expect(glad.w.reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1)
    // Half glad, half the way there.
    expect(moodPose(rest(), { ...none, glad: 0.5 }, 1, false).w[1]).toBeCloseTo(0.5)
  })

  it('leaves a screen\'s eyes to its glyphs: `^^` says glad there', () => {
    const glad = moodPose(rest(), { ...none, glad: 1 }, 1, true)
    expect(glad.laugh).toBe(0)
    expect(glad.w).toEqual([1, 0, 0])
  })

  it('wears nothing when it feels nothing, and never changes the rig\'s own pose', () => {
    const pose = rest()
    expect(moodPose(pose, none, 1, false)).toEqual(pose)
    moodPose(pose, { curious: 1, perked: 1, glad: 1 }, -1, false)
    expect(pose).toEqual(rest())
  })
})

describe('a change of state', () => {
  it('blinks the real rig\'s eyes at once', () => {
    const sim = new BotAvatarSim(0.4, 'default')
    // Past any blink the rig had scheduled for its start.
    for (let i = 0; i < 4; i += 1) sim.update(1 / 30)
    const before = Math.max(sim.pose.blinkL, sim.pose.blinkR)
    expect(blinkNow(sim)).toBe(true)
    let deepest = 0
    for (let i = 0; i < 6; i += 1) {
      sim.update(1 / 30)
      deepest = Math.max(deepest, sim.pose.blinkL)
    }
    expect(deepest).toBeGreaterThan(Math.max(0.5, before))
    expect(blinkNow(null)).toBe(false)
  })
})

describe('a glad hop', () => {
  it('lands with the library\'s own bounce and no turn, and the library can put every part of that back', () => {
    expect(GLAD_HOP).toEqual({ spin: 0, squashEase: 'bouncy', riseEase: 'bouncy' })
    for (const key of Object.keys(GLAD_HOP)) expect(botAvatarJumpDefaults).toHaveProperty(key)
    expect(botAvatarJumpDefaults.squashEase).not.toBe('bouncy')
  })
})
