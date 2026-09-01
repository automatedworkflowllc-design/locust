import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'
import { describe, expect, it } from 'vitest'

import { activitySummary, assistantMessages, buildThread, cancellationSummary } from './missionView.js'

const NOW = '2026-08-31T16:00:00.000Z'
let sequence = 0

function event(type: string, payload: Record<string, unknown>): NormalizedRuntimeEvent {
  sequence += 1
  return {
    id: `evt_${sequence}`,
    runId: 'run_1',
    missionId: 'mission_1',
    sequence,
    occurredAt: NOW,
    sourceAdapter: 'codex',
    type,
    payload: { evidence: { redacted: false }, ...payload }
  } as unknown as NormalizedRuntimeEvent
}

function toolStart(itemId: string, name: string, command?: string): NormalizedRuntimeEvent {
  return event('tool.started', {
    itemId,
    toolKind: 'command_execution',
    name,
    phase: 'started',
    ...(command === undefined ? {} : { command })
  })
}

function toolDone(itemId: string): NormalizedRuntimeEvent {
  return event('tool.completed', {
    itemId,
    toolKind: 'command_execution',
    name: 'shell',
    phase: 'completed'
  })
}

function delta(itemId: string, text: string, operation: 'append' | 'replace', final = false): NormalizedRuntimeEvent {
  return event('message.delta', { itemId, operation, text, final })
}

describe('assistant text', () => {
  it('rebuilds an appended stream instead of keeping the last fragment', () => {
    const messages = assistantMessages([
      delta('a', 'Adapter parity ', 'append'),
      delta('a', 'holds for ', 'append'),
      delta('a', 'invoice.paid.', 'append', true)
    ])
    expect(messages).toEqual([{ itemId: 'a', text: 'Adapter parity holds for invoice.paid.', final: true }])
  })

  it('honors a replace as a replace', () => {
    const messages = assistantMessages([
      delta('a', 'partial', 'append'),
      delta('a', 'the whole answer', 'replace', true)
    ])
    expect(messages[0]?.text).toBe('the whole answer')
  })

  it('keeps separate messages separate and in order', () => {
    const messages = assistantMessages([
      delta('a', 'first', 'append', true),
      delta('b', 'second', 'append', true)
    ])
    expect(messages.map((m) => m.text)).toEqual(['first', 'second'])
  })
})

describe('collapsed activity', () => {
  it('counts edits and commands separately from their tool events', () => {
    expect(
      activitySummary([
        { kind: 'edit', name: 'apply_patch', settled: true },
        { kind: 'edit', name: 'apply_patch', settled: true },
        { kind: 'shell', name: 'pnpm test', settled: true }
      ])
    ).toBe('Edited 2 files · ran 1 command')
  })

  it('singularizes honestly', () => {
    expect(activitySummary([{ kind: 'edit', name: 'x', settled: true }])).toBe('Edited 1 file')
  })

  it('says so when there was no tool activity', () => {
    expect(activitySummary([])).toBe('No tool activity')
  })

  it('classifies a patch command as an edit and a test run as a command', () => {
    const thread = buildThread(
      [toolStart('t1', 'shell', 'apply_patch <<EOF'), toolStart('t2', 'shell', 'pnpm test')],
      { running: true }
    )
    const activity = thread.find((item) => item.type === 'activity')
    expect(activity).toMatchObject({ summary: 'Edited 1 file · ran 1 command' })
  })
})

describe('thread composition', () => {
  it('shows a caret only while text is genuinely still arriving', () => {
    const streaming = buildThread([delta('a', 'partial', 'append')], { running: true })
    const finished = buildThread([delta('a', 'done', 'append', true)], { running: true })
    const stopped = buildThread([delta('a', 'partial', 'append')], { running: false })
    expect(streaming.find((i) => i.type === 'agent-message')).toMatchObject({ streaming: true })
    // Final means the provider is done with this message even if the run is not.
    expect(finished.find((i) => i.type === 'agent-message')).toMatchObject({ streaming: false })
    expect(stopped.find((i) => i.type === 'agent-message')).toMatchObject({ streaming: false })
  })

  it('drops the live step once it completes', () => {
    const running = buildThread([event('step.started', { stepKind: 'turn', message: 'Running the billing suite' })], {
      running: true
    })
    const done = buildThread(
      [
        event('step.started', { stepKind: 'turn', message: 'Running the billing suite' }),
        event('step.completed', { stepKind: 'turn' })
      ],
      { running: true }
    )
    expect(running.some((i) => i.type === 'live-step')).toBe(true)
    expect(done.some((i) => i.type === 'live-step')).toBe(false)
  })

  it('never shows a live step for a run that is not running', () => {
    const thread = buildThread([event('step.started', { stepKind: 'turn', message: 'Working' })], { running: false })
    expect(thread.some((i) => i.type === 'live-step')).toBe(false)
  })

  it('surfaces provider limits and diagnostics as their own items', () => {
    const thread = buildThread(
      [
        event('route.limit_detected', { kind: 'temporary-rate-limit', message: 'Slow down' }),
        event('adapter.diagnostic', { level: 'warning', code: 'x', message: 'Heads up', terminal: false })
      ],
      { running: true }
    )
    expect(thread.find((i) => i.type === 'limit')).toMatchObject({ kind: 'temporary-rate-limit' })
    expect(thread.find((i) => i.type === 'diagnostic')).toMatchObject({ level: 'warning' })
  })

  it('does not invent an activity card when nothing ran', () => {
    expect(buildThread([delta('a', 'hi', 'append', true)], { running: false }).some((i) => i.type === 'activity'))
      .toBe(false)
  })
})

describe('cancellation summary', () => {
  it('separates what finished from what was cut off mid-flight', () => {
    const summary = cancellationSummary(
      [toolStart('t1', 'shell', 'pnpm build'), toolDone('t1'), toolStart('t2', 'shell', 'pnpm test')],
      4
    )
    expect(summary.settled).toEqual(['pnpm build'])
    expect(summary.interrupted).toEqual(['pnpm test'])
    expect(summary.neverStarted).toBe(2)
  })

  it('never reports a negative count when more ran than were planned', () => {
    const summary = cancellationSummary([toolStart('t1', 'shell', 'a'), toolDone('t1')], 0)
    expect(summary.neverStarted).toBe(0)
  })
})
