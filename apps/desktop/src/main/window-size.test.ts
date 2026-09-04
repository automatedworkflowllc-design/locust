import { describe, expect, it } from 'vitest'

import { openingSize } from './window-size.js'

describe('how big the window opens', () => {
  it('takes a fraction of the display rather than most of it', () => {
    // 1480x940 flat was the old default, which is most of a laptop screen and
    // reads as "very large" the moment it appears.
    const on1920 = openingSize({ width: 1920, height: 1080 })
    expect(on1920.width).toBeLessThanOrEqual(1280)
    expect(on1920.height).toBeLessThanOrEqual(860)
  })

  it('never opens below what the layout needs', () => {
    const tiny = openingSize({ width: 1024, height: 640 })
    expect(tiny.width).toBe(1120)
    expect(tiny.height).toBe(720)
  })

  it('scales down on a small display instead of using the cap', () => {
    const modest = openingSize({ width: 1440, height: 900 })
    expect(modest.width).toBe(1181)
    expect(modest.height).toBe(774)
  })
})
