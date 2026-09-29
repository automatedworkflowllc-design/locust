import { describe, expect, it } from 'vitest'

import { isDue, nextRunAfter, scheduleLabel, validSchedule } from './routine-schedule.js'

describe('what a schedule may be', () => {
  it('is every N whole hours within a week, or daily at a wall-clock time', () => {
    expect(validSchedule({ kind: 'every', hours: 4 })).toBe(true)
    expect(validSchedule({ kind: 'every', hours: 168 })).toBe(true)
    expect(validSchedule({ kind: 'every', hours: 0 })).toBe(false)
    expect(validSchedule({ kind: 'every', hours: 1.5 })).toBe(false)
    expect(validSchedule({ kind: 'every', hours: 169 })).toBe(false)
    expect(validSchedule({ kind: 'daily', at: '09:30' })).toBe(true)
    expect(validSchedule({ kind: 'daily', at: '24:00' })).toBe(false)
    expect(validSchedule({ kind: 'daily', at: '9:30' })).toBe(false)
    expect(validSchedule({ kind: 'weekly' })).toBe(false)
    expect(validSchedule(undefined)).toBe(false)
  })
})

describe('when a routine is next due', () => {
  it('every N hours counts from the last run', () => {
    const last = '2026-09-05T10:00:00.000Z'
    const now = new Date('2026-09-05T12:00:00.000Z')
    expect(nextRunAfter({ kind: 'every', hours: 4 }, last, now).toISOString()).toBe('2026-09-05T14:00:00.000Z')
    expect(isDue({ kind: 'every', hours: 4 }, last, now)).toBe(false)
    expect(isDue({ kind: 'every', hours: 2 }, last, now)).toBe(true)
  })

  it('a routine that missed several intervals while the app was closed is due once, now -- not once per miss', () => {
    const last = '2026-09-01T10:00:00.000Z'
    const now = new Date('2026-09-05T12:00:00.000Z')
    expect(nextRunAfter({ kind: 'every', hours: 4 }, last, now).getTime()).toBe(now.getTime())
    expect(isDue({ kind: 'every', hours: 4 }, last, now)).toBe(true)
  })

  it('daily at a time is today if still ahead, tomorrow once it has run today', () => {
    // Built with local getters, so the test holds in whatever zone runs it.
    const now = new Date(2026, 8, 5, 8, 0, 0)
    const last = new Date(2026, 8, 4, 9, 0, 0).toISOString()
    const next = nextRunAfter({ kind: 'daily', at: '09:00' }, last, now)
    expect([next.getFullYear(), next.getMonth(), next.getDate(), next.getHours(), next.getMinutes()]).toEqual([2026, 8, 5, 9, 0])
    expect(isDue({ kind: 'daily', at: '09:00' }, last, now)).toBe(false)

    const later = new Date(2026, 8, 5, 9, 30, 0)
    expect(isDue({ kind: 'daily', at: '09:00' }, last, later)).toBe(true)

    const ranToday = new Date(2026, 8, 5, 9, 1, 0).toISOString()
    const afterRun = nextRunAfter({ kind: 'daily', at: '09:00' }, ranToday, later)
    expect([afterRun.getDate(), afterRun.getHours()]).toEqual([6, 9])
    expect(isDue({ kind: 'daily', at: '09:00' }, ranToday, later)).toBe(false)
  })

  it('reads on a card', () => {
    expect(scheduleLabel(undefined)).toBe('when you press Run')
    expect(scheduleLabel({ kind: 'every', hours: 1 })).toBe('every hour')
    expect(scheduleLabel({ kind: 'every', hours: 8 })).toBe('every 8 hours')
    expect(scheduleLabel({ kind: 'daily', at: '07:45' })).toBe('daily at 07:45')
  })
})

