import { describe, expect, it } from 'vitest'

import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

import { headerCostTail } from './cost.js'

// First-impressions pass, after 0.349: the conversation header said
// "9.0k in . 240 out" and "in your plan" -- an engineer's unit, and a
// subscription's non-cost. It says money, or nothing.
const completed = (usage: Record<string, unknown>): readonly NormalizedRuntimeEvent[] =>
  [
    {
      id: 'e',
      runId: 'r',
      missionId: 'm',
      sequence: 1,
      type: 'run.completed',
      occurredAt: '2026-09-26T06:00:00.000Z',
      sourceAdapter: 'opencode',
      payload: { usage, evidence: { redacted: true } }
    }
  ] as unknown as readonly NormalizedRuntimeEvent[]

describe("what the conversation's header says a run cost", () => {
  it('says dollars', () => {
    expect(headerCostTail({ events: completed({ inputTokens: 9000, outputTokens: 240, usd: 0.12 }), running: false })).toBe(' · $0.12')
  }, 10_000)

  it("says Copilot's premium requests", () => {
    expect(headerCostTail({ events: completed({ premiumRequests: 1 }), running: false })).toBe(' · 1 premium request')
  }, 10_000)

  it('says nothing for token counts alone, or for a subscription', () => {
    expect(headerCostTail({ events: completed({ inputTokens: 9000, outputTokens: 240 }), running: false })).toBe('')
    expect(headerCostTail({ events: completed({ inputTokens: 9000, outputTokens: 240, billing: 'subscription' }), running: false })).toBe('')
  }, 10_000)

  it('says nothing before the run has reported', () => {
    expect(headerCostTail({ events: [], running: true })).toBe('')
  }, 10_000)
})
