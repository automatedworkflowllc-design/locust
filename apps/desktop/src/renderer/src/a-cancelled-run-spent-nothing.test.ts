import { describe, expect, it } from 'vitest'

import { missionCostTail } from './cost.js'
import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

/**
 * The number beside a mission id is that mission's.
 *
 * Grok's second beta drive, 2026-09-14, finding 2 -- and his first, where it
 * was reported and deliberately not fixed. A mission cancelled before
 * anything started, whose own ledger holds a create, a cancel and no usage
 * at all, showed "1.8k in - 189 out" in its header: the previous completed
 * turn's exact counts. A run that died on a provider error wore the counts
 * of the turn before IT.
 *
 * Nothing was wrong with the arithmetic. The header printed the
 * CONVERSATION's total next to a line that is otherwise entirely about one
 * mission -- its id, its model, its phase, its sandbox -- and a stranger
 * reads it as this run's spend. The card underneath had already been fixed
 * to tell the truth about what ran; the numbers had not.
 *
 * The control is the one Grok found himself: a cancelled empty run that was
 * the FIRST turn showed no token line at all, which is why this looked fine
 * every time it was checked on a fresh conversation.
 */

const turn = (inputTokens: number, outputTokens: number): { readonly events: readonly NormalizedRuntimeEvent[] } => ({
  events: [
    {
      id: 'e',
      runId: 'r',
      missionId: 'm',
      sequence: 1,
      type: 'run.completed',
      occurredAt: '2026-09-14T06:00:00.000Z',
      sourceAdapter: 'opencode',
      payload: { usage: { inputTokens, outputTokens }, evidence: { redacted: true } }
    }
  ] as unknown as readonly NormalizedRuntimeEvent[]
})

/** A run that was stopped before a model was ever reached. */
const NOTHING: readonly NormalizedRuntimeEvent[] = []

describe('the cost on a mission header', () => {
  it('says nothing about a run that reported nothing, whatever came before it', () => {
    const tail = missionCostTail({ events: NOTHING, earlierTurns: [turn(1800, 189)], running: false })
    // The previous turn's counts must not appear as this mission's.
    expect(tail).not.toContain('1.8k in · 189 out · ')
    expect(tail.startsWith(' · conversation ')).toBe(true)
  })

  it('names the conversation total as the conversation, never bare', () => {
    const tail = missionCostTail({ events: NOTHING, earlierTurns: [turn(6034, 45)], running: false })
    expect(tail).toContain('conversation')
  })

  it('shows THIS run when this run reported one', () => {
    const tail = missionCostTail({ events: turn(500, 20).events, earlierTurns: [turn(1800, 189)], running: false })
    // Its own 500, before the conversation's larger total.
    expect(tail.indexOf('500')).toBeGreaterThan(-1)
    expect(tail.indexOf('500')).toBeLessThan(tail.indexOf('conversation'))
  })

  it('does not say the same number twice on a first turn', () => {
    const tail = missionCostTail({ events: turn(500, 20).events, earlierTurns: [], running: false })
    expect(tail).not.toContain('conversation')
  })

  it('marks a live run as still going', () => {
    expect(missionCostTail({ events: turn(500, 20).events, earlierTurns: [], running: true })).toContain('so far')
  })
})
