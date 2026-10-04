import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'
import { describe, expect, it } from 'vitest'

import { pieSlicePath, ringSentence } from './components/ContextRing.js'
import {
  contextReading,
  contextSentence,
  conversationCostLine,
  costLabel,
  costLine,
  costTotal,
  latestContext,
  runCostOf
} from './cost.js'

/**
 * THE RING READS WHAT THE CONVERSATION HOLDS, AND A SUBSCRIPTION IS NOT BILLED.
 *
 * Colin, 2026-09-23, with a frame of the ring on a long Opus 5.5 run: "context
 * is showing as 5m/1 and it has a conversation cost, which is silly for a
 * subscription plan".
 *
 * Both measured off his ledger the same night. The ring summed the run's
 * token totals, and a run with tools makes a call per step that re-reads the
 * whole conversation: 23 calls, none holding more than 240k, added up to
 * 4,978,743. And all three of his Claude runs reported the subscription's
 * usage windows and no paid extra usage, while the receipt carried the
 * dollars Claude Code prices the same tokens at on the API ($3.06, $5.69) --
 * which Claude Code itself does not show a subscriber.
 */

/** A receipt as the adapter now writes it, with Colin's numbers. */
function receipt(usage: Record<string, unknown>): readonly NormalizedRuntimeEvent[] {
  return [
    {
      id: 'e',
      runId: 'r',
      missionId: 'm',
      sequence: 1,
      occurredAt: '2026-09-23T04:22:00.000Z',
      sourceAdapter: 'claude',
      type: 'run.completed',
      payload: { usage, process: {} }
    } as unknown as NormalizedRuntimeEvent
  ]
}

const LONG_RUN = {
  usd: 3.06,
  inputTokens: 46,
  outputTokens: 31_000,
  cacheReadTokens: 4_796_000,
  cacheWriteTokens: 182_697,
  contextWindow: 1_000_000
}

describe('the ring', () => {
  it('reads what the conversation held after the last call, not the run added up', () => {
    const reading = contextReading(runCostOf(receipt({ ...LONG_RUN, contextTokens: 236_757 })))
    expect(reading).toEqual({ usedTokens: 236_757, windowTokens: 1_000_000, percent: 24 })
    expect(contextSentence(reading!)).toBe('Context: 237k of 1.0M used, 24%')
  })

  it('draws nothing for a receipt that cannot say what the conversation held', () => {
    // Written before the adapter measured the last call: its totals are the
    // "5M of 1M", and the honest reading of them is none.
    expect(contextReading(runCostOf(receipt(LONG_RUN)))).toBeUndefined()
    expect(latestContext([], receipt(LONG_RUN))).toBeUndefined()
  })
})

describe('a run a subscription covered', () => {
  const covered = receipt({ ...LONG_RUN, contextTokens: 236_757, billing: 'subscription' })

  it('carries no dollar figure: nobody paid it', () => {
    const cost = runCostOf(covered)
    expect(cost?.usd).toBeUndefined()
    expect(cost?.plan).toBe(true)
  })

  it('says on its receipt that the plan covered it', () => {
    expect(costLabel(runCostOf(covered))).toBe('Cost')
    expect(costLine(runCostOf(covered))).toBe('in your plan')
  })

  it('gives the ring nothing to say about cost, only the context', () => {
    expect(conversationCostLine([{ events: covered }], covered)).toBeUndefined()
    const hover = ringSentence(latestContext([], covered), conversationCostLine([], covered))
    expect(hover).toBe('Context: 237k of 1.0M used, 24%')
    expect(hover).not.toContain('$')
  })

  it('still prices what WAS priced beside it', () => {
    const priced = receipt({ usd: 0.4, inputTokens: 10, outputTokens: 5 })
    expect(conversationCostLine([{ events: covered }], priced)).toBe('$0.40')
  })

  it('keeps the dollars on a run with no subscription behind it', () => {
    expect(costLine(runCostOf(receipt(LONG_RUN)))).toBe('$3.06')
  })
})

describe('a list of runs, added up', () => {
  const plan = runCostOf(receipt({ ...LONG_RUN, billing: 'subscription' }))
  const priced = runCostOf(receipt({ usd: 0.05, inputTokens: 1, outputTokens: 1 }))
  const free = runCostOf(receipt({ inputTokens: 1200, outputTokens: 300 }))

  it('states no total for runs a subscription covered', () => {
    expect(costTotal([plan, plan])).toBeUndefined()
  })

  it('counts as priced only the runs that were', () => {
    expect(costTotal([priced, free, plan])).toEqual({ line: '$0.05', runs: 1, word: 'priced' })
    expect(costTotal([free, free])).toEqual({ line: '2.4k in · 600 out', runs: 2, word: 'measured' })
  })
})

describe('the ring, drawn', () => {
  // Yurt's beta report (#8): the arc read as a spinner still going after the
  // run had finished. It is a slice of a disc now: nothing loads in a pie.
  it('fills a slice from twelve o’clock, the size of the share used', () => {
    expect(pieSlicePath(0, 7, 4.5)).toBeUndefined()
    // A quarter ends at three o'clock, on the short way round.
    expect(pieSlicePath(25, 7, 4.5)).toBe('M 7 7 L 7 2.5 A 4.5 4.5 0 0 1 11.5 7 Z')
    // Past half, the long way round.
    expect(pieSlicePath(75, 7, 4.5)).toContain(' 0 1 1 ')
    // A full window is the whole disc, not a slice that closes on itself.
    expect(pieSlicePath(100, 7, 4.5)).toMatch(/^M 2.5 7 a 4.5 4.5 0 1 0 9 0/)
  })
})
