import { describe, expect, it } from 'vitest'

import { buildThread } from './missionView.js'
import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

/**
 * THINKING IS NOT USING A TOOL (QA-2026-09-29 round 2, R31).
 *
 * Codex opens an ITEM for its reasoning, and every item that was not a
 * message read "Using a tool...", so a run only thinking said so from its
 * first second to its last.
 */
const at = (seconds: number): string => new Date(Date.parse('2026-09-29T10:00:00.000Z') + seconds * 1000).toISOString()
let sequence = 0
const event = (type: string, payload: object, seconds: number): NormalizedRuntimeEvent =>
  ({ id: `e${String((sequence += 1))}`, runId: 'r', missionId: 'm', sequence, occurredAt: at(seconds), sourceAdapter: 'codex', type, payload }) as unknown as NormalizedRuntimeEvent

const liveStep = (events: readonly NormalizedRuntimeEvent[]) => {
  const item = buildThread(events, { running: true, mayEdit: true, startedAt: at(0) }).find((entry) => entry.type === 'live-step')
  return item?.type === 'live-step' ? item : undefined
}

describe('the live line while Codex works', () => {
  it('reads thinking for a reasoning item', () => {
    expect(liveStep([event('step.started', { stepKind: 'item', itemId: 'rs_1', itemType: 'reasoning' }, 1)])?.register).toBe('thinking')
  })

  it('still reads writing for a message item, and a tool for other work', () => {
    expect(liveStep([event('step.started', { stepKind: 'item', itemId: 'msg_1', itemType: 'agentMessage' }, 1)])?.register).toBe('writing')
    expect(liveStep([event('step.started', { stepKind: 'item', itemId: 'ws_1', itemType: 'webSearch' }, 1)])?.register).toBe('tool')
  })
})
