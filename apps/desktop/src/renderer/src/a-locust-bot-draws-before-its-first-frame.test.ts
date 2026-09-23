import { describe, expect, it } from 'vitest'

import { startBotClock } from './components/Bot.js'
import type { BotFrames } from './components/Bot.js'

/**
 * A LOCUST BOT DRAWS BEFORE ITS FIRST FRAME.
 *
 * The design system's cover, opened in a background tab (2026-09-23), had
 * the ghost and the droid on the machine and no Hopper. A page that is not
 * being painted runs no animation frames; bot-avatars draws its own shapes
 * at once, and a Locust bot waited for a frame that did not come. Checked
 * the same way on the cover's own build, with animation frames switched off:
 * the ghost and the droid drawn and the Hopper blank before, all three after.
 */
function frames(): BotFrames & { fire: (at: number) => void; pending: () => number; cancelled: number[] } {
  let queue: ((now: number) => void)[] = []
  let next = 1
  let time = 0
  const cancelled: number[] = []
  return {
    requestAnimationFrame: (callback) => {
      queue.push(callback)
      return next++
    },
    cancelAnimationFrame: (handle) => {
      cancelled.push(handle)
    },
    now: () => time,
    fire: (at) => {
      time = at
      const due = queue
      queue = []
      due.forEach((callback) => callback(at))
    },
    pending: () => queue.length,
    cancelled
  }
}

describe('a moving Locust bot', () => {
  it('is drawn once before any animation frame, so a page that paints none still shows it', () => {
    const clock = frames()
    let drawn = 0
    startBotClock(() => (drawn += 1), () => undefined, () => true, clock)
    expect(drawn).toBe(1)
    expect(clock.pending()).toBe(1)
  })

  it('then moves and draws on every frame while it is showing, and only then', () => {
    const clock = frames()
    let drawn = 0
    const steps: number[] = []
    let showing = true
    startBotClock(() => (drawn += 1), (seconds) => steps.push(seconds), () => showing, clock)
    clock.fire(16)
    expect(drawn).toBe(2)
    expect(steps).toEqual([0.016])
    showing = false
    clock.fire(32)
    expect(drawn).toBe(2)
    expect(clock.pending()).toBe(1)
  })

  it('stops when asked, cancelling the frame it was waiting on', () => {
    const clock = frames()
    const stop = startBotClock(() => undefined, () => undefined, () => true, clock)
    clock.fire(16)
    stop()
    expect(clock.cancelled).toEqual([2])
  })
})
