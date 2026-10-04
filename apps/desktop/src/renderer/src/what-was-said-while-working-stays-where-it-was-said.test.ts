import { describe, expect, it } from 'vitest'

import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'
import { buildThread } from './missionView.js'
import type { ThreadItem } from './missionView.js'

/**
 * WHAT A TEAMMATE SAID WHILE IT WORKED STAYS WHERE IT SAID IT.
 *
 * Yurt's beta report (#15), walkthrough 06: a free model's finished turn
 * read "Creating your HELLO file and lining up verification. / File write is
 * underway -- then I'll print it back to confirm. / DONE" under a fold that
 * already showed the file written and printed. The model said the first two
 * BEFORE its tool calls; the thread drew every message after the fold.
 *
 * 0.491, Colin, 2026-09-30: "compared to claude code, ALL of our commands and
 * stuff that would appear batched on screen seem to all get rolled into the
 * bar". So a turn is drawn as Claude Code draws one: what was said, then the
 * steps taken before the next thing said as one line, in the order it all
 * happened -- while it runs and after, with nothing moving when it ends.
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

const said = (itemId: string, text: string, operation: 'append' | 'replace' = 'append'): NormalizedRuntimeEvent =>
  event('message.delta', { itemId, operation, text, final: true })
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

/** The turn as a reader meets it: words, step groups by their rows' names, and the foot. */
function shape(items: readonly ThreadItem[]): string[] {
  return items.flatMap((item) =>
    item.type === 'agent-message' ? [`said: ${item.text}`]
    : item.type === 'steps' ? [`steps: ${item.details.map((detail) => detail.name).join(', ')}`]
    // Drawn only once the turn has ended: a turn still going has no foot yet.
    : item.type === 'activity' ? (item.finished ? ['foot'] : [])
    : []
  )
}

describe('a finished turn, drawn', () => {
  it('reads in the order it happened: each thing said, then the steps before the next', () => {
    expect(shape(buildThread(walkthrough(), { running: false }))).toEqual([
      'said: Creating your HELLO file and lining up verification.',
      'steps: hello.txt',
      "said: File write is underway — then I'll print it back to confirm.",
      'steps: cat hello.txt',
      'said: DONE',
      'foot'
    ])
  })

  it('places a message where it BEGAN, so a full record restated after the next step leaves it before it (gap 9)', () => {
    // Claude Code streams its words, starts the tool, then restates the whole message.
    const events = [
      event('run.started', {}),
      said('m1', 'Checking the ', 'append'),
      toolStart('t1', 'shell', 'ls'),
      said('m1', 'Checking the folder first.', 'replace'),
      toolDone('t1', 'shell', 'ls'),
      said('m2', 'It is empty.'),
      completed()
    ]
    expect(shape(buildThread(events, { running: false }))).toEqual(['said: Checking the folder first.', 'steps: ls', 'said: It is empty.', 'foot'])
  })

  it('draws a stopped turn’s last words where they were said, never below its steps as an answer', () => {
    for (const end of [[event('run.failed', { reason: 'x' })], [event('run.cancelled', {})], []]) {
      const events = [
        event('run.started', {}),
        said('m1', 'Writing the file now.'),
        toolStart('t1', 'write', 'a.txt'),
        toolDone('t1', 'write', 'a.txt'),
        said('m2', 'Let me check it was written.'),
        toolStart('t2', 'read', 'a.txt'),
        ...end
      ]
      const drawn = shape(buildThread(events, { running: false }))
      expect(drawn.at(-2)).toBe('steps: a.txt')
      expect(drawn.indexOf('said: Let me check it was written.')).toBeLessThan(drawn.lastIndexOf('steps: a.txt'))
    }
  })

  it('puts a row the host added after the run ended in no group: it is in the turn’s files at the foot', () => {
    const events = [
      event('run.started', {}),
      said('m1', 'All written.'),
      completed(),
      toolStart('obs', 'edit', 'a.txt')
    ]
    const items = buildThread(events, { running: false })
    expect(shape(items)).toEqual(['said: All written.', 'foot'])
    const foot = items.find((item) => item.type === 'activity')
    expect(foot?.type === 'activity' ? foot.details.map((detail) => detail.name) : []).toEqual(['a.txt'])
  })

  it('does not split the steps on a message with nothing on screen', () => {
    const events = [
      event('run.started', {}),
      toolStart('t1', 'shell', 'ls'),
      toolDone('t1', 'shell', 'ls'),
      said('m0', '   '),
      toolStart('t2', 'shell', 'pwd'),
      toolDone('t2', 'shell', 'pwd'),
      said('m1', 'Done.'),
      completed()
    ]
    expect(shape(buildThread(events, { running: false }))).toEqual(['steps: ls, pwd', 'said: Done.', 'foot'])
  })

  it('counts nothing it said as a tool call', () => {
    const foot = buildThread(walkthrough(), { running: false }).find((item) => item.type === 'activity')
    if (foot?.type !== 'activity') throw new Error('no foot')
    expect(foot.summary).not.toMatch(/tool call/)
    expect(JSON.stringify(foot.trace)).not.toMatch(/4 tool calls|3 tool calls/)
  })

  it('leaves a turn that only talked exactly as it was', () => {
    const items = buildThread([event('run.started', {}), said('m1', 'Hello.'), said('m2', 'Goodbye.'), completed()], { running: false })
    expect(shape(items)).toEqual(['said: Hello.', 'said: Goodbye.'])
  })
})

describe('a turn still going', () => {
  it('draws the same order while it runs, so nothing moves when it ends', () => {
    const live = walkthrough().slice(0, -1)
    const drawn = shape(buildThread(live, { running: true }))
    expect(drawn).toEqual(shape(buildThread(walkthrough(), { running: false })).slice(0, -1))
  })

  it('leaves a step still going to the live line, and puts it in its group once it ends', () => {
    const going = [event('run.started', {}), said('m1', 'Looking.'), toolStart('t1', 'shell', 'ls'), toolDone('t1', 'shell', 'ls'), toolStart('t2', 'shell', 'npm test')]
    const before = buildThread(going, { running: true })
    expect(shape(before)).toEqual(['said: Looking.', 'steps: ls'])
    expect(before.some((item) => item.type === 'live-step' && item.label === 'npm test')).toBe(true)
    const after = buildThread([...going, toolDone('t2', 'shell', 'npm test')], { running: true })
    expect(shape(after)).toEqual(['said: Looking.', 'steps: ls, npm test'])
    // The same group, grown: it keeps its key, so an opened group stays open.
    const key = (items: readonly ThreadItem[]): string | undefined => items.find((item) => item.type === 'steps')?.key
    expect(key(after)).toBe(key(before))
  })
})
