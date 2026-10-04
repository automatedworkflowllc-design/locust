import type { BotAvatarPose } from 'bot-avatars'
import { BotAvatarSim } from 'bot-avatars'
import { describe, expect, it } from 'vitest'

import { SCREEN_SQUASH, screenPose } from './components/Bot.js'

/**
 * A SCREEN KEEPS ITS FACE TO YOU (0.568).
 *
 * Colin, 2026-10-03: "the screen faces are a little janky ... they kind of
 * clip around and go crazy". The rig's working loop spins the body a full
 * turn every third hop and laughs every few seconds; a screen wore both, so
 * it swept to the back of the head and its glyphs squashed and snapped.
 */
const pose = (overrides: Partial<BotAvatarPose>): BotAvatarPose => ({
  yaw: 0, pitch: 0, roll: 0, x: 0, y: 0, sx: 1, sy: 1, eyeOpen: 1, blinkL: 0, blinkR: 0,
  lookX: 0, lookY: 0, breath: 0, laugh: 0, whirl: 0, whirlAngle: 0, w: [1, 0, 0], ...overrides
})

describe('a screen-faced pose', () => {
  it('keeps the heading the rig would have without its spin, its glances and hop included', () => {
    const spinning = pose({ yaw: 0.3 + Math.PI, lookX: 0.4, y: -12, roll: 0.1 })
    const kept = screenPose(spinning, 0.3)
    expect(kept.yaw).toBe(0.3)
    expect(kept.lookX).toBe(0.4)
    expect(kept.y).toBe(-12)
    expect(kept.roll).toBe(0.1)
  })

  it('without a heading to read, turns no further than its screen can show', () => {
    expect(screenPose(pose({ yaw: Math.PI * 0.9 }), undefined).yaw).toBeLessThanOrEqual(0.75)
    expect(screenPose(pose({ yaw: -Math.PI * 0.9 }), undefined).yaw).toBeGreaterThanOrEqual(-0.75)
    expect(screenPose(pose({ yaw: 0.2 + Math.PI * 2 }), undefined).yaw).toBeCloseTo(0.2)
  })

  it('never laughs or whirls, and keeps a little under half of the squash', () => {
    const landing = pose({ laugh: 0.9, whirl: 0.8, sx: 1.16, sy: 0.82 })
    const kept = screenPose(landing, 0)
    expect(kept.laugh).toBe(0)
    expect(kept.whirl).toBe(0)
    expect(kept.sx).toBeCloseTo(1 + 0.16 * SCREEN_SQUASH)
    expect(kept.sy).toBeCloseTo(1 - 0.18 * SCREEN_SQUASH)
    expect(SCREEN_SQUASH).toBeLessThan(0.5)
  })

  it('copies the rig\'s pose and never changes it, so the rig eases from its own last frame', () => {
    const rig = pose({ yaw: 4, laugh: 1, sx: 1.2 })
    screenPose(rig, 0)
    expect(rig).toEqual(pose({ yaw: 4, laugh: 1, sx: 1.2 }))
  })

  it('reads the real rig: through ten seconds of work, a screen never faces away', () => {
    const sim = new BotAvatarSim(0.37, 'working')
    let widest = 0
    let rawWidest = 0
    for (let frame = 0; frame < 600; frame += 1) {
      sim.update(1 / 60)
      const heading = (sim as unknown as { readonly baseYaw: number }).baseYaw
      rawWidest = Math.max(rawWidest, Math.abs(Math.atan2(Math.sin(sim.pose.yaw), Math.cos(sim.pose.yaw))))
      widest = Math.max(widest, Math.abs(screenPose(sim.pose, heading).yaw))
    }
    // The rig itself turns its back (a spin passes through pi); the screen stays facing front.
    expect(rawWidest).toBeGreaterThan(2.5)
    expect(widest).toBeLessThan(0.75)
  })
})
