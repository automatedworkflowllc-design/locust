import { describe, expect, it } from 'vitest'

import { thoughtLine } from './components/ActivityCard.js'
import { activityEntries, buildThread } from './missionView.js'
import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

/**
 * A thought is one line -- "Thought for 12s" -- with the words folded
 * under it. Colin, 2026-09-17, having loved the feature and worried about
 * the real estate: the shape Claude Code used before the words were shown
 * by default.
 */

const at = (s: number): string => new Date(Date.UTC(2026, 8, 17, 4, 0, s)).toISOString()
const ev = (seq: number, type: string, payload: Record<string, unknown>, s: number): NormalizedRuntimeEvent =>
  ({ id: `e${String(seq)}`, runId: 'run_1', missionId: 'mission_1', sequence: seq, occurredAt: at(s), sourceAdapter: 'cursor', type, payload: { evidence: { redacted: true }, ...payload } }) as never

describe('a thought in the fold', () => {
  it('carries how long it took, from the step that opened it', () => {
    const thread = buildThread(
      [
        ev(1, 'run.started', { runtimeThreadId: 't' }, 0),
        ev(2, 'step.started', { stepKind: 'reasoning', itemId: 'r1' }, 1),
        ev(3, 'step.completed', { stepKind: 'reasoning', itemId: 'r1', message: 'Two reads, then answer.' }, 13),
        ev(4, 'run.completed', { runtimeThreadId: 't', process: {} }, 14)
      ],
      { running: false }
    )
    const activity = thread.find((item) => item.type === 'activity')
    const details = activity?.type === 'activity' ? activity.details : []
    const thought = activityEntries(details).find((entry) => entry.kind === 'thought')
    expect(thought?.kind === 'thought' && thought.durationMs).toBe(12_000)
    expect(thought?.kind === 'thought' && thought.text).toBe('Two reads, then answer.')
  })

  it('reads as one line, and says nothing about time it cannot vouch for', () => {
    expect(thoughtLine(12_000)).toBe('Thought for 12s')
    expect(thoughtLine(90_000)).toBe('Thought for 1m 30s')
    expect(thoughtLine(undefined)).toBe('Thought')
    expect(thoughtLine(200)).toBe('Thought')
  })
})
