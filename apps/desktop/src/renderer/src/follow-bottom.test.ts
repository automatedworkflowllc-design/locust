import { describe, expect, it } from 'vitest'

import { FOLLOW_TOLERANCE, nextScrollTop } from './followBottom.js'

/**
 * Following a reply down the thread, without lurching.
 *
 * MEASURED 2026-09-11 (`probe-reply-arrives-smoothly`, a real 400-word reply
 * on Claude Code): the thread moved on 26 of 1361 frames, 47% of the whole
 * journey in five of them, one single frame of 221px. The text arrives in
 * batches because the runtime emits it in batches; what changed is that a
 * batch no longer teleports the page by its own height.
 *
 * The one thing a scroll animation must never do is stop short or overshoot.
 */
describe('walking a thread to its bottom', () => {
  it('never overshoots, however far it has to go', () => {
    for (const distance of [9, 40, 221, 800, 1199]) {
      expect(nextScrollTop(0, distance), String(distance)).toBeLessThanOrEqual(distance)
    }
  })

  it('always arrives, and reasonably soon', () => {
    // A geometric approach never actually reaches its target; this one has to.
    let at = 0
    let frames = 0
    while (at < 221 && frames < 200) {
      at = nextScrollTop(at, 221)
      frames += 1
    }
    expect(at).toBe(221)
    // The 221px lurch that started this, spread over a fraction of a second.
    expect(frames).toBeLessThanOrEqual(20)
    expect(frames).toBeGreaterThan(3)
  })

  it('moves at least a pixel whenever it is not there yet', () => {
    for (const at of [0, 100, 219, 220]) {
      expect(nextScrollTop(at, 221), String(at)).toBeGreaterThan(at)
    }
  })

  it('closes a near-miss at once rather than crawling', () => {
    // A thread sitting a few pixels short of the bottom has stopped
    // following, as far as `atBottom` is concerned.
    expect(nextScrollTop(215, 221)).toBe(221)
  })

  it('jumps a very long way rather than trudging', () => {
    // A fold opening or a recovered turn. At that distance easing reads as
    // lag, not as motion.
    expect(nextScrollTop(0, 5_000)).toBe(5_000)
  })

  it('does not move a thread that is already there, or past it', () => {
    expect(nextScrollTop(221, 221)).toBe(221)
    expect(nextScrollTop(400, 221)).toBe(221)
  })

  it('snaps when the person asked for less motion', () => {
    expect(nextScrollTop(0, 221, true)).toBe(221)
  })

  it('tolerates more than a near-miss while following', () => {
    // While the walk is in flight the thread is by definition not at the
    // bottom. A tight tolerance would read the animation as the person
    // scrolling away and cancel it on its first frame.
    expect(FOLLOW_TOLERANCE).toBeGreaterThan(64)
  })
})
