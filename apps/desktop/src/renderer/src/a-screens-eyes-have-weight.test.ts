import { describe, expect, it } from 'vitest'

import { LAG_REST, stepLag } from './components/Bot.js'
import type { Lag } from './components/Bot.js'

/**
 * A SCREEN'S EYES HAVE WEIGHT (0.574).
 *
 * Colin, 2026-10-03: "it just still kind of looks janky and needs work with
 * the physics". The eyes on a screen moved as one piece with the body; now
 * they trail its hops and turns by a unit or two and spring back.
 */

const STEP = 1 / 60

/** A hop as the rig makes it: up 12 units and down again over 0.4 s, then still. Returns the lag at each frame. */
function throughAHop(seconds: number, step = STEP): Lag[] {
  const frames: Lag[] = []
  let lag = LAG_REST
  let lastY = 0
  let lastV = 0
  for (let t = step; t <= seconds; t += step) {
    const y = t < 0.4 ? -12 * Math.sin((t / 0.4) * Math.PI) : 0
    const v = (y - lastY) / step
    lag = stepLag(lag, step, 0, v - lastV)
    lastY = y
    lastV = v
    frames.push(lag)
  }
  return frames
}

describe("a screen's eyes", () => {
  it('trail a hop: they sink as the body takes off, float while it is in the air, and sink again as it lands', () => {
    const frames = throughAHop(1.2)
    // Down is +y: left behind by the take-off, carried up as the body slows in the air, carried on down at the landing.
    expect(Math.max(...frames.slice(0, 6).map((lag) => lag.y))).toBeGreaterThan(0.5)
    expect(Math.min(...frames.slice(8, 22).map((lag) => lag.y))).toBeLessThan(-0.3)
    expect(Math.max(...frames.slice(24, 34).map((lag) => lag.y))).toBeGreaterThan(0.5)
  })

  it('settle within half a second of the body coming to rest', () => {
    const frames = throughAHop(1.2)
    const after = frames.slice(Math.round(0.9 / STEP))
    for (const lag of after) expect(Math.abs(lag.y)).toBeLessThan(0.05)
  })

  it('never trail by more than three units, however hard the body moves', () => {
    let lag = LAG_REST
    for (let i = 0; i < 120; i += 1) {
      lag = stepLag(lag, STEP, i % 2 === 0 ? 900 : -900, i % 3 === 0 ? -900 : 900)
      expect(Math.abs(lag.x)).toBeLessThanOrEqual(3)
      expect(Math.abs(lag.y)).toBeLessThanOrEqual(3)
    }
  })

  /*
   * AT THE SIDE (0.673). A face in the sidebar or a header is drawn 15 times a second (0.654), and its eyes are
   * stepped as it is drawn. Colin, 2026-10-06: "wrens eyes are violently shaking in the top and side bar". Stepped
   * a 15th of a second at once, the spring swung the eyes from one end of their room to the other every frame.
   */
  it('at the side, drawn 15 times a second, settle just the same and never swing frame to frame', () => {
    const frames = throughAHop(1.2, 1 / 15)
    for (const lag of frames.slice(Math.round(0.9 * 15))) expect(Math.abs(lag.y)).toBeLessThan(0.05)
    // A swing is a frame that reverses the one before by more than a unit: none, at any time.
    for (let i = 2; i < frames.length; i += 1) {
      const before = frames[i - 1]!.y - frames[i - 2]!.y
      const now = frames[i]!.y - frames[i - 1]!.y
      expect(before * now < 0 && Math.abs(now) > 1 && Math.abs(before) > 1).toBe(false)
    }
  })

  it('at the side, never pinned at the end of their room after the body is still', () => {
    let lag = stepLag(LAG_REST, 1 / 15, 0, 40)
    for (let i = 0; i < 30; i += 1) lag = stepLag(lag, 1 / 15, 0, 0)
    expect(Math.abs(lag.y)).toBeLessThan(0.05)
  })

  it('drawn 30 or 60 times a second, take the same path as before: one step each', () => {
    const at30 = stepLag({ x: 1, y: -1, vx: 2, vy: -2 }, 1 / 30, 5, -5)
    const vy = -2 + (-260 * -1 - 22 * -2) * (1 / 30) - -5 * 0.35
    expect(at30.vy).toBeCloseTo(vy, 10)
    expect(at30.y).toBeCloseTo(-1 + vy / 30, 10)
  })

  it('sit where they are put while the body moves at a steady speed', () => {
    let lag = LAG_REST
    for (let i = 0; i < 60; i += 1) lag = stepLag(lag, STEP, 0, 0)
    expect(lag).toEqual(LAG_REST)
  })
})
