import { describe, expect, it } from 'vitest'

import { minimumSize, openingSize } from './window-size.js'

describe('how big the window opens', () => {
  it('takes a fraction of the display rather than most of it', () => {
    // 1480x940 flat was the old default, which is most of a laptop screen and
    // reads as "very large" the moment it appears.
    const on1920 = openingSize({ width: 1920, height: 1080 })
    expect(on1920.width).toBeLessThanOrEqual(1215)
    expect(on1920.height).toBeLessThanOrEqual(800)
  })

  it('never opens below what the layout needs, on a display that has it', () => {
    const small = openingSize({ width: 1180, height: 760 })
    expect(small.width).toBe(1120)
    expect(small.height).toBe(720)
  })

  /*
   * M21 (the code review): 1920x1080 at 150% -- Windows' default on most
   * 13-14" 1080p laptops -- is a 1280x672 work area under the taskbar. The
   * window opened 720 tall with a 720 minimum, so the composer's bottom row
   * sat behind the taskbar and could not be brought out. A work area smaller
   * than the layout's minimum gets the work area.
   */
  it('never opens taller or wider than a work area smaller than the minimum', () => {
    expect(openingSize({ width: 1280, height: 672 })).toEqual({ width: 1120, height: 672 })
    expect(openingSize({ width: 1024, height: 640 })).toEqual({ width: 1024, height: 640 })
    expect(minimumSize({ width: 1280, height: 672 })).toEqual({ width: 1120, height: 672 })
    expect(minimumSize({ width: 2560, height: 1392 })).toEqual({ width: 1120, height: 720 })
  })

  it('scales down on a small display instead of using the cap', () => {
    const modest = openingSize({ width: 1440, height: 900 })
    expect(modest.width).toBe(1181)
    expect(modest.height).toBe(774)
  })
})
