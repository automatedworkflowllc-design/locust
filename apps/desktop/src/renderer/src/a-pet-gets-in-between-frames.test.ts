import { describe, expect, it, vi } from 'vitest'

import { TWEEN_VERSION, keptTweens, pixelPrint, tweenKey } from './petTweenStore.js'
import { TWEEN_MOMENTS, TWEEN_RESTING_WAIT_MS, flowSteps, inBetween, runInSlices, tweenSteps } from './petTweens.js'

/**
 * IN-BETWEENS FOR A PET'S DRAWINGS (2026-10-05, petTweens.ts). Codex Buddy's
 * maker drew three to five drawings a lift; Locust makes its own in-betweens
 * from the two either side, on the person's computer, a slice at a time.
 */

const W = 64
const H = 64

/** A drawing: a filled square of one colour on nothing, its top left at (x, y). */
function square(x: number, y: number, size = 16, colour: readonly [number, number, number] = [220, 60, 40]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(W * H * 4)
  for (let row = y; row < y + size; row += 1) {
    for (let col = x; col < x + size; col += 1) {
      if (row < 0 || col < 0 || row >= H || col >= W) continue
      const i = (row * W + col) * 4
      out[i] = colour[0]
      out[i + 1] = colour[1]
      out[i + 2] = colour[2]
      out[i + 3] = 255
    }
  }
  return out
}

/** Where a drawing's paint is: the middle of its covered pixels, across and down. */
function centre(rgba: Uint8ClampedArray): readonly [number, number] {
  let sx = 0
  let sy = 0
  let n = 0
  for (let i = 0; i < W * H; i += 1) {
    if ((rgba[i * 4 + 3] ?? 0) < 128) continue
    sx += i % W
    sy += Math.floor(i / W)
    n += 1
  }
  return [sx / n, sy / n]
}

const run = <T>(steps: Generator<void, T, void>): T => {
  for (;;) {
    const next = steps.next()
    if (next.done === true) return next.value
  }
}

describe('an in-between', () => {
  it('finds where a part moved, and draws it part of the way there, not a double of it', () => {
    const a = square(12, 20)
    const b = square(28, 26)
    const frames = run(tweenSteps(a, b, W, H))
    expect(frames).toHaveLength(TWEEN_MOMENTS.length)
    TWEEN_MOMENTS.forEach((t, i) => {
      const frame = frames[i]
      if (frame === undefined) throw new Error('no frame')
      const [x, y] = centre(frame)
      // The square's middle, a third and two thirds of the way from (20, 28) to (36, 34).
      // Within two pixels: a flat square's inside could be matched anywhere, its edges place it. Melted, it would not move at all.
      expect(Math.abs(x - (20 + 16 * t))).toBeLessThan(2)
      expect(Math.abs(y - (28 + 6 * t))).toBeLessThan(2)
      // One square's worth of paint, not two half-squares.
      let covered = 0
      for (let p = 0; p < W * H; p += 1) if ((frame[p * 4 + 3] ?? 0) >= 128) covered += 1
      expect(covered).toBeGreaterThan(16 * 16 * 0.8)
      expect(covered).toBeLessThan(16 * 16 * 1.25)
    })
  })

  it('leaves a drawing that did not move as it is', () => {
    const a = square(20, 20)
    const ab = run(flowSteps(a, a, W, H))
    expect(Math.max(...Array.from(ab.x, Math.abs), ...Array.from(ab.y, Math.abs))).toBe(0)
    const frame = inBetween(a, a, ab, ab, 0.5)
    expect(Array.from(frame)).toEqual(Array.from(a))
  })

  it('melts where it cannot trust the motion, rather than smear a guess', () => {
    // A part that comes from nowhere: in the second drawing and not the first, beside one that stays put.
    const a = square(10, 10)
    const b = new Uint8ClampedArray(square(10, 10))
    const appears = square(40, 40, 16, [40, 120, 220])
    for (let i = 0; i < b.length; i += 4) if ((appears[i + 3] ?? 0) > 0) b.set(appears.subarray(i, i + 4), i)
    const ab = run(flowSteps(a, b, W, H))
    const ba = run(flowSteps(b, a, W, H))
    const frame = inBetween(a, b, ab, ba, 0.5)
    const at = (x: number, y: number): number => frame[(y * W + x) * 4 + 3] ?? 0
    // What stays put is drawn whole; what appears melts in where it will be, not dragged from anywhere.
    expect(at(17, 17)).toBe(255)
    expect(at(47, 47)).toBeGreaterThan(0)
    expect(at(47, 47)).toBeLessThan(255)
    expect(at(32, 32)).toBe(0)
  })
})

describe('made a slice at a time', () => {
  it('hands the window back between steps, and finishes', async () => {
    let clock = 0
    let slices = 0
    const result = await new Promise<readonly Uint8ClampedArray[]>((resolve) => {
      runInSlices(
        tweenSteps(square(12, 20), square(28, 26), W, H),
        resolve,
        () => {
          // Each step reads the clock once or twice: a slice's budget is used up in a few of them.
          clock += 2
          return clock
        }
      )
      slices += 1
    })
    expect(result).toHaveLength(TWEEN_MOMENTS.length)
    expect(slices).toBe(1)
  })

  it('stops when asked, and hands nothing over', async () => {
    let finished = false
    const stop = runInSlices(tweenSteps(square(12, 20), square(28, 26), W, H), () => {
      finished = true
    })
    stop()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(finished).toBe(false)
  })
})

describe('never while Locust rests', () => {
  it('runs no slice while the window rests, and goes on once it is back', () => {
    vi.useFakeTimers()
    try {
      let resting = true
      let stepsRun = 0
      function* counted(): Generator<void, string, void> {
        for (let i = 0; i < 5; i += 1) {
          stepsRun += 1
          yield
        }
        return 'made'
      }
      let result: string | undefined
      runInSlices(counted(), (made) => {
        result = made
      }, () => 0, () => resting)
      vi.advanceTimersByTime(TWEEN_RESTING_WAIT_MS * 5)
      expect(stepsRun).toBe(0)
      resting = false
      vi.advanceTimersByTime(TWEEN_RESTING_WAIT_MS + 10)
      expect(stepsRun).toBe(5)
      expect(result).toBe('made')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('kept on this computer', () => {
  it('keeps them by the drawings’ own pixels, so a maker’s new sheet makes new ones', () => {
    const a = square(12, 20)
    const b = square(28, 26)
    expect(pixelPrint(a)).toBe(pixelPrint(square(12, 20)))
    expect(pixelPrint(a)).not.toBe(pixelPrint(b))
    const changed = new Uint8ClampedArray(a)
    changed[(20 * W + 12) * 4] = 7
    expect(pixelPrint(changed)).not.toBe(pixelPrint(a))
    // From one to the other, not both ways; and by how they are made.
    expect(tweenKey(a, b)).not.toBe(tweenKey(b, a))
    expect(tweenKey(a, b).startsWith(`${String(TWEEN_VERSION)}:`)).toBe(true)
  })

  it('finds none where the window has no storage, and makes them instead', async () => {
    expect(await keptTweens(tweenKey(square(1, 1), square(2, 2)))).toBeUndefined()
  })
})
