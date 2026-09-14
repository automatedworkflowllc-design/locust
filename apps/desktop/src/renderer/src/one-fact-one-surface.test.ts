import { describe, expect, it } from 'vitest'

import { durationText } from './missionView.js'
import { missionPhaseView } from './status.js'

/*
 * Grok's 2026-09-13 audit, findings 2 and 4. Every one of that report is the
 * same shape: two surfaces computing one fact separately, and disagreeing.
 * None is a crash and none failed a test, which is why they were found by
 * reading rather than by running.
 */
describe('one mission, one duration', () => {
  it('a 41-second run is 41s, not 0m', () => {
    // The Missions row rounded to whole minutes while the fold two inches
    // away used `durationText`. Same mission, timed twice.
    expect(durationText(41_000)).toBe('41s')
    expect(durationText(41_000)).not.toContain('0m')
  })

  it('and a long one still reads in minutes', () => {
    expect(durationText(150_000)).toBe('2m 30s')
  })
})

describe('one mission, one colour', () => {
  it('a completed run whose record is incomplete is amber, wherever it is drawn', () => {
    // Team Recent passed `false` because its rows did not carry the fact, so
    // the same mission was blue there and amber everywhere else.
    expect(missionPhaseView('completed', true).tone).toBe('amber')
    expect(missionPhaseView('completed', true).label).toContain('receipt incomplete')
  })

  it('and a clean completed run is not', () => {
    expect(missionPhaseView('completed', false).tone).toBe('blue')
  })
})
