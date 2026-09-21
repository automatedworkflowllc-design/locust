import { describe, expect, it } from 'vitest'

import { buildThread } from './missionView.js'
import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

/**
 * An orb can only say what a runtime told us WHILE it was true.
 *
 * Colin, 2026-09-20: *"might be worth looking into if the orbs even work at
 * all with opencode and antigravity"*. Measured from the adapters:
 *
 *   - OpenCode emits `tool.started` and `tool.completed` from the same record
 *     in the same array, because `tool_use` arrives once per call already
 *     finished. There is never an open tool, so six of the nine shapes are
 *     unreachable and every run shows the working orb from start to end.
 *   - Antigravity separates a tool's start from its result, so tool and
 *     connector orbs work there — but pushes `step.started`/`step.completed`
 *     for reasoning back to back, so the thinking orb cannot persist.
 *
 * Pinned so nobody spends a session "fixing" a mapping that is correct. If one
 * of these runtimes starts streaming properly, this test fails and that is the
 * good news arriving.
 */

const at = (seconds: number): string =>
  new Date(Date.parse('2026-09-20T10:00:00.000Z') + seconds * 1000).toISOString()

let sequence = 0
const event = (type: string, payload: object, seconds: number): NormalizedRuntimeEvent =>
  ({
    id: `e${String((sequence += 1))}`,
    runId: 'r',
    missionId: 'm',
    sequence,
    occurredAt: at(seconds),
    sourceAdapter: 'opencode',
    type,
    payload
  }) as unknown as NormalizedRuntimeEvent

const liveStep = (events: readonly NormalizedRuntimeEvent[]) => {
  const item = buildThread(events, { running: true, mayEdit: true, startedAt: at(0) }).find(
    (entry) => entry.type === 'live-step'
  )
  return item?.type === 'live-step' ? item : undefined
}

describe('an orb needs a runtime that streams', () => {
  it('shows the working orb through an OpenCode tool call, because the tool is never open', () => {
    // The exact shape `opencode-events` produces: one record, both events.
    const step = liveStep([
      event('step.started', { stepKind: 'turn' }, 0),
      event('tool.started', { itemId: 't1', name: 'grep', toolKind: 'grep' }, 1),
      event('tool.completed', { itemId: 't1', status: 'completed' }, 1)
    ])
    expect(step?.register).toBe('working')
    expect(step?.orb).toBe('composing')
  })

  it('shows the tool orb on Antigravity, where the start and the result are apart', () => {
    const step = liveStep([
      event('tool.started', { itemId: 't1', name: 'grep_search', toolKind: 'grep_search' }, 1)
    ])
    expect(step?.register).toBe('tool')
    expect(step?.orb).toBe('searching')
  })

  it('cannot hold the thinking orb when a reasoning step opens and closes at once', () => {
    const step = liveStep([
      event('step.started', { stepKind: 'reasoning', itemId: 'r1' }, 1),
      event('step.completed', { stepKind: 'reasoning', itemId: 'r1' }, 1)
    ])
    // Whatever it settles on, it is NOT a claim that thinking is happening.
    expect(step?.orb).not.toBe('listening')
  })
})
