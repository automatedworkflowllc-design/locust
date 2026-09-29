import { describe, expect, it } from 'vitest'

import { nextRunAfter } from '../shared/routine-schedule.js'

// QA-2026-09-29 round 2, R7: a flat 24 hours drifted an hour across a clock change.
describe('a daily routine across a clock change', () => {
  it.each([
    ['spring forward', '2026-03-07T09:00:00-05:00', '2026-03-07T12:00:00-05:00', '2026-03-08T09:00:00-04:00'],
    ['fall back', '2026-10-31T09:00:00-04:00', '2026-10-31T12:00:00-04:00', '2026-11-01T09:00:00-05:00']
  ])('still runs at 09:00 the next day (%s, New York)', (_change, lastRunAt, now, next) => {
    const zone = process.env.TZ
    process.env.TZ = 'America/New_York'
    try {
      // Only meaningful where this process follows the zone it is given.
      if (new Date('2026-03-08T12:00:00Z').getTimezoneOffset() !== 240) return
      expect(nextRunAfter({ kind: 'daily', at: '09:00' }, lastRunAt, new Date(now)).toISOString()).toBe(new Date(next).toISOString())
    } finally {
      if (zone === undefined) delete process.env.TZ
      else process.env.TZ = zone
    }
  })
})
