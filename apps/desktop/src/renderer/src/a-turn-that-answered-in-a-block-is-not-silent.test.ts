import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'
import { describe, expect, it } from 'vitest'

import { buildThread } from './missionView.js'

/**
 * M25 (the code review): a turn whose whole reply was a block -- a file
 * handed over, a question asked -- or a plan, was told "This turn ended
 * without a reply ... Nothing was changed. Sending it again usually works."
 * under the very thing it had said. On an earlier turn, where the question
 * is no longer drawn, only the false warning was left.
 */
const at = '2026-09-24T12:00:00.000Z'
let sequence = 0
const event = (type: string, payload: Record<string, unknown>): NormalizedRuntimeEvent =>
  ({
    schemaVersion: 1,
    eventId: `evt_${String(++sequence)}`,
    runId: 'run_1',
    missionId: 'mission_1',
    sequence,
    occurredAt: at,
    type,
    runtime: 'codex',
    payload
  }) as unknown as NormalizedRuntimeEvent
const reply = (text: string): NormalizedRuntimeEvent =>
  event('message.delta', { itemId: 'msg1', operation: 'append', text, final: true, evidence: { kind: 'test' } })
const finished = event('run.completed', {})
const warned = (events: readonly NormalizedRuntimeEvent[], latestTurn: boolean): boolean =>
  buildThread(events, { running: false, latestTurn }).some(
    (item) => item.type === 'diagnostic' && /ended without a reply/.test(item.message)
  )

describe('a turn that answered only in a block', () => {
  const FILE = ['<locust-file>', 'docs/report.md :: the rollup', '</locust-file>'].join('\n')
  const ASK = ['<locust-ask>', 'Keep v2, or migrate now?', '- Keep v2 :: Smaller', '- Migrate :: Bigger', '</locust-ask>'].join('\n')

  it('is not said to have ended without a reply when it handed over a file', () => {
    expect(warned([reply(FILE), finished], true)).toBe(false)
    expect(warned([reply(FILE), finished], false)).toBe(false)
  })

  it('is not said to have ended without a reply when it asked a question', () => {
    expect(warned([reply(ASK), finished], true)).toBe(false)
    expect(warned([reply(ASK), finished], false)).toBe(false)
  })

  it('is not said to have ended without a reply when it wrote a plan', () => {
    const plan = event('plan.updated', { plan: ['Read the tests', 'Write the fix'] })
    expect(warned([plan, finished], true)).toBe(false)
  })

  it('is not said to have ended without a reply when the answer was a summarized conversation (0.426)', () => {
    // `/compact` sent as the command: Claude Code writes no text, only the
    // boundary. Packaged 0.426, first drive: the notice went to the fold and
    // the thread said "Sending it again usually works."
    const compacted = event('adapter.diagnostic', {
      code: 'claude.context_compacted',
      level: 'info',
      terminal: false,
      message: 'Claude Code summarized the conversation so far, as asked, and carries on from the summary.'
    })
    expect(warned([compacted, finished], true)).toBe(false)
    const shown = buildThread([compacted, finished], { running: false, latestTurn: true })
    expect(shown.some((item) => item.type === 'diagnostic' && /summarized the conversation so far, as asked/.test(item.message))).toBe(true)
  })

  it('still is when nothing came back at all', () => {
    expect(warned([finished], true)).toBe(true)
    expect(warned([reply('   '), finished], true)).toBe(true)
  })
})
