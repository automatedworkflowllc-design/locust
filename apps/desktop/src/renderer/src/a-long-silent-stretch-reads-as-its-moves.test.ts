import { describe, expect, it } from 'vitest'

import { createAppServerEventNormalizer } from '@teammate/runtime-adapters'
import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'
import { buildThread, stepsLine, thoughtHeadline } from './missionView.js'

/**
 * A LONG SILENT STRETCH READS AS ITS MOVES (0.492).
 *
 * Colin, 2026-09-30: "i dont care about codex quota or anything else, just
 * want to make this perfect." An Antigravity run of 235 steps and one message
 * drew as ONE line with everything behind it. Codex's and Antigravity's own
 * apps start a new block each time the model plans its next move, and Codex
 * heads it with the thought's summary ("Inspecting the config"). So does
 * this: each reasoning step starts a new line, led by its headline.
 */
let sequence = 0
const event = (type: string, payload: Record<string, unknown>): NormalizedRuntimeEvent => {
  sequence += 1
  return {
    id: `e${String(sequence)}`, runId: 'r', missionId: 'm', sequence,
    occurredAt: new Date(Date.parse('2026-09-30T08:00:00.000Z') + sequence * 1_000).toISOString(),
    sourceAdapter: 'antigravity', type, payload: { evidence: { redacted: true }, ...payload }
  } as unknown as NormalizedRuntimeEvent
}
const think = (id: string, message?: string): NormalizedRuntimeEvent[] => [
  event('step.started', { stepKind: 'reasoning', itemId: id }),
  event('step.completed', { stepKind: 'reasoning', itemId: id, ...(message === undefined ? {} : { message }) })
]
const shell = (id: string, command: string): NormalizedRuntimeEvent[] => [
  event('tool.started', { itemId: id, toolKind: 'command_execution', name: 'run_command', command, phase: 'started' }),
  event('tool.completed', { itemId: id, toolKind: 'command_execution', name: 'run_command', command, phase: 'completed', exitCode: 0 })
]

describe('a stretch with nothing said', () => {
  it('starts a new line each time the model thinks, led by what it thought about', () => {
    const events = [
      event('run.started', {}),
      ...think('r1', '**Inspecting the config**\n\nLooking for where the port is set.'),
      ...shell('c1', 'cat config.json'),
      ...shell('c2', 'rg port src'),
      ...think('r2', '**Running the tests**'),
      ...shell('c3', 'npm test'),
      ...think('r3'),
      ...shell('c4', 'npm run build'),
      event('message.delta', { itemId: 'm1', operation: 'append', text: 'Done.', final: true }),
      event('run.completed', {})
    ]
    const lines = buildThread(events, { running: false }).flatMap((item) => (item.type === 'steps' ? [stepsLine(item.details, true).segments[0]!.text] : []))
    // A thought with no words folds into the line it sits in (0.571): r3 adds no line.
    // The headline is the line alone (0.610), as a described command's description is Claude Code's; the counts are in the rows.
    expect(lines).toEqual(['Inspecting the config', 'Running the tests'])
  })

  it('leaves a turn with no thinking reported as one line between what was said (Claude Code without thinking)', () => {
    const events = [event('run.started', {}), ...shell('c1', 'ls'), ...shell('c2', 'pwd'), event('run.completed', {})]
    expect(buildThread(events, { running: false }).filter((item) => item.type === 'steps')).toHaveLength(1)
  })

  it('reads a headline only where the summary leads with one', () => {
    expect(thoughtHeadline('**Planning the fix**\n\nFirst the test.')).toBe('Planning the fix')
    expect(thoughtHeadline('Planning the fix')).toBeUndefined()
  })
})

describe('a Codex thought, through its own adapter', () => {
  it('carries the summary Codex shows, and never the raw reasoning', () => {
    const codex = createAppServerEventNormalizer({ runId: 'run_1', now: () => new Date('2026-09-30T08:00:00.000Z') })
    const item = { type: 'reasoning', id: 'rs_1', summary: ['**Inspecting the config**\n\nThe port is read from config.json.'], content: ['RAW PRIVATE REASONING'] }
    const events = [
      ...codex.accept({ method: 'item/started', params: { threadId: 't', turnId: 'u', item: { type: 'reasoning', id: 'rs_1', summary: [], content: [] } } }),
      ...codex.accept({ method: 'item/completed', params: { threadId: 't', turnId: 'u', item } })
    ]
    const done = events.find((one) => one.type === 'step.completed')
    expect((done?.payload as { message?: string } | undefined)?.message).toContain('Inspecting the config')
    expect(JSON.stringify(done?.payload ?? {})).not.toContain('RAW PRIVATE REASONING')
  })
})
