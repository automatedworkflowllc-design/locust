import { describe, expect, it } from 'vitest'

import { conversationCostLine, missionCostTail } from './cost.js'
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
 *
 * UPDATED 2026-09-14 by the design ruling that followed this fix. The first
 * repair kept the conversation's total on the same line with the word
 * `conversation` on it -- which was true, and pushed a seven-fact strip past
 * its width until it truncated on Colin's screen. The total now lives on the
 * conversation-scoped surface instead, so what this pins is stricter: the
 * mission strip carries NOTHING but this mission, and the total is still
 * available, just not here.
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
  it('says nothing at all about a run that reported nothing', () => {
    // The measured defect: a cancelled run wore 1.8k in / 189 out, which
    // were the PREVIOUS turn's counts. Silence is the only honest answer.
    expect(missionCostTail({ events: NOTHING, earlierTurns: [turn(1800, 189)], running: false })).toBe('')
    expect(missionCostTail({ events: NOTHING, earlierTurns: [turn(6034, 45)], running: false })).toBe('')
  })

  it('never puts a conversation-scoped fact on the mission strip', () => {
    // Design ruling, 2026-09-14. Two scopes joined by the same separator
    // claim to be the same kind of thing, and the strip ran out of room
    // saying it. The word must not come back.
    const tail = missionCostTail({ events: turn(500, 20).events, earlierTurns: [turn(1800, 189)], running: false })
    expect(tail).not.toContain('conversation')
    // And the total is not smuggled in unlabelled either: 500 is this run's,
    // 2300 would be the conversation's.
    expect(tail).toContain('500')
    expect(tail).not.toContain('2.3k')
  })

  it('shows THIS run when this run reported one', () => {
    expect(missionCostTail({ events: turn(500, 20).events, earlierTurns: [turn(1800, 189)], running: false })).toContain('500')
  })

  it('still offers the conversation total, on the conversation-scoped surface', () => {
    // Evicted from the strip, not deleted. The ring's hover is its home, and
    // where no ring exists -- every runtime but Claude Code reports no
    // context window -- it is stated in the ring's slot instead.
    const whole = conversationCostLine([turn(1800, 189)], turn(500, 20).events)
    expect(whole).toBeDefined()
    expect(whole).toContain('2.3k')
  })

  it('marks a live run as still going', () => {
    expect(missionCostTail({ events: turn(500, 20).events, earlierTurns: [], running: true })).toContain('so far')
  })
})
