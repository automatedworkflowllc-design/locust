import { describe, expect, it } from 'vitest'

import { activityEntries, buildThread, foldPlainToolRuns, foldedToolsText } from './missionView.js'
import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

/**
 * A READ ROW NAMES THE FILE, NOT THE DISK.
 *
 * Yurt's beta report (2026-09-23, #16): "Read rows print full absolute
 * paths, cut off." OpenCode reports a read's path whole, and the fold drew
 * "read 3 — C:\Users\<home>\Documents\locust-scratch\locust-walk-ws-EfOL3P,
 * C:\Users\<home>\Documents\loc..." -- the folder itself, then the start of
 * the next path, and nothing a person could read.
 */
let sequence = 0
function event(type: string, payload: unknown): NormalizedRuntimeEvent {
  sequence += 1
  return {
    id: `run:${String(sequence)}`,
    runId: 'run',
    sequence,
    occurredAt: new Date(Date.UTC(2026, 8, 23, 12, 0, sequence)).toISOString(),
    sourceAdapter: 'opencode',
    type,
    payload
  } as unknown as NormalizedRuntimeEvent
}

const WORKSPACE = 'C:\\Users\\<home>\\Documents\\locust-scratch\\locust-walk-ws-EfOL3P'
const read = (itemId: string, path: string): readonly NormalizedRuntimeEvent[] => [
  event('tool.started', { itemId, toolKind: 'tool_use', name: 'read', command: path, phase: 'started' }),
  event('tool.completed', { itemId, toolKind: 'tool_use', name: 'read', command: path, phase: 'completed' })
]
const events = [
  event('run.started', {}),
  ...read('a', WORKSPACE),
  ...read('b', `${WORKSPACE}\\README.md`),
  ...read('c', `${WORKSPACE}\\src\\index.ts`),
  event('run.completed', {})
]

describe('the reads in a turn', () => {
  it('fold under names relative to the folder', () => {
    const activity = buildThread(events, { running: false, workspacePath: WORKSPACE }).find((item) => item.type === 'activity')
    const details = activity?.type === 'activity' ? activity.details : []
    const folded = foldPlainToolRuns(activityEntries(details, WORKSPACE)).find((entry) => entry.kind === 'tools')
    expect(folded?.kind === 'tools' ? foldedToolsText(folded.names, folded.verb) : '').toBe('Read 3 files — locust-walk-ws-EfOL3P, README.md, src/index.ts')
  })

  it('leave a name that is not a path as it was', () => {
    const details = [{ kind: 'tool' as const, name: 'web search', tool: 'search', settled: true }]
    const entries = activityEntries(details as never, WORKSPACE)
    expect(entries[0]?.kind === 'tool' ? entries[0].name : '').toBe('web search')
  })
})
