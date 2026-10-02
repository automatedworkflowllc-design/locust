import { describe, expect, it } from 'vitest'

import { buildThread, failureMessage, messageOfLogLine } from './missionView.js'
import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

/**
 * A LIMIT NOTE LEAVES WHEN IT STOPS BEING TRUE (QA-2026-09-29 round 2, R17).
 */
const at = (seconds: number): string => new Date(Date.parse('2026-09-29T10:00:00.000Z') + seconds * 1000).toISOString()
let sequence = 0
const event = (type: string, payload: object, seconds: number): NormalizedRuntimeEvent =>
  ({ id: `e${String((sequence += 1))}`, runId: 'r', missionId: 'm', sequence, occurredAt: at(seconds), sourceAdapter: 'opencode', type, payload }) as unknown as NormalizedRuntimeEvent

const BUSY = event('adapter.diagnostic', {
  level: 'warning',
  code: 'opencode.provider_busy.runtime_error',
  message: 'The model’s provider answered "Rate limit exceeded", and OpenCode is trying again on its own. To go on now, press Stop and pick another model.'
}, 2)
const busyShown = (events: readonly NormalizedRuntimeEvent[], running: boolean): boolean =>
  buildThread(events, { running, mayEdit: true, startedAt: at(0) }).some((item) => item.type === 'diagnostic' && item.retrying === true)

describe('the busy provider note', () => {
  it('shows while the run waits on the provider', () => {
    expect(busyShown([event('step.started', { stepKind: 'turn' }, 0), BUSY], true)).toBe(true)
  })

  it('goes once the model answers after all', () => {
    expect(busyShown([event('step.started', { stepKind: 'turn' }, 0), BUSY, event('message.delta', { itemId: 'm1', text: 'It worked on the third try.' }, 9)], true)).toBe(false)
  })

  it('goes once the run has ended', () => {
    expect(busyShown([event('step.started', { stepKind: 'turn' }, 0), BUSY], false)).toBe(false)
  })
})

describe("OpenCode's other provider error (0.550, Sol on 0.546)", () => {
  // "Endpoint is unavailable" is not a rate limit, so it comes as opencode.runtime_error,
  // and it says the same thing: OpenCode is trying again on its own.
  const OTHER = event('adapter.diagnostic', {
    level: 'warning',
    code: 'opencode.runtime_error',
    message: 'The model’s provider answered "Upstream request failed: Endpoint is unavailable.", and OpenCode is trying again on its own.'
  }, 2)

  it('shows while the run waits, and goes once the column has failed', () => {
    expect(busyShown([event('step.started', { stepKind: 'turn' }, 0), OTHER], true)).toBe(true)
    const failed = [event('step.started', { stepKind: 'turn' }, 0), OTHER, event('run.failed', { kind: 'process-failed', message: 'Error from provider (Console): Upstream request failed: Endpoint is unavailable.' }, 64)]
    const said = buildThread(failed, { running: false, mayEdit: false, startedAt: at(0) }).map((item) => JSON.stringify(item)).join('\n')
    expect(said).not.toContain('trying again on its own')
    // What the provider said is still the reason, and stays (0.551).
    const note = buildThread(failed, { running: false, mayEdit: false, startedAt: at(0) }).find((item) => item.type === 'diagnostic')
    expect(note?.type === 'diagnostic' ? note.message : undefined).toBe('The model’s provider answered "Upstream request failed: Endpoint is unavailable.".')
  })
})

describe("a runtime's last word, when it is a log line", () => {
  const LINE = 'timestamp=2026-09-29T03:40:47.596Z level=ERROR run=2a5ca609 message="stream error" providerID=opencode modelID=ling-3.0-flash-fin-free session.id=ses_1 small=false agent=build mode=primary error.error="AI_APICallError: Rate limit exceeded. Please retry after a brief wait."'

  it('is said as its error, not as the line', () => {
    expect(messageOfLogLine(LINE)).toBe('AI_APICallError: Rate limit exceeded. Please retry after a brief wait.')
    const card = failureMessage({ message: 'OpenCode stopped.', process: { stderr: LINE } })
    expect(card).not.toContain('timestamp=')
    expect(card).toContain('Rate limit exceeded')
  })

  it('leaves a plain line as it is', () => {
    expect(messageOfLogLine('error: the folder is not a git repository')).toBe('error: the folder is not a git repository')
  })
})
