import { describe, expect, it } from 'vitest'

import { anchorsOf, anchorVariables, paintedBounds, RING_MARGIN } from './botAnchors.js'

/**
 * A BOT'S DOT AND RING SIT ON THE BOT.
 *
 * Colin, 2026-09-23, with a frame of the home screen's machine: "looks like
 * the online dots are off a bit, the square for the blue guy is off a bit".
 * They were placed against the bot's BOX, and the bot is drawn on a canvas
 * larger than the box and lifted within it -- on the cover, whose faces are
 * plain blocks, the canvas's negative margin collapses and the box rides up
 * while the drawing stays. probe-bot-anchors on 0.304: the droid's ring 24 px
 * above the droid's middle, the ghost's dot 33 px above its lower edge (76 px
 * bots). They are placed from the paint now.
 */
function canvas(width: number, height: number, painted: { left: number; top: number; right: number; bottom: number }): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = painted.top; y < painted.bottom; y += 1) {
    for (let x = painted.left; x < painted.right; x += 1) data[(y * width + x) * 4 + 3] = 255
  }
  return data
}

describe('where the paint is', () => {
  it('finds the painted pixels, right and bottom exclusive', () => {
    expect(paintedBounds(canvas(40, 30, { left: 5, top: 7, right: 21, bottom: 29 }), 40, 30)).toEqual({ left: 5, top: 7, right: 21, bottom: 29 })
  })

  it('ignores an antialiased fringe and says nothing for an empty canvas', () => {
    const data = canvas(10, 10, { left: 2, top: 2, right: 8, bottom: 8 })
    data[(0 * 10 + 0) * 4 + 3] = 20
    expect(paintedBounds(data, 10, 10)).toEqual({ left: 2, top: 2, right: 8, bottom: 8 })
    expect(paintedBounds(new Uint8ClampedArray(400), 10, 10)).toBeUndefined()
  })
})

describe('the ring and the dot, from the body', () => {
  // The cover droid as 0.304 drew it: its box 76 px, the body 4 px in from
  // the left and 31 px down from the box's top, 68 x 64.
  const droid = { left: 4 / 76, top: 31 / 76, right: 72 / 76, bottom: 95 / 76 }

  it('centres the ring on the body, clear of it by RING_MARGIN on its longer side', () => {
    const { ring } = anchorsOf(droid)
    expect(ring.left + ring.side / 2).toBeCloseTo((droid.left + droid.right) / 2, 6)
    expect(ring.top + ring.side / 2).toBeCloseTo((droid.top + droid.bottom) / 2, 6)
    expect(ring.side).toBeCloseTo(droid.right - droid.left + 2 * RING_MARGIN, 6)
  })

  it('puts the dot on the lower-right edge, not off the corner and not at mid height', () => {
    const { dot } = anchorsOf(droid)
    const middleY = (droid.top + droid.bottom) / 2
    expect(dot.x).toBeLessThan(droid.right)
    expect(dot.y).toBeLessThan(droid.bottom)
    expect(dot.x).toBeGreaterThan((droid.left + droid.right) / 2)
    // Well below the middle: where 0.304 put the ghost's, 33 px up, was mid height.
    expect(dot.y - middleY).toBeGreaterThan(0.3 * (droid.bottom - droid.top))
  })

  it('hands them to the CSS as percentages of the box, the dot by its centre', () => {
    const variables = anchorVariables(anchorsOf({ left: 0.1, top: 0.2, right: 0.9, bottom: 1 }))
    expect(variables['--lc-bot-ring-side']).toBe(`${((0.8 + 2 * RING_MARGIN) * 100).toFixed(2)}%`)
    expect(variables['--lc-bot-dot-shift']).toBe('50%')
    expect(Number.parseFloat(variables['--lc-bot-dot-right'] ?? '')).toBeCloseTo((1 - (0.5 + (Math.SQRT1_2 / 2) * 0.8)) * 100, 1)
  })
})
