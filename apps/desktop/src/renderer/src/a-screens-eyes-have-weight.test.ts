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
function throughAHop(seconds: number): Lag[] {
  const frames: Lag[] = []
  let lag = LAG_REST
  let lastY = 0
  let lastV = 0
  for (let t = STEP; t <= seconds; t += STEP) {
    const y = t < 0.4 ? -12 * Math.sin((t / 0.4) * Math.PI) : 0
    const v = (y - lastY) / STEP
    lag = stepLag(lag, STEP, 0, v - lastV)
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

  it('sit where they are put while the body moves at a steady speed', () => {
    let lag = LAG_REST
    for (let i = 0; i < 60; i += 1) lag = stepLag(lag, STEP, 0, 0)
    expect(lag).toEqual(LAG_REST)
  })
})
