import { describe, expect, it } from 'vitest'

import { AWAY_MINIMUM_MS, awayCounts, awayCountsFrom, awayLine, sinceYouWereAway, wasAway } from './away.js'

/*
 * SINCE YOU WERE AWAY (0.590, PRD R17). One list from what the window holds:
 * runs that ended after the person left (ran, failed), routine slots missed
 * while they were gone, and the count waiting on them now. Nothing to say
 * when all four are empty. A coffee break is not being away.
 */

const SINCE = '2026-10-04T01:00:00.000Z'
const row = (missionId: string, phase: string, lastAt: string, extra: Record<string, unknown> = {}) => ({ missionId, title: `turn ${missionId}`, phase, lastAt, ...extra })

describe('what happened since you were away', () => {
  it('lists the runs that ended after you left, newest first, and leaves the earlier ones out', () => {
    const summary = sinceYouWereAway({
      since: SINCE,
      rows: [
        row('m1', 'completed', '2026-10-04T03:00:00.000Z', { ownerId: 'tm_wren', routineId: 'rt_1' }),
        row('m2', 'completed', '2026-10-04T05:00:00.000Z'),
        row('m3', 'completed', '2026-10-04T00:30:00.000Z'), // before you left
        row('m4', 'failed', '2026-10-04T02:00:00.000Z'),
        row('m5', 'running', '2026-10-04T06:00:00.000Z'), // not ended
        row('m6', 'cancelled', '2026-10-04T04:00:00.000Z') // not one of the four
      ],
      routines: [],
      needsYou: new Set()
    })
    expect(summary?.ran).toEqual([
      { missionId: 'm2', title: 'turn m2', at: '2026-10-04T05:00:00.000Z' },
      { missionId: 'm1', title: 'turn m1', at: '2026-10-04T03:00:00.000Z', ownerId: 'tm_wren', routineId: 'rt_1' }
    ])
    expect(summary?.failed).toEqual([{ missionId: 'm4', title: 'turn m4', at: '2026-10-04T02:00:00.000Z' }])
    expect(summary?.missed).toEqual([])
    expect(summary?.waiting).toBe(0)
    expect(summary?.since).toBe(SINCE)
  })

  it('counts the conversations waiting on you now, by any of their turns, and the slots missed while you were gone', () => {
    const summary = sinceYouWereAway({
      since: SINCE,
      rows: [
        row('m1', 'running', '2026-10-04T06:00:00.000Z', { memberIds: ['m1', 'm1b'] }),
        row('m2', 'running', '2026-10-04T06:00:00.000Z', { rootId: 'r2' }),
        row('m3', 'running', '2026-10-04T06:00:00.000Z')
      ],
      routines: [
        { routineId: 'rt_1', name: 'Morning digest', history: [
          { kind: 'missed', dueAt: '2026-10-04T05:00:00.000Z', recordedAt: '2026-10-04T07:00:00.000Z' },
          { kind: 'missed', dueAt: '2026-10-03T05:00:00.000Z', recordedAt: '2026-10-03T07:00:00.000Z' }, // yesterday's, seen already
          { kind: 'missed', dueAt: '2026-10-04T05:00:00.000Z', recordedAt: '2026-10-04T07:00:00.000Z' } // the same slot twice
        ] },
        { routineId: 'rt_2', name: 'Nightly tests', history: [{ kind: 'missed', dueAt: '2026-10-04T02:00:00.000Z', recordedAt: '2026-10-04T07:00:00.000Z' }] },
        { routineId: 'rt_3', name: 'No history' }
      ],
      needsYou: new Set(['m1b', 'r2'])
    })
    expect(summary?.waiting).toBe(2)
    expect(summary?.missed).toEqual([
      { routineId: 'rt_2', name: 'Nightly tests', dueAt: '2026-10-04T02:00:00.000Z' },
      { routineId: 'rt_1', name: 'Morning digest', dueAt: '2026-10-04T05:00:00.000Z' }
    ])
    expect(summary?.ran).toEqual([])
  })

  it('says nothing when nothing happened, and nothing for a since it cannot read (controls)', () => {
    expect(sinceYouWereAway({ since: SINCE, rows: [row('m3', 'completed', '2026-10-04T00:30:00.000Z')], routines: [], needsYou: new Set() })).toBeUndefined()
    expect(sinceYouWereAway({ since: 'yesterday-ish', rows: [row('m1', 'completed', '2026-10-04T05:00:00.000Z')], routines: [], needsYou: new Set() })).toBeUndefined()
  })
})

describe('the line and the gap', () => {
  it('words the counts, leaving out what is zero, and says nothing for all zeros', () => {
    const summary = sinceYouWereAway({ since: SINCE, rows: [row('m1', 'completed', '2026-10-04T05:00:00.000Z'), row('m2', 'completed', '2026-10-04T05:30:00.000Z'), row('m4', 'failed', '2026-10-04T02:00:00.000Z')], routines: [], needsYou: new Set() })!
    expect(awayCounts(summary)).toEqual({ ran: 2, failed: 1, missed: 0, waiting: 0 })
    expect(awayLine(awayCounts(summary))).toBe('Since you were away: 2 ran · 1 failed')
    expect(awayLine({ ran: 0, failed: 0, missed: 1, waiting: 3 })).toBe('Since you were away: 1 missed · 3 waiting on you')
    expect(awayLine({ ran: 0, failed: 0, missed: 0, waiting: 0 })).toBeUndefined()
    expect(awayLine(null)).toBeUndefined()
  })

  it('takes the counts off the wire only when they are four whole numbers with something to say (control)', () => {
    expect(awayCountsFrom({ ran: 2, failed: 0, missed: 1, waiting: 0 })).toEqual({ ran: 2, failed: 0, missed: 1, waiting: 0 })
    expect(awayCountsFrom({ ran: 0, failed: 0, missed: 0, waiting: 0 })).toBeNull()
    expect(awayCountsFrom({ ran: '2', failed: 0, missed: 0, waiting: 0 })).toBeNull()
    expect(awayCountsFrom({ ran: -1, failed: 0, missed: 0, waiting: 0 })).toBeNull()
    expect(awayCountsFrom({ ran: 1 })).toBeNull()
    expect(awayCountsFrom(null)).toBeNull()
    expect(awayCountsFrom('two ran')).toBeNull()
  })

  it('counts twenty minutes or more as away, less as a break, and no mark as nothing', () => {
    const now = new Date('2026-10-04T08:00:00.000Z')
    expect(AWAY_MINIMUM_MS).toBe(20 * 60_000)
    expect(wasAway('2026-10-04T07:40:00.000Z', now)).toBe('2026-10-04T07:40:00.000Z')
    expect(wasAway('2026-10-04T07:41:00.000Z', now)).toBeUndefined()
    expect(wasAway('2026-10-03T22:00:00.000Z', now)).toBe('2026-10-03T22:00:00.000Z')
    expect(wasAway(undefined, now)).toBeUndefined()
    expect(wasAway('not a time', now)).toBeUndefined()
  })
})
