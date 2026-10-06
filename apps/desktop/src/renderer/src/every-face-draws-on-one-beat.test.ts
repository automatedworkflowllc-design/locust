import { describe, expect, it } from 'vitest'

import { frameBeat } from './frameBeat.js'

/**
 * EVERY FACE DRAWS ON ONE BEAT (0.654).
 *
 * Packaged 0.653, Home with a teammate working: the cover's bots drew on one
 * set of frames and a teammate's face, started later, on the other, so 46 of
 * every 58 frames carried a drawing -- the window composed nearly 60 times a
 * second for faces that each move at 30. On one beat they draw together.
 */
describe('the window\'s drawing beat', () => {
  it('lets two clocks that started on different frames draw in the same frames, 30 a second in all', () => {
    const beat = frameBeat(30)
    const drawingFrames = new Set<number>()
    let drawnA = 0
    let drawnB = 0
    for (let frame = 1; frame <= 60; frame += 1) {
      const now = (frame * 1000) / 60
      // Clock A asks first in each frame; clock B, started a frame later, asks after it.
      if (beat.due(now)) {
        drawnA += 1
        drawingFrames.add(now)
      }
      if (frame > 1 && beat.due(now)) {
        drawnB += 1
        drawingFrames.add(now)
      }
    }
    expect(drawingFrames.size).toBeLessThanOrEqual(30)
    expect(drawingFrames.size).toBeGreaterThanOrEqual(29)
    expect(drawnA).toBe(drawingFrames.size)
    expect(drawnB).toBeGreaterThanOrEqual(29)
  })

  it('draws at most 30 frames a second on a 144 Hz screen too', () => {
    const beat = frameBeat(30)
    let drawn = 0
    for (let frame = 1; frame <= 144; frame += 1) if (beat.due((frame * 1000) / 144)) drawn += 1
    expect(drawn).toBeLessThanOrEqual(30)
    expect(drawn).toBeGreaterThanOrEqual(28)
  })

  it('starts again for a clock whose time went backwards', () => {
    const beat = frameBeat(30)
    expect(beat.due(5000)).toBe(true)
    expect(beat.due(10)).toBe(true)
    expect(beat.due(20)).toBe(false)
  })
})
