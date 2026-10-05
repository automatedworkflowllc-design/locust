import { describe, expect, it } from 'vitest'

import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

import { EVENT_WINDOW, TRIMMED_TURN_LINE } from '../../shared/event-window.js'
import { LIVE_EVENT_CAP, buildThread, cappedLiveEvents } from './missionView.js'

/**
 * A LONG TURN KEEPS WHAT IT SAID (0.627).
 *
 * Colin, 2026-10-05, of a Claude Code / Sonnet 5.5 teammate 35 minutes in:
 * "complete radio silence and one stacked bar for 40 min?" At 17 minutes the
 * same thread had shown two of its messages between groups of steps. A running
 * turn kept its first event and its last 499; Claude Code sends about eight
 * events a tool call, so past some sixty calls the window held only steps, and
 * the messages it had already shown were gone. The shape below is his run's:
 * a message early, a long run of calls, a second message, more calls.
 */
let sequence = 0
const event = (type: string, payload: Record<string, unknown>): NormalizedRuntimeEvent => {
  sequence += 1
  return {
    id: `e${String(sequence)}`,
    runId: 'r',
    missionId: 'm',
    sequence,
    occurredAt: new Date(Date.UTC(2026, 9, 5, 7, 40) + sequence * 1000).toISOString(),
    sourceAdapter: 'claude',
    type,
    payload: { evidence: { redacted: true }, ...payload }
  } as unknown as NormalizedRuntimeEvent
}
const said = (itemId: string, text: string): NormalizedRuntimeEvent => event('message.delta', { itemId, operation: 'append', text, final: true })
/** One tool call as Claude Code reports it: a step that opens and closes around the call's start and end. */
const call = (n: number): readonly NormalizedRuntimeEvent[] => {
  const itemId = `toolu_${String(n)}`
  return [
    event('step.started', { stepKind: 'item', itemId: `${itemId}_step`, itemType: 'tool' }),
    event('tool.started', { itemId, toolKind: 'tool_use', name: 'Bash', phase: 'started' }),
    event('tool.started', { itemId, toolKind: 'tool_use', name: 'Bash', command: `echo ${String(n)}`, phase: 'started' }),
    event('step.completed', { stepKind: 'item', itemId: `${itemId}_step`, itemType: 'tool' }),
    event('tool.completed', { itemId, toolKind: 'tool_use', name: 'Bash', command: `echo ${String(n)}`, phase: 'completed', exitCode: 0 }),
    event('step.started', { stepKind: 'item', itemId: `${itemId}_after`, itemType: 'tool' }),
    event('step.completed', { stepKind: 'item', itemId: `${itemId}_after`, itemType: 'tool' }),
    event('step.completed', { stepKind: 'item', itemId: `${itemId}_done`, itemType: 'tool' })
  ]
}
const run = (): readonly NormalizedRuntimeEvent[] => {
  sequence = 0
  return [
    event('run.started', { evidence: { redacted: true } }),
    ...call(1),
    said('m1', 'Setting up the worktree and reading how the check is wired.'),
    ...Array.from({ length: 40 }, (_, at) => call(2 + at)).flat(),
    said('m2', 'Install finished. Building the app next.'),
    ...Array.from({ length: 50 }, (_, at) => call(42 + at)).flat()
  ]
}
const messages = (events: readonly NormalizedRuntimeEvent[], options: { readonly trimmed?: boolean } = {}): readonly string[] =>
  buildThread(events, { running: true, ...options }).flatMap((item) => (item.type === 'agent-message' ? [item.text] : []))

describe('a long turn keeps what it said', () => {
  it('is longer than the old window held, as Colin\'s run was', () => {
    expect(run().length).toBeGreaterThan(500)
  })

  it('keeps both messages in a running turn of that length', () => {
    const events = run()
    expect(cappedLiveEvents(events)).toHaveLength(events.length)
    expect(messages(cappedLiveEvents(events))).toEqual([
      'Setting up the worktree and reading how the check is wired.',
      'Install finished. Building the app next.'
    ])
  })

  it('draws the live run and the record through one window', () => {
    expect(LIVE_EVENT_CAP).toBe(EVENT_WINDOW)
  })

  it('says so at its top when even the window is too small, and only then', () => {
    const items = buildThread(run(), { running: true, trimmed: true })
    expect(items[0]).toMatchObject({ type: 'diagnostic', level: 'info', message: TRIMMED_TURN_LINE })
    expect(buildThread(run(), { running: true }).some((item) => item.type === 'diagnostic' && item.message === TRIMMED_TURN_LINE)).toBe(false)
  })
})
