import { describe, expect, it } from 'vitest'

import { activityEntries, activityTrace, buildThread, traceOutcome } from './missionView.js'
import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

/**
 * ANTIGRAVITY'S ROWS READ LIKE CLAUDE'S (0.541).
 *
 * Colin, on Boss in Edit, 2026-10-02: the fold read `manage_task done` -- the
 * runtime's own tool id -- and Antigravity's refused `git status` read
 * "failed" and "it exited non-zero". It never ran: Edit does not let
 * Antigravity run commands. The shape below is what agy-events.ts emits.
 */
let sequence = 0
function event(type: string, payload: unknown): NormalizedRuntimeEvent {
  sequence += 1
  return {
    id: `run:antigravity:${String(sequence)}`,
    runId: 'run',
    sequence,
    occurredAt: new Date(Date.UTC(2026, 9, 2, 12, 0, sequence)).toISOString(),
    sourceAdapter: 'antigravity',
    type,
    payload
  } as unknown as NormalizedRuntimeEvent
}

const events = [
  event('run.started', {}),
  event('tool.started', { itemId: 'tool_1', toolKind: 'manage_task', name: 'manage_task', phase: 'started' }),
  event('tool.completed', { itemId: 'tool_1', toolKind: 'manage_task', name: 'manage_task', phase: 'completed' }),
  event('tool.started', { itemId: 'tool_2', toolKind: 'run_command', name: 'run_command', command: 'git status', phase: 'started' }),
  event('tool.failed', { itemId: 'tool_2', toolKind: 'run_command', name: 'run_command', command: 'git status', phase: 'completed', status: 'refused', output: 'Not allowed in this mode.' }),
  event('run.completed', {})
]
const details = (() => {
  const activity = buildThread(events, { running: false }).find((item) => item.type === 'activity')
  return activity?.type === 'activity' ? activity.details : []
})()

describe("Antigravity's rows", () => {
  it('a plan update reads as one, never as manage_task', () => {
    const rows = activityEntries(details)
    const plan = rows.find((entry) => entry.kind === 'tool')
    expect(plan?.kind === 'tool' ? plan.name : undefined).toBe('Updated the plan')
    expect(JSON.stringify(rows)).not.toContain('manage_task')
  })

  it('a command the mode refused reads refused, never failed or non-zero', () => {
    const shell = activityEntries(details).find((entry) => entry.kind === 'shell')
    expect(shell?.kind === 'shell' ? shell.refused : undefined).toBe('Not allowed in this mode.')
    const line = activityTrace(details, events, traceOutcome(events, false)).map((segment) => segment.text).join(' · ')
    expect(line).toContain('1 refused')
    expect(line).not.toMatch(/non-zero|ran git status/)
  })
})
