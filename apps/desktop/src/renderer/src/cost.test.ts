import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'
import { describe, expect, it } from 'vitest'

import { contextReading, contextSentence, conversationCost, costLine, latestContext, runCostOf, sumCosts } from './cost.js'

function completed(usage: unknown): NormalizedRuntimeEvent {
  return {
    id: 'evt_1',
    runId: 'run_1',
    missionId: 'mission_1',
    sequence: 1,
    occurredAt: '2026-09-03T10:00:00.000Z',
    sourceAdapter: 'codex',
    type: 'run.completed',
    payload: { evidence: { redacted: false }, process: {}, ...(usage === undefined ? {} : { usage }) }
  } as unknown as NormalizedRuntimeEvent
}

describe('what a conversation has cost so far', () => {
  const turn = (inputTokens: number, outputTokens: number) => ({
    events: [
      {
        id: 'e',
        runId: 'r',
        missionId: 'm',
        sequence: 1,
        type: 'run.completed',
        occurredAt: '2026-09-03T10:00:00.000Z',
        sourceAdapter: 'codex',
        payload: { usage: { inputTokens, outputTokens }, evidence: { redacted: true } }
      }
    ] as unknown as Parameters<typeof conversationCost>[1]
  })

  it('adds every turn that reported a number, including the one still running', () => {
    // Cost lived on a receipt, and a receipt belongs to one mission -- so a
    // five-turn conversation kept its cost in five places and showed it in
    // none of them while any of it was happening.
    expect(conversationCost([turn(100, 10), turn(200, 20)], turn(50, 5).events)).toEqual({
      inputTokens: 350,
      outputTokens: 35
    })
  })

  it('counts the earlier turns while the current one has reported nothing yet', () => {
    expect(conversationCost([turn(100, 10)], [])).toEqual({ inputTokens: 100, outputTokens: 10 })
  })

  it('says nothing when no turn reported anything, rather than zero', () => {
    // A runtime that reported no usage has not said the work was free.
    expect(conversationCost([], [])).toBeUndefined()
    expect(conversationCost([{ events: [] }], [])).toBeUndefined()
  })
})

describe('what a run cost, off its receipt', () => {
  it('reads token counts in either spelling', () => {
    expect(runCostOf([completed({ inputTokens: 19428, outputTokens: 161, cacheReadTokens: 16256 })])).toEqual({ inputTokens: 19428, outputTokens: 161, cacheReadTokens: 16256 })
    expect(runCostOf([completed({ input_tokens: 10, output_tokens: 47 })])).toEqual({ inputTokens: 10, outputTokens: 47 })
  })

  it("reads Claude Code's dollars and Copilot's premium requests as their own units", () => {
    expect(runCostOf([completed({ usd: 0.0297808, inputTokens: 10, outputTokens: 47 })])).toEqual({ usd: 0.0297808, inputTokens: 10, outputTokens: 47 })
    expect(runCostOf([completed({ premiumRequests: 1, nanoAiu: 383710000 })])).toEqual({ premiumRequests: 1 })
  })

  it('says nothing when the receipt carries nothing, rather than zero', () => {
    expect(runCostOf([completed(undefined)])).toBeUndefined()
    expect(runCostOf([completed({ nanoAiu: 5 })])).toBeUndefined()
    expect(runCostOf([])).toBeUndefined()
    expect(costLine(undefined)).toBeUndefined()
  })

  it('never reads a negative or non-numeric count', () => {
    expect(runCostOf([completed({ inputTokens: -5, outputTokens: 'lots' })])).toBeUndefined()
  })
})

describe('the one-line cost', () => {
  it('prefers dollars, then premium requests, then tokens', () => {
    expect(costLine({ usd: 0.0297808, inputTokens: 10, outputTokens: 47 })).toBe('$0.03')
    expect(costLine({ usd: 0.001 })).toBe('< $0.01')
    expect(costLine({ usd: 0 })).toBe('$0.00')
    expect(costLine({ premiumRequests: 1 })).toBe('1 premium request')
    expect(costLine({ premiumRequests: 3 })).toBe('3 premium requests')
    expect(costLine({ inputTokens: 19428, outputTokens: 161 })).toBe('19k in · 161 out')
    expect(costLine({ inputTokens: 1_250_000, outputTokens: 999 })).toBe('1.3M in · 999 out')
  })
})

describe('adding costs up', () => {
  it('sums each unit it saw and ignores runs that reported nothing', () => {
    expect(sumCosts([{ usd: 0.02 }, undefined, { usd: 0.03, inputTokens: 5 }, { premiumRequests: 2 }])).toEqual({
      usd: 0.05,
      inputTokens: 5,
      premiumRequests: 2
    })
    expect(sumCosts([undefined, undefined])).toBeUndefined()
  })
})

describe('how full the context is', () => {
  // MEASURED 2026-09-06: Claude Code's result carries `modelUsage`, whose
  // entries state the model's real `contextWindow` (1,000,000 for
  // claude-sonnet-5). That reported number is the only denominator used.
  it('counts what the conversation held after its last call against the reported window', () => {
    // `contextTokens` is the last call's whole prompt, cached or not, and
    // what it wrote; the adapter measures it (claude-events.ts).
    const reading = contextReading({
      inputTokens: 2,
      outputTokens: 5,
      cacheReadTokens: 23997,
      cacheWriteTokens: 15080,
      contextTokens: 39084,
      contextWindow: 1_000_000
    })
    expect(reading).toEqual({ usedTokens: 39084, windowTokens: 1_000_000, percent: 4 })
  })

  it('says nothing at all when the runtime did not report a window', () => {
    // Every runtime but Claude Code is in this position today, and a ring
    // drawn against a guessed denominator would be a number the app made up
    // about the person's own quota.
    expect(contextReading({ inputTokens: 40_000, outputTokens: 100 })).toBeUndefined()
    expect(contextReading(undefined)).toBeUndefined()
    expect(contextReading({ contextWindow: 200_000 })).toBeUndefined()
  })

  it('takes the newest turn that reported one, never the sum of the turns', () => {
    // The window holds ONE prompt. Summing turns would report a five-turn
    // conversation as five times as full as it is.
    const turn = (used: number) => ({
      events: [completed({ inputTokens: used, contextTokens: used, contextWindow: 200_000 })]
    })
    expect(latestContext([turn(10_000), turn(20_000)], turn(30_000).events)?.usedTokens).toBe(30_000)
    // A live turn has reported nothing yet; the one before it still answers.
    expect(latestContext([turn(10_000), turn(20_000)], [])?.usedTokens).toBe(20_000)
  })

  it('says it in the words the tooltip uses', () => {
    const reading = contextReading({ contextTokens: 39_079, contextWindow: 1_000_000 })
    expect(contextSentence(reading!)).toMatch(/^Context: .* of .* used, 4%$/)
  })
})
