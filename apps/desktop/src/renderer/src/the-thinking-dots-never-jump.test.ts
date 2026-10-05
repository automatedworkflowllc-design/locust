import { describe, expect, it } from 'vitest'

import { glyphMotion } from './components/Bot.js'

/**
 * THE THINKING DOTS NEVER JUMP (0.613).
 *
 * Colin, 2026-10-04, of the terminal faces: "the animations of the eyes of the
 * terminal screen teammates dont really get wonky until it goes to the two
 * dots. the other terminal styles look fine". The two dots' loop is 4.2 s:
 * glances up and about, then the dots bounce in turn like a loader. The loader
 * eased in from the last glance, but nothing eased it back: at every wrap each
 * dot was carried in ONE frame from where the bounce left it to the first
 * glance's place, up and left -- 1.6 across and up to 1.3 up, every 4.2 s.
 *
 * A face is drawn at most 30 times a second (BOT_FRAMES_PER_SECOND), so the
 * loop is read at 30 a second, across two loops and both eyes.
 *
 * AND THEY NO LONGER DART (2026-10-05). The glances moved to the head
 * (thinkingGlance, a-thinking-face-looks-with-its-head.test.ts): Colin, "the
 * dots shouldnt move the screen should just rotate with the body". The dots
 * hold their place while the face looks about, and the bounce is the fastest
 * they ever move.
 */
const CYCLE = 4.2
const FRAME = 1 / 30

/** How far a dot moves between two frames, in eye units. */
function step(eye: 0 | 1, from: number, to: number): number {
  const a = glyphMotion('••', eye, from)
  const b = glyphMotion('••', eye, to)
  return Math.hypot(b.dx - a.dx, b.dy - a.dy)
}

describe('the thinking dots', () => {
  it('end each loop where the next begins: no wrap to jump across', () => {
    for (const eye of [0, 1] as const) {
      // Just before the wrap and just after it, a millisecond apart.
      const before = glyphMotion('••', eye, 2 * CYCLE - 0.001)
      const after = glyphMotion('••', eye, 2 * CYCLE + 0.001)
      expect(Math.hypot(after.dx - before.dx, after.dy - before.dy)).toBeLessThan(0.05)
    }
  })

  it('never move farther in one frame than the bounce does, at the face\'s 30 frames a second', () => {
    // The fastest the loop means to move: the bounce, through the whole loader, read every tenth of a millisecond.
    let bounce = 0
    for (let t = 2.1; t < CYCLE - FRAME; t += 0.0001) bounce = Math.max(bounce, step(0, t, t + FRAME), step(1, t, t + FRAME))
    expect(bounce).toBeGreaterThan(0.3)
    // Then the whole loop, twice, both eyes: nothing may move faster than that bounce.
    for (const eye of [0, 1] as const) {
      for (let t = CYCLE * 0.5; t < CYCLE * 2.5; t += FRAME) {
        expect(step(eye, t, t + FRAME), `eye ${String(eye)} at ${t.toFixed(3)} s`).toBeLessThanOrEqual(bounce + 1e-9)
      }
    }
  })

  it('hold still while the face looks about, then bounce in turn: the loop itself is kept', () => {
    // Looking about: both dots where they rest, together, the whole first half.
    for (let t = 0.001; t < 2.1; t += 0.01) {
      const left = glyphMotion('••', 0, CYCLE * 3 + t)
      expect(left).toEqual(glyphMotion('••', 1, CYCLE * 3 + t))
      expect(left).toEqual(glyphMotion('••', 0, CYCLE * 3 + 0.5))
    }
    // Bouncing: through the second half the two dots are at different heights, the right a beat behind the left.
    const apart = [2.3, 2.5, 2.7, 3.1, 3.3, 3.5].map((t) => Math.abs(glyphMotion('••', 0, CYCLE * 3 + t).dy - glyphMotion('••', 1, CYCLE * 3 + t).dy))
    expect(Math.max(...apart)).toBeGreaterThan(0.5)
  })
})
