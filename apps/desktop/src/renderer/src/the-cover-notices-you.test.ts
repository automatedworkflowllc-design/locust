import { describe, expect, it } from 'vitest'

import {
  ASLEEP,
  DOZE_AFTER_MS,
  SWARM_FLIGHTS,
  SWARM_MS,
  WAKE_WITHIN,
  flightFrames,
  headingOf,
  hopperWakes,
  widthsFrom
} from './components/HomeCover.js'
import { replaysOnAsk } from './components/PoweredLockup.js'

/**
 * THE TITLE SCREEN NOTICES YOU.
 *
 * Colin's "have fun" list, 2026-09-23, and his answer, "you can run all
 * those": the sleeping Hopper opens its eyes and watches a pointer that comes
 * near, then dozes off again; a click on the glass powers the lockup on
 * again; turning swarm on sends a few small swarm bots up across the screen.
 * What each looks like is checked on the built app (probe-cover-notices);
 * these are the rules.
 */

describe('the Hopper', () => {
  it('sleeps through a pointer far away, costing nothing: the same value back', () => {
    expect(hopperWakes(ASLEEP, WAKE_WITHIN + 2, 1_000)).toBe(ASLEEP)
    expect(hopperWakes(ASLEEP, undefined, 1_000)).toBe(ASLEEP)
  })

  it('wakes when a pointer comes near', () => {
    expect(hopperWakes(ASLEEP, WAKE_WITHIN - 0.1, 1_000)).toEqual({ awake: true, awaySince: undefined })
  })

  it('stays awake a while after the pointer goes, then dozes off', () => {
    const awake = hopperWakes(ASLEEP, 0.5, 1_000)
    const left = hopperWakes(awake, WAKE_WITHIN + 1, 2_000)
    expect(left).toEqual({ awake: true, awaySince: 2_000 })
    // Moving about far away does not restart the count.
    expect(hopperWakes(left, WAKE_WITHIN + 3, 3_000)).toBe(left)
    expect(hopperWakes(left, undefined, 2_000 + DOZE_AFTER_MS - 1)).toBe(left)
    expect(hopperWakes(left, undefined, 2_000 + DOZE_AFTER_MS)).toBe(ASLEEP)
  })

  it('stays awake for a pointer that comes back before it dozes', () => {
    const left = { awake: true, awaySince: 2_000 }
    expect(hopperWakes(left, 0.4, 3_000)).toEqual({ awake: true, awaySince: undefined })
  })

  it('measures from the middle of its box, in its own widths', () => {
    expect(widthsFrom({ left: 100, top: 100, width: 80, height: 80 }, 140, 140)).toBe(0)
    expect(widthsFrom({ left: 100, top: 100, width: 80, height: 80 }, 300, 140)).toBe(2)
  })
})

describe('a click on the glass', () => {
  it('lights it again once it has lit, as the tube allows', () => {
    expect(replaysOnAsk('repeat', 1)).toBe(true)
    expect(replaysOnAsk('once', 1)).toBe(true)
  })

  it('never where the tube never lights -- Off, or reduced motion -- nor before its first lighting', () => {
    expect(replaysOnAsk('none', 3)).toBe(false)
    expect(replaysOnAsk('repeat', 0)).toBe(false)
  })
})

describe('the swarm, turned on', () => {
  it('climbs: every flight goes up and to the right, leaning into it, as the swarm bot is drawn head up', () => {
    for (const flight of SWARM_FLIGHTS) {
      expect(flight.y1).toBeLessThan(flight.y0)
      expect(flight.x1).toBeGreaterThan(flight.x0)
      expect(headingOf(flight)).toBeGreaterThan(30)
      expect(headingOf(flight)).toBeLessThan(60)
    }
  })

  it('is a moment: all of it over in under four seconds', () => {
    expect(SWARM_MS).toBeLessThan(4_000)
    expect(SWARM_FLIGHTS.length).toBeGreaterThanOrEqual(5)
  })

  it('fades in as each one leaves and out as it goes, from its start to its end, at the cover scale', () => {
    const flight = SWARM_FLIGHTS[0]!
    const frames = flightFrames(flight, 0.5)
    expect(frames.every((frame) => Object.keys(frame).every((property) => ['offset', 'opacity', 'transform'].includes(property)))).toBe(true)
    expect(frames.map((frame) => frame.opacity)).toEqual([0, 1, 1, 1, 0])
    const start = `translate(${String(Math.round((flight.x0 - flight.size / 2) * 0.5))}px, ${String(Math.round((flight.y0 - flight.size / 2) * 0.5))}px)`
    const end = `translate(${String(Math.round((flight.x1 - flight.size / 2) * 0.5))}px, ${String(Math.round((flight.y1 - flight.size / 2) * 0.5))}px)`
    expect(String(frames[0]?.transform)).toContain(start)
    expect(String(frames[4]?.transform)).toContain(end)
    expect(String(frames[2]?.transform)).toContain(`rotate(${String(headingOf(flight))}deg)`)
  })
})
