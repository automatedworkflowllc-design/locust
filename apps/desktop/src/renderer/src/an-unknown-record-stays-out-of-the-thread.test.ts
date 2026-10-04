import { describe, expect, it } from 'vitest'

import { buildThread } from './missionView.js'
import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

/**
 * A RECORD LOCUST DOES NOT KNOW YET IS NOT PART OF THE CONVERSATION.
 *
 * Colin, 2026-09-22, sending a frame of a thread row that read "Unhandled
 * Claude record: tool_progress" and one word: "?". Claude Code 2.1.280 sends a
 * heartbeat while a long tool runs; the Claude adapter did not know the type,
 * said so as an `info` diagnostic, and once the run's work had begun every
 * diagnostic became its own row in the thread.
 *
 * The adapter now knows `tool_progress`. This is the other half: the next
 * record a runtime adds -- any runtime, since each updates on its own
 * schedule -- goes to the fold's foot with the turn's other remarks, where it
 * can still be read, and never between a person's question and the answer.
 */

const at = '2026-09-22T22:40:00.000Z'
let sequence = 0
const event = (type: string, payload: Record<string, unknown>): NormalizedRuntimeEvent =>
  ({
    id: `e-${String((sequence += 1))}`,
    runId: 'r',
    missionId: 'm',
    sequence,
    occurredAt: at,
    sourceAdapter: 'claude',
    type,
    payload
  }) as unknown as NormalizedRuntimeEvent

const run = (diagnostic: NormalizedRuntimeEvent): readonly NormalizedRuntimeEvent[] => [
  event('run.started', { evidence: { raw: {} } }),
  event('tool.started', { itemId: 'toolu_1', name: 'Bash' }),
  diagnostic,
  event('tool.completed', { itemId: 'toolu_1', name: 'Bash', output: 'ok' })
]

describe('a record the adapter does not know', () => {
  it('is never a row of its own, even after the work has begun', () => {
    const thread = buildThread(
      run(event('adapter.diagnostic', { code: 'claude.unknown_event', level: 'info', terminal: false, message: 'Unhandled Claude record: tool_progress' })),
      { running: false, mayEdit: true, startedAt: at }
    )
    expect(thread.filter((item) => item.type === 'diagnostic')).toEqual([])
  })

  it('is still said, in the fold with the turn’s other remarks', () => {
    const thread = buildThread(
      run(event('adapter.diagnostic', { code: 'codex.unknown_event', level: 'info', terminal: false, message: 'Unhandled Codex record: something_new' })),
      { running: false, mayEdit: true, startedAt: at }
    )
    expect(JSON.stringify(thread)).toContain('Unhandled Codex record: something_new')
  })

  it('leaves real trouble where it was: a runtime error after work began is still a row', () => {
    const thread = buildThread(
      run(event('adapter.diagnostic', { code: 'claude.runtime_error', level: 'error', terminal: false, message: 'API Error: overloaded' })),
      { running: false, mayEdit: true, startedAt: at }
    )
    expect(thread.filter((item) => item.type === 'diagnostic')).toHaveLength(1)
  })
})
