import { describe, expect, it } from 'vitest'

import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

import { buildThread } from './missionView.js'

/**
 * WHAT A TURN SAVED ON ITS BRANCH IS SAID AFTER THE TURN (0.439).
 *
 * The host commits a turn on the teammate's own branch once the run has
 * ended, and records "Saved this turn on locust/wren as ..." in the stream.
 * The first packaged drive (review-changes, 2026-09-28) drew that line under
 * the person's ask, above the work it saved: diagnostics are placed as the
 * events are read, and the work and the answer are placed after. It is the
 * turn's last line now.
 */
let sequence = 0
const event = (type: string, payload: Record<string, unknown>): NormalizedRuntimeEvent => {
  sequence += 1
  return {
    id: `e${String(sequence)}`,
    runId: 'r',
    missionId: 'm',
    sequence,
    occurredAt: `2026-09-28T10:00:${String(10 + sequence).padStart(2, '0')}.000Z`,
    sourceAdapter: 'opencode',
    type,
    payload: { evidence: { redacted: true }, ...payload }
  } as unknown as NormalizedRuntimeEvent
}

describe('a saved turn', () => {
  it('is the last line of its turn, after the work and the answer', () => {
    const events = [
      event('run.started', { runtimeThreadId: 't' }),
      event('tool.started', { itemId: 'w1', toolKind: 'file_change', name: 'write', phase: 'started' }),
      event('tool.completed', { itemId: 'w1', toolKind: 'file_change', name: 'write', phase: 'completed', path: 'notes.md' }),
      event('message.delta', { itemId: 'a1', operation: 'replace', text: 'Created notes.md.', final: true }),
      event('run.completed', {}),
      event('adapter.diagnostic', { level: 'info', code: 'host.turn_checkpoint', message: 'Saved this turn on locust/wren as 4b744293dfad: 1 file (notes.md).', terminal: false })
    ]
    const thread = buildThread(events, { running: false })
    const last = thread[thread.length - 1] as { readonly type: string; readonly message?: string }
    expect(last.type).toBe('diagnostic')
    expect(last.message).toBe('Saved this turn on locust/wren as 4b744293dfad: 1 file (notes.md).')
    expect(thread.some((item) => item.type === 'agent-message')).toBe(true)
    expect(thread.findIndex((item) => item.type === 'agent-message')).toBeLessThan(thread.length - 1)
  })

  it('is still said when the turn drew no work of its own, never folded away', () => {
    const events = [
      event('run.started', { runtimeThreadId: 't' }),
      event('message.delta', { itemId: 'a1', operation: 'replace', text: 'Done.', final: true }),
      event('run.completed', {}),
      event('adapter.diagnostic', { level: 'info', code: 'host.turn_checkpoint', message: 'Saved this turn on locust/wren as 0123456789ab: 1 file (a.py).', terminal: false })
    ]
    const thread = buildThread(events, { running: false })
    expect((thread[thread.length - 1] as { readonly message?: string }).message).toBe('Saved this turn on locust/wren as 0123456789ab: 1 file (a.py).')
  })
})
