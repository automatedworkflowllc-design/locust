import { describe, expect, it } from 'vitest'

import { openingPlacement, readSavedWindow } from './window-bounds.js'

const LAPTOP = { x: 0, y: 0, width: 1920, height: 1040 }
const WORK = { width: 1920, height: 1040 }

describe('what the window opens with', () => {
  it('uses the opening size when nothing was saved', () => {
    const placement = openingPlacement(undefined, [LAPTOP], WORK)
    // 1215 since 2026-09-21: the width Colin actually works at, so a new
    // person does not meet a column of empty panel beside the thread.
    expect(placement.width).toBe(1215)
    expect(placement.x).toBeUndefined()
    expect(placement.maximized).toBe(false)
  })

  it('reopens where and how the person left it', () => {
    const saved = { x: 220, y: 90, width: 1500, height: 900, maximized: false }
    const placement = openingPlacement(saved, [LAPTOP], WORK)
    expect(placement).toEqual({ x: 220, y: 90, width: 1500, height: 900, maximized: false, minWidth: 1120, minHeight: 720 })
  })

  it('keeps a saved size larger than the default opening size', () => {
    // The whole point of remembering: a person who widened the window past the
    // first-launch cap must not have it narrowed back on every launch.
    const saved = { x: 0, y: 0, width: 1800, height: 1000, maximized: false }
    expect(openingPlacement(saved, [LAPTOP], WORK).width).toBe(1800)
  })

  it('reopens maximized when it was closed maximized', () => {
    const saved = { x: 10, y: 10, width: 1400, height: 880, maximized: true }
    const placement = openingPlacement(saved, [LAPTOP], WORK)
    expect(placement.maximized).toBe(true)
    // ...and still carries the size to un-maximize back to.
    expect(placement.width).toBe(1400)
  })

  it('drops a position on a monitor that is no longer plugged in', () => {
    // Saved on a second display to the right; the person is now on the laptop
    // alone. Honouring x=2400 opens the window where nothing can see or drag it.
    const saved = { x: 2400, y: 200, width: 1400, height: 880, maximized: false }
    const placement = openingPlacement(saved, [LAPTOP], WORK)
    expect(placement.x).toBeUndefined()
    expect(placement.y).toBeUndefined()
    expect(placement.width).toBe(1400)
  })

  it('keeps a position on a second display that is still attached', () => {
    const second = { x: 1920, y: 0, width: 1920, height: 1040 }
    const saved = { x: 2400, y: 200, width: 1400, height: 880, maximized: false }
    expect(openingPlacement(saved, [LAPTOP, second], WORK).x).toBe(2400)
  })

  it('rejects a window hanging off the edge with only a sliver showing', () => {
    // 60px of window on screen is not something a person can grab.
    const saved = { x: 1860, y: 400, width: 1400, height: 880, maximized: false }
    expect(openingPlacement(saved, [LAPTOP], WORK).x).toBeUndefined()
  })

  it('never restores below what the layout needs', () => {
    const saved = { x: 40, y: 40, width: 300, height: 200, maximized: false }
    const placement = openingPlacement(saved, [LAPTOP], WORK)
    expect(placement.width).toBe(1120)
    expect(placement.height).toBe(720)
  })

  it('never restores taller than a work area smaller than the minimum (M21)', () => {
    const small = { x: 0, y: 0, width: 1280, height: 672 }
    const saved = { x: 0, y: 0, width: 1120, height: 650, maximized: false }
    const placement = openingPlacement(saved, [small], { width: 1280, height: 672 })
    expect(placement.height).toBe(672)
    expect(placement.minHeight).toBe(672)
  })

  it('never restores taller than the display it lands on', () => {
    const saved = { x: 0, y: 0, width: 4000, height: 3000, maximized: false }
    const placement = openingPlacement(saved, [LAPTOP], WORK)
    expect(placement.width).toBe(1920)
    expect(placement.height).toBe(1040)
  })
})

describe('reading the saved file', () => {
  it('accepts a whole rectangle', () => {
    expect(readSavedWindow({ x: 1, y: 2, width: 1200, height: 800, maximized: true })).toEqual({
      x: 1,
      y: 2,
      width: 1200,
      height: 800,
      maximized: true
    })
  })

  it.each([
    ['not an object', 'nonsense'],
    ['null', null],
    ['a missing position', { width: 1200, height: 800 }],
    ['a missing size', { x: 1, y: 2 }],
    ['a zero size', { x: 1, y: 2, width: 0, height: 800 }],
    ['a NaN', { x: Number.NaN, y: 2, width: 1200, height: 800 }],
    ['an infinity', { x: 1, y: 2, width: Number.POSITIVE_INFINITY, height: 800 }]
  ])('refuses %s', (_label, value) => {
    expect(readSavedWindow(value)).toBeUndefined()
  })

  it('treats a missing maximized flag as not maximized', () => {
    expect(readSavedWindow({ x: 1, y: 2, width: 1200, height: 800 })?.maximized).toBe(false)
  })
})
