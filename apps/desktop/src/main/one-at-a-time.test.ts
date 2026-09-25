import { describe, expect, it } from 'vitest'

import { oneAtATime } from './one-at-a-time.js'

describe('writers that append after the tail they read', () => {
  it('run one at a time, in order, so no two read the same tail', async () => {
    const record: number[] = []
    let inFlight = 0
    let overlapped = false
    const append = oneAtATime(async (value: number) => {
      inFlight += 1
      if (inFlight > 1) overlapped = true
      const tail = record.length
      await new Promise((resolve) => setTimeout(resolve, 5))
      record.splice(tail, 0, value)
      inFlight -= 1
    })
    await Promise.all([append(1), append(2), append(3)])
    expect(overlapped).toBe(false)
    expect(record).toEqual([1, 2, 3])
  })

  it('keeps going after one fails', async () => {
    const seen: number[] = []
    const write = oneAtATime(async (value: number) => {
      if (value === 1) throw new Error('refused')
      seen.push(value)
    })
    await expect(write(1)).rejects.toThrow('refused')
    await write(2)
    expect(seen).toEqual([2])
  })
})
