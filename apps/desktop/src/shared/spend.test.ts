import { describe, expect, it } from 'vitest'

import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

import { dollars, isMonthlyLimit, limitReached, limitRefusal, moneyOfRun, monthOf, nextMonthStarts, sumSpend } from './spend.js'

const completed = (usage: Record<string, unknown>, occurredAt = '2026-09-26T06:00:00.000Z'): readonly NormalizedRuntimeEvent[] =>
  [{ id: 'e', runId: 'r', missionId: 'm', sequence: 1, type: 'run.completed', occurredAt, sourceAdapter: 'opencode', payload: { usage } }] as unknown as readonly NormalizedRuntimeEvent[]

describe('what a run cost in money', () => {
  it('is the dollars a runtime priced, with the moment it ended', () => {
    expect(moneyOfRun(completed({ usd: 0.42, inputTokens: 900 }))).toEqual({ usd: 0.42, at: '2026-09-26T06:00:00.000Z' })
  })

  it("is nothing for a plan's run, whose dollar figure nobody paid", () => {
    expect(moneyOfRun(completed({ usd: 3, billing: 'subscription' }))).toBeUndefined()
  })

  it('is nothing for tokens alone, or a free model that priced nothing', () => {
    expect(moneyOfRun(completed({ inputTokens: 900, outputTokens: 40 }))).toBeUndefined()
    expect(moneyOfRun([])).toBeUndefined()
  })

  it("is Copilot's premium requests, as their own unit", () => {
    expect(moneyOfRun(completed({ premiumRequests: 2 }))).toEqual({ premiumRequests: 2, at: '2026-09-26T06:00:00.000Z' })
  })

  it('adds up by unit, and is nothing when nothing was money', () => {
    expect(sumSpend([{ usd: 1 }, undefined, { usd: 0.5, premiumRequests: 1 }])).toEqual({ usd: 1.5, premiumRequests: 1 })
    expect(sumSpend([undefined])).toBeUndefined()
  })
})

describe('the month a run counts in', () => {
  it("is the machine's own month, not UTC's", () => {
    // Local noon on the 30th is the 30th everywhere a person lives.
    expect(monthOf(new Date(2026, 8, 30, 12))).toBe('2026-09')
    expect(monthOf(new Date(2026, 9, 1, 0, 5))).toBe('2026-10')
    expect(monthOf('not a date')).toBeUndefined()
  })

  it('starts again on the first of the next month, said as a person says it', () => {
    expect(nextMonthStarts(new Date(2026, 8, 26))).toBe('October 1')
    expect(nextMonthStarts(new Date(2026, 11, 31))).toBe('January 1')
  })
})

describe('a monthly limit', () => {
  it('is a positive amount no larger than the cap', () => {
    expect(isMonthlyLimit(5)).toBe(true)
    expect(isMonthlyLimit(0.01)).toBe(true)
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 100_001, '5', undefined]) expect(isMonthlyLimit(bad)).toBe(false)
  })

  it('is reached AT the amount as well as past it, and only by dollars', () => {
    expect(limitReached({ usd: 5 }, 5)).toBe(true)
    expect(limitReached({ usd: 5.01 }, 5)).toBe(true)
    expect(limitReached({ usd: 4.99 }, 5)).toBe(false)
    expect(limitReached({ premiumRequests: 500 }, 5)).toBe(false)
    expect(limitReached(undefined, 5)).toBe(false)
  })

  it('says what was spent, against what, and the two ways on', () => {
    expect(limitRefusal('Wren', { usd: 5.02 }, 5, new Date(2026, 8, 26))).toBe(
      "Wren has reached this month's limit: $5.02 of $5.00. Raise the limit by editing Wren, or it starts again on October 1."
    )
    expect(dollars(0.004)).toBe('< $0.01')
    expect(dollars(0)).toBe('$0.00')
  })
})
