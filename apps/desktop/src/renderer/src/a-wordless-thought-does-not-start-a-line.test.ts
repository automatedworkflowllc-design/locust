import { describe, expect, it } from 'vitest'

import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'
import { buildThread } from './missionView.js'

/**
 * A THOUGHT WITH NO WORDS DOES NOT START A NEW LINE (0.571).
 *
 * Colin's Chief of Staff, Bro, on Antigravity (Gemini 3.8 Flash), 2026-10-03:
 * one two-minute turn drew 29 step lines, each "Thought for 4s, listed a
 * folder". Antigravity thinks before every call and Locust keeps none of its
 * words, and 0.492 started a line at every thought. The shape below is that
 * ledger's. A thought that carries words -- Codex's headlines, Cursor's --
 * still starts one.
 */
let sequence = 0
const event = (type: string, payload: Record<string, unknown>): NormalizedRuntimeEvent => {
  sequence += 1
  return {
    id: `e${String(sequence)}`, runId: 'r', missionId: 'm', sequence, occurredAt: new Date(Date.UTC(2026, 9, 3, 20, 50, sequence * 4)).toISOString(),
    sourceAdapter: 'antigravity', type, payload: { evidence: { redacted: true }, ...payload }
  } as unknown as NormalizedRuntimeEvent
}
const thought = (id: string, words?: string) => [
  event('step.started', { stepKind: 'reasoning', itemId: id }),
  event('step.completed', { stepKind: 'reasoning', itemId: id, durationMs: 3800, ...(words === undefined ? {} : { message: words }) })
]
const call = (id: string, command: string) => [
  event('tool.started', { itemId: id, toolKind: 'run_command', name: 'run_command', command, phase: 'started' }),
  event('tool.completed', { itemId: id, toolKind: 'run_command', name: 'run_command', command, phase: 'completed' })
]
const linesOf = (events: readonly NormalizedRuntimeEvent[]) => buildThread(events, { running: false }).filter((item) => item.type === 'steps')

describe('thinking before every call', () => {
  it('is one line when the thoughts say nothing', () => {
    const events = [event('run.started', {}), ...thought('t1'), ...call('c1', 'Get-ChildItem'), ...thought('t2'), ...call('c2', 'Get-Content a.md'), ...thought('t3'), ...call('c3', 'git status'), event('run.completed', {})]
    const lines = linesOf(events)
    expect(lines.length).toBe(1)
    // The thinking is still shown, in the line it folded into.
    expect(lines[0]?.type === 'steps' ? lines[0].details.filter((detail) => detail.kind === 'reasoning').length : 0).toBe(3)
  })

  it('still starts a line at a thought that says something', () => {
    const events = [event('run.started', {}), ...thought('t1', 'Listing the folder'), ...call('c1', 'Get-ChildItem'), ...thought('t2', 'Reading the plan'), ...call('c2', 'Get-Content a.md'), event('run.completed', {})]
    expect(linesOf(events).length).toBe(2)
  })
})
