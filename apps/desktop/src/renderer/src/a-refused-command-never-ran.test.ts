import { describe, expect, it } from 'vitest'

import { activityEntries, activityTrace, buildThread, traceOutcome } from './missionView.js'
import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

/**
 * A COMMAND THE RUNTIME REFUSED NEVER RAN.
 *
 * A replay of a Bash-heavy Haiku run through the Claude adapter and this
 * thread (2026-09-23): Claude Code refused two loops before they ran, and the
 * fold line read "ran 7 commands · 2 exited non-zero · 1 refused" -- five
 * ran, two never did, and nothing exited anything. The adapter now marks a
 * refused call `refused`, with Claude Code's reason.
 */
let sequence = 0
function event(type: string, payload: unknown): NormalizedRuntimeEvent {
  sequence += 1
  return {
    id: `run:${String(sequence)}`,
    runId: 'run',
    sequence,
    occurredAt: new Date(Date.UTC(2026, 8, 23, 12, 0, sequence)).toISOString(),
    sourceAdapter: 'claude',
    type,
    payload
  } as unknown as NormalizedRuntimeEvent
}

const events = [
  event('run.started', {}),
  event('tool.started', { itemId: 'a', toolKind: 'tool_use', name: 'Bash', command: 'for i in 1 2 3; do echo $i; done', phase: 'started' }),
  event('tool.failed', { itemId: 'a', toolKind: 'tool_use', name: 'Bash', command: 'for i in 1 2 3; do echo $i; done', phase: 'completed', status: 'refused', output: 'Contains simple_expansion' }),
  event('tool.started', { itemId: 'b', toolKind: 'tool_use', name: 'Bash', command: 'wc -l data/log.txt', phase: 'started' }),
  event('tool.completed', { itemId: 'b', toolKind: 'tool_use', name: 'Bash', command: 'wc -l data/log.txt', phase: 'completed', exitCode: 0 }),
  event('run.completed', {})
]
const details = (() => {
  const activity = buildThread(events, { running: false }).find((item) => item.type === 'activity')
  return activity?.type === 'activity' ? activity.details : []
})()

describe('a refused command', () => {
  it('is counted as refused, not as run or as exiting non-zero', () => {
    const line = activityTrace(details, events, traceOutcome(events, false)).map((segment) => segment.text).join(' · ')
    expect(line).toContain('ran wc -l data/log.txt')
    expect(line).toContain('1 refused')
    expect(line).not.toMatch(/non-zero|ran 2/)
  })

  it('keeps its row, with the reason the runtime gave', () => {
    const shell = activityEntries(details).filter((entry) => entry.kind === 'shell')
    expect(shell).toHaveLength(2)
    expect(shell[0]?.kind === 'shell' ? shell[0].refused : undefined).toBe('Contains simple_expansion')
    expect(shell[1]?.kind === 'shell' ? shell[1].refused : 'x').toBeUndefined()
  })
})

/*
 * A fresh-profile beta report of 0.345: an edit the person DECLINED on its
 * approval card read "edit failed" in its row and "1 refused" in the summary.
 * Declined is the person's no; refused is the mode's; neither is a failure.
 */
describe('a declined edit', () => {
  const declined = [
    event('run.started', {}),
    event('tool.started', { itemId: 'e', toolKind: 'tool_use', name: 'db/query.sql', tool: 'edit', phase: 'started' }),
    event('tool.failed', { itemId: 'e', toolKind: 'tool_use', name: 'db/query.sql', tool: 'edit', phase: 'completed', status: 'declined', output: 'The person declined this in Locust.' }),
    event('run.completed', {})
  ]
  const shown = (() => {
    const activity = buildThread(declined, { running: false }).find((item) => item.type === 'activity')
    return activity?.type === 'activity' ? activity.details : []
  })()

  it('says declined in its row and in the summary, never failed or refused', () => {
    const rows = activityEntries(shown).filter((entry) => entry.kind === 'tool' || entry.kind === 'unreported')
    expect(rows).toHaveLength(1)
    expect(rows[0]?.kind === 'tool' || rows[0]?.kind === 'unreported' ? rows[0].neverRan : undefined).toBe('declined')
    const line = activityTrace(shown, declined, traceOutcome(declined, false)).map((segment) => segment.text).join(' · ')
    expect(line).toContain('1 declined')
    expect(line).not.toContain('refused')
  })
})
