import { describe, expect, it } from 'vitest'

import { EFFORT_TRACK_WIDTH, heldAt, nearestStop, stopPosition } from './components/EffortSlider.js'

/**
 * THE POINTER HOLDS THE EFFORT THUMB.
 *
 * Colin, 2026-09-23: "our effort slide is a little wonky and responds a
 * little oddly compared to claudes, lets also make sure this gooey effect ...
 * is used". Measured on 0.300 (probe-effort-slider): dragged, the thumb sat up
 * to 32px from the pointer, jumping from stop to stop, and the fill ran up to
 * 38px from it; with nothing moving smoothly, the liquid under the thumb had
 * nothing to trail. Now the thumb follows the pointer, as the gooey page's
 * slider does, and lets go onto the nearest stop. These are the two rules
 * that takes; the feel is measured on the built app.
 */

describe('a held thumb', () => {
  it('is where the pointer is along the track', () => {
    expect(heldAt(100 + 90, 100)).toBe(90)
  })

  it('never leaves the stops: before the first or past the last it waits at the end', () => {
    expect(heldAt(100 - 40, 100)).toBe(stopPosition(0, 4))
    expect(heldAt(100 + EFFORT_TRACK_WIDTH + 40, 100)).toBe(stopPosition(3, 4))
  })
})

describe('letting go', () => {
  it('settles on the nearest stop, whichever side of it the thumb is', () => {
    const between = (stopPosition(1, 4) + stopPosition(2, 4)) / 2
    expect(nearestStop(stopPosition(1, 4), 4)).toBe(1)
    expect(nearestStop(between - 1, 4)).toBe(1)
    expect(nearestStop(between + 1, 4)).toBe(2)
    expect(nearestStop(stopPosition(3, 4), 4)).toBe(3)
  })

  it('never names a stop that is not there', () => {
    expect(nearestStop(-50, 4)).toBe(0)
    expect(nearestStop(EFFORT_TRACK_WIDTH + 50, 4)).toBe(3)
    expect(nearestStop(80, 1)).toBe(0)
  })
})
