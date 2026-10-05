import { createOpenCodeEventNormalizer } from '@teammate/runtime-adapters'
import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'
import { describe, expect, it } from 'vitest'

import { buildThread, keptForTheRecord } from './missionView.js'

/**
 * HOW LONG A START TOOK IS KEPT, NOT SHOWN (2026-10-05).
 *
 * The host writes one note after each run's events: "Started in 6.1 s: looked
 * for Codex 0.2 s, briefed 0.1 s; Codex took 5.4 s to say it had started"
 * (main/start-timing.ts). It sat under every answer. Colin: "it doesnt really
 * have much purpose ... it should be removed". It stays in the saved record
 * for the drives and probes that measure starts; the thread never draws it.
 */
const record = (type: string, part: Record<string, unknown>): string => JSON.stringify({ type, sessionID: 'ses_1', part })
const start = record('step_start', { type: 'step-start' })
const finish = record('step_finish', { type: 'step-finish', reason: 'stop', tokens: { input: 10, output: 2 } })
const said = record('text', { type: 'text', text: 'Done: the file says hi.', time: { start: 1, end: 2 } })
const SENTENCE = 'Started in 6.1 s: looked for OpenCode 0.2 s, briefed 0.1 s; OpenCode took 5.4 s to say it had started.'

function turnWith(notes: readonly { code: string; message: string }[]): readonly NormalizedRuntimeEvent[] {
  const opencode = createOpenCodeEventNormalizer({ runId: 'run_1', missionId: 'mission_1' })
  const events: NormalizedRuntimeEvent[] = []
  ;[start, said, finish].forEach((raw, index) => events.push(...opencode.accept({ sequence: index + 1, raw })))
  events.push(
    ...opencode.finish({
      exitCode: 0,
      signal: null,
      stderr: '',
      stderrTruncated: false,
      recordCount: 3,
      cancelled: false,
      forcedTerminationAttempted: false,
      terminationUnconfirmed: false,
      inputDeliveryFailed: false,
      outputLimitExceeded: false,
      oversizedRecordsDropped: 0,
      startedAt: '2026-10-05T12:00:00.000Z',
      finishedAt: '2026-10-05T12:00:07.000Z'
    })
  )
  // The host's notes, after the run's own events, as the ledger keeps them.
  notes.forEach((note, index) =>
    events.push({
      runId: 'run_1',
      missionId: 'mission_1',
      occurredAt: '2026-10-05T12:00:07.100Z',
      sourceAdapter: 'opencode',
      id: `run_1:host:${note.code}:${String(index)}`,
      sequence: events.length + 1,
      type: 'adapter.diagnostic',
      payload: { level: 'info', code: note.code, message: note.message, terminal: false, evidence: { redacted: true } }
    } as NormalizedRuntimeEvent)
  )
  return events
}

const drawn = (items: readonly unknown[]): string => JSON.stringify(items)

describe('how long a start took', () => {
  it('is kept for the record and never drawn in the thread', () => {
    expect(keptForTheRecord('host.start-timing')).toBe(true)
    const items = buildThread(turnWith([{ code: 'host.start-timing', message: SENTENCE }]), { running: false })
    expect(drawn(items)).not.toContain('Started in')
    // The answer is still there.
    expect(drawn(items)).toContain('the file says hi')
  })

  it('takes nothing else with it: another host note is still said', () => {
    expect(keptForTheRecord('host.turn_checkpoint')).toBe(false)
    expect(keptForTheRecord('opencode.runtime_error')).toBe(false)
    const items = buildThread(
      turnWith([
        { code: 'host.start-timing', message: SENTENCE },
        { code: 'host.turn_checkpoint', message: 'Saved this turn on the teammate’s branch.' }
      ]),
      { running: false }
    )
    expect(drawn(items)).toContain('Saved this turn')
    expect(drawn(items)).not.toContain('Started in')
  })

  it('keeps a usage window out of the thread, as before', () => {
    expect(keptForTheRecord('codex.usage_window')).toBe(true)
  })
})
