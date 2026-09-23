import { describe, expect, it } from 'vitest'

import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'
import { buildThread, narrationOf } from './missionView.js'

/**
 * WHAT A TEAMMATE SAID WHILE IT WORKED STAYS WHERE IT SAID IT.
 *
 * Yurt's beta report (#15), walkthrough 06: a free model's finished turn
 * read "Creating your HELLO file and lining up verification. / File write is
 * underway -- then I'll print it back to confirm. / DONE" under a fold that
 * already showed the file written and printed. The model said the first two
 * as their own messages BEFORE its tool calls; the thread drew every message
 * after the fold. Colin, 2026-09-23, on the fix: "I'll let you run with your
 * decision" -- into the fold, in the order it happened, the way Claude Code
 * keeps its transcript; the answer stays below.
 */
const NOW = '2026-09-23T12:00:00.000Z'
let sequence = 0

function event(type: string, payload: Record<string, unknown>): NormalizedRuntimeEvent {
  sequence += 1
  return {
    id: `evt_${String(sequence)}`,
    runId: 'run_1',
    missionId: 'mission_1',
    sequence,
    occurredAt: NOW,
    sourceAdapter: 'opencode',
    type,
    payload: { evidence: { redacted: false }, ...payload }
  } as unknown as NormalizedRuntimeEvent
}

const said = (itemId: string, text: string): NormalizedRuntimeEvent =>
  event('message.delta', { itemId, operation: 'append', text, final: true })
const toolStart = (itemId: string, name: string, command?: string): NormalizedRuntimeEvent =>
  event('tool.started', { itemId, toolKind: 'command_execution', name, phase: 'started', ...(command === undefined ? {} : { command }) })
const toolDone = (itemId: string, name: string, command?: string): NormalizedRuntimeEvent =>
  event('tool.completed', { itemId, toolKind: 'command_execution', name, phase: 'completed', exitCode: 0, ...(command === undefined ? {} : { command }) })
const completed = (): NormalizedRuntimeEvent =>
  event('run.completed', { process: { exitCode: 0, signal: null, stderr: '', stderrTruncated: false, recordCount: 3 } })

/** Yurt's walkthrough, as the runtime sent it. */
function walkthrough(): NormalizedRuntimeEvent[] {
  return [
    event('run.started', { runtimeThreadId: 'thread-1' }),
    said('m1', 'Creating your HELLO file and lining up verification.'),
    toolStart('t1', 'write', 'hello.txt'),
    toolDone('t1', 'write', 'hello.txt'),
    said('m2', "File write is underway — then I'll print it back to confirm."),
    toolStart('t2', 'shell', 'cat hello.txt'),
    toolDone('t2', 'shell', 'cat hello.txt'),
    said('m3', 'DONE'),
    completed()
  ]
}

describe('where each message goes', () => {
  it('puts what was said before the last step into the fold, before the step that came after it', () => {
    const events = walkthrough()
    // The fold's two rows came from the two tool.started events.
    const born = [events.findIndex((e) => e.type === 'tool.started'), events.findLastIndex((e) => e.type === 'tool.started')]
    expect(narrationOf(events, born, ['m1', 'm2', 'm3'])).toEqual([
      { itemId: 'm1', beforeRow: 0 },
      { itemId: 'm2', beforeRow: 1 }
    ])
  })

  it('never takes the reply: with nothing said after the last step, the last thing said stays below', () => {
    const events = [
      event('run.started', {}),
      said('m1', 'Writing the file now.'),
      toolStart('t1', 'write', 'a.txt'),
      said('m2', 'Done: a.txt holds ALPHA.'),
      toolDone('t1', 'write', 'a.txt'),
      toolStart('t2', 'read', 'a.txt'),
      toolDone('t2', 'read', 'a.txt'),
      completed()
    ]
    const born = [2, 5]
    expect(narrationOf(events, born, ['m1', 'm2'])).toEqual([{ itemId: 'm1', beforeRow: 0 }])
  })

  it('does not count a row the host added after the run ended (its look at the disk)', () => {
    const events = [
      event('run.started', {}),
      said('m1', 'All written.'),
      completed(),
      toolStart('obs', 'edit', 'a.txt')
    ]
    expect(narrationOf(events, [3], ['m1'])).toEqual([])
  })
})

describe('a finished turn, drawn', () => {
  it('reads the narration inside the fold in its order, and only the answer below it', () => {
    const items = buildThread(walkthrough(), { running: false })
    const fold = items.find((item) => item.type === 'activity')
    const below = items.filter((item) => item.type === 'agent-message').map((item) => (item.type === 'agent-message' ? item.text : ''))
    expect(below).toEqual(['DONE'])
    if (fold?.type !== 'activity') throw new Error('no fold')
    expect(fold.details.map((detail) => (detail.kind === 'said' ? `said: ${detail.output ?? ''}` : detail.kind))).toEqual([
      'said: Creating your HELLO file and lining up verification.',
      fold.details[1]!.kind,
      "said: File write is underway — then I'll print it back to confirm.",
      'shell'
    ])
  })

  it('counts nothing it said as a tool call', () => {
    const items = buildThread(walkthrough(), { running: false })
    const fold = items.find((item) => item.type === 'activity')
    if (fold?.type !== 'activity') throw new Error('no fold')
    expect(fold.summary).not.toMatch(/tool call/)
    expect(JSON.stringify(fold.trace)).not.toMatch(/4 tool calls|3 tool calls/)
  })

  it('keeps everything below the fold while the run is still going -- its fold is closed then', () => {
    const live = walkthrough().slice(0, -1)
    const items = buildThread(live, { running: true })
    const below = items.filter((item) => item.type === 'agent-message').map((item) => (item.type === 'agent-message' ? item.text : ''))
    expect(below).toHaveLength(3)
    const fold = items.find((item) => item.type === 'activity')
    if (fold?.type !== 'activity') throw new Error('no fold')
    expect(fold.details.some((detail) => detail.kind === 'said')).toBe(false)
  })

  it('leaves a turn that only talked exactly as it was', () => {
    const items = buildThread([event('run.started', {}), said('m1', 'Hello.'), said('m2', 'Goodbye.'), completed()], { running: false })
    expect(items.filter((item) => item.type === 'agent-message')).toHaveLength(2)
    expect(items.some((item) => item.type === 'activity')).toBe(false)
  })
})
