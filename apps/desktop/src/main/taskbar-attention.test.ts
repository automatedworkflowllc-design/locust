import { describe, expect, it } from 'vitest'

import { attentionDot, needsYouCountFrom, taskbarAttention } from './taskbar-attention.js'

describe('the taskbar says when something needs you', () => {
  it('shows the dot while anything needs you, and takes it away when nothing does', () => {
    expect(taskbarAttention(0, 2, true).overlay).toBe('dot')
    expect(taskbarAttention(2, 0, false).overlay).toBe('none')
    expect(taskbarAttention(0, 1, false).description).toBe('1 thing needs you')
    expect(taskbarAttention(1, 3, false).description).toBe('3 things need you')
  })

  it('flashes only when the count RISES while the window is elsewhere', () => {
    expect(taskbarAttention(0, 1, false).flash).toBe(true)
    expect(taskbarAttention(1, 2, false).flash).toBe(true)
    // The same count sent again, or a smaller one: nothing new to see.
    expect(taskbarAttention(2, 2, false).flash).toBe(false)
    expect(taskbarAttention(3, 1, false).flash).toBe(false)
    // The person is looking: the chip in the window is enough.
    expect(taskbarAttention(0, 4, true).flash).toBe(false)
  })

  it('believes only a small whole number from the renderer', () => {
    expect(needsYouCountFrom(3)).toBe(3)
    for (const raw of [-1, 1.5, '2', null, undefined, 10_000, Number.NaN]) {
      expect(needsYouCountFrom(raw), String(raw)).toBeUndefined()
    }
  })

  it('draws an amber disc in a dark ring, transparent at the corners', () => {
    const size = 16
    const dot = attentionDot(size)
    expect(dot.length).toBe(size * size * 4)
    const pixel = (x: number, y: number) => {
      const at = (y * size + x) * 4
      return { b: dot[at]!, g: dot[at + 1]!, r: dot[at + 2]!, a: dot[at + 3]! }
    }
    // The centre is the needs-you amber, opaque (BGRA: blue first).
    expect(pixel(8, 8)).toEqual({ r: 0xe9, g: 0xb9, b: 0x49, a: 255 })
    // The corners are nothing at all.
    expect(pixel(0, 0).a).toBe(0)
    expect(pixel(15, 15).a).toBe(0)
    // The rim is dark: the ring, for a light taskbar.
    const rim = pixel(8, 0)
    expect(rim.a).toBeGreaterThan(0)
    expect(rim.r).toBeLessThan(0x80)
  })
})
