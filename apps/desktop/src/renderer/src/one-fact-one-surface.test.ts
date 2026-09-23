import { describe, expect, it } from 'vitest'

import { durationText } from './missionView.js'
import { missionPhaseView } from './status.js'
import { COST_NOT_REPORTED_SHORT, costCell, costLineOrWhyNot } from './cost.js'

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

describe('one missing cost, one sentence', () => {
  it('says the same thing wherever a cost was not reported', () => {
    // Four surfaces answered this themselves: `—`, `not reported`, and
    // `not reported by the runtime` twice, three of them in view at once.
    expect(costLineOrWhyNot(undefined)).toBe('not reported by the runtime')
  })

  it('keeps the one distinction that is real', () => {
    // A run that has not finished has not reported a cost YET, which is a
    // different fact from a runtime that does not report costs at all.
    expect(costLineOrWhyNot(undefined, true)).toBe('reported when the run ends')
  })

  it('still prefers the runtime own unit when there is one', () => {
    expect(costLineOrWhyNot({ usd: 0.42 })).toBe('$0.42')
  })

  it('the short form claims nothing, rather than claiming zero', () => {
    // A `$0.00` in a narrow column would say the run was free. It was not
    // said to be anything.
    expect(COST_NOT_REPORTED_SHORT).not.toContain('0')
    expect(COST_NOT_REPORTED_SHORT).not.toContain('$')
  })

  it('the short form is words, not a bare dash', () => {
    // Yurt's beta report (#14): a bare "—" read as an empty column.
    expect(COST_NOT_REPORTED_SHORT).toBe('not reported')
    expect(costCell(undefined, 'account-default')).toBe('not reported')
    expect(costCell({ usd: 0.42 }, 'account-default')).toBe('$0.42')
  })

  it('a model whose own id says it is free reads free', () => {
    expect(costCell(undefined, 'opencode/ling-3.0-flash-fin-free')).toBe('free')
    // A reported number still wins over the name.
    expect(costCell({ usd: 0.01 }, 'opencode/ling-3.0-flash-fin-free')).toBe('$0.01')
  })
})
