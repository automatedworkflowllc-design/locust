import { describe, expect, it } from 'vitest'

import { elapsedInLabel, threadMarkers } from './missionView.js'
import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

/**
 * `959 min in · waited 5 min`, on a five-hour run. Colin, 2026-09-21.
 *
 * Two things wrong, and only one of them arithmetic.
 *
 * Nobody reads 959 minutes. Past an hour a person thinks in hours and past a
 * day in days, so the number was unreadable before it was anything else.
 *
 * The one underneath: it is WALL CLOCK from the first event of the whole
 * conversation, and a conversation chains across missions and across days.
 * Most of those 959 minutes were hours he was not at the desk. The count is
 * true, and "in" makes it sound like a measure of work.
 *
 * There is no honest single number for that, so the fix is not a better one:
 * it is to stop presenting a day-spanning total as a duration you can feel,
 * and to name the DAY once a turn is on a different one from the
 * conversation's first -- the same hole `startedLabel` was written to close
 * on the mission rule directly above this marker.
 */
let sequence = 0
const at = (iso: string): NormalizedRuntimeEvent => {
  sequence += 1
  return { id: `e${String(sequence)}`, runId: 'run_1', sequence, occurredAt: iso, type: 'run.started', payload: {} } as unknown as NormalizedRuntimeEvent
}

describe('959 minutes is not a duration', () => {
  it('reads minutes only while minutes are readable', () => {
    expect(elapsedInLabel(0)).toBe('0 min in')
    expect(elapsedInLabel(45)).toBe('45 min in')
    expect(elapsedInLabel(89)).toBe('89 min in')
  })

  it('turns hours into hours', () => {
    expect(elapsedInLabel(90)).toBe('1h 30m in')
    expect(elapsedInLabel(120)).toBe('2h in')
    expect(elapsedInLabel(305)).toBe('5h 5m in')
  })

  it('turns Colin\'s own number into something a person reads', () => {
    // The exact figure from the screenshot.
    expect(elapsedInLabel(959)).toBe('15h 59m in')
    expect(elapsedInLabel(959)).not.toContain('959')
  })

  it('counts days once it has been days', () => {
    expect(elapsedInLabel(1_440)).toBe('1d in')
    expect(elapsedInLabel(3_000)).toBe('2d 2h in')
  })

  it('names the day when a turn has crossed one, and not before', () => {
    /*
     * The real repair. Within one day a bare clock time is unambiguous; once
     * the conversation has run past midnight it is not, and `15h 59m in` on
     * its own still invites the reading that the run took sixteen hours.
     */
    // Two whole days apart, so this crosses a local midnight in every
    // timezone. The first version of this test used instants sixteen hours
    // apart in UTC, which land on the SAME local day west of Greenwich -- so
    // it failed here while the code was right.
    const overnight = threadMarkers([
      [at('2026-09-21T08:00:00.000Z')],
      [at('2026-09-23T08:00:00.000Z')]
    ])
    expect(overnight).toHaveLength(1)
    expect(overnight[0]?.day, 'a turn on another day must say which').toBeDefined()
    expect(overnight[0]?.elapsed).toBe('2d in')

    const sameDay = threadMarkers([
      [at('2026-09-22T08:00:00.000Z')],
      [at('2026-09-22T09:30:00.000Z')]
    ])
    expect(sameDay).toHaveLength(1)
    // The control: a date on every marker would be noise on the ordinary
    // case, which is a conversation inside one sitting.
    expect(sameDay[0]?.day).toBeUndefined()
    expect(sameDay[0]?.elapsed).toBe('1h 30m in')
  })

  it('still says how long the silence was, which was never the broken part', () => {
    const markers = threadMarkers([
      [at('2026-09-22T08:00:00.000Z')],
      [at('2026-09-22T08:05:00.000Z')]
    ])
    expect(markers[0]?.note).toBe('waited 5 min')
  })
})
