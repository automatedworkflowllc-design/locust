import { describe, expect, it } from 'vitest'

import { buildThread } from './missionView.js'
import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

/**
 * A LONG CALL IS NAMED WHILE IT RUNS.
 *
 * Colin, 2026-09-23, with a frame of a Claude Code run eight minutes in: the
 * live line read "Using a tool... Bash" for the whole call -- "i find it hard
 * to believe from using this app that after 8 minutes of working thats the
 * only info the user has been given". Claude Code's start names the tool and
 * nothing else; its adapter now restates the start once the call's command
 * and the model's description of it arrive.
 */
let sequence = 0
function event(type: string, payload: unknown): NormalizedRuntimeEvent {
  sequence += 1
  return {
    id: `run:${String(sequence)}`,
    runId: 'run',
    sequence,
    occurredAt: new Date(Date.UTC(2026, 8, 23, 10, 0, sequence)).toISOString(),
    sourceAdapter: 'claude',
    type,
    payload
  } as unknown as NormalizedRuntimeEvent
}

const events = [
  event('run.started', {}),
  event('tool.started', { itemId: 'toolu_long', toolKind: 'tool_use', name: 'Bash', phase: 'started' }),
  event('tool.started', { itemId: 'toolu_long', toolKind: 'tool_use', name: 'Bash', command: 'npm test', title: 'Run the test suite', phase: 'started' })
]

describe('a call restated with its names', () => {
  it('is one row, now carrying the command and what it is for', () => {
    const activity = buildThread(events, { running: true }).find((item) => item.type === 'activity')
    const rows = activity?.type === 'activity' ? activity.details : []
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ name: 'npm test', title: 'Run the test suite', settled: false })
  })

  it('puts the description on the live line, not the tool', () => {
    const live = buildThread(events, { running: true }).find((item) => item.type === 'live-step')
    expect(live?.type === 'live-step' ? live.label : '').toBe('Run the test suite')
  })

  it('keeps the clock from when the call began', () => {
    const live = buildThread(events, { running: true, startedAt: undefined }).find((item) => item.type === 'live-step')
    expect(live?.type === 'live-step' ? live.startedAt : '').toBe(events[0]!.occurredAt)
  })
})
