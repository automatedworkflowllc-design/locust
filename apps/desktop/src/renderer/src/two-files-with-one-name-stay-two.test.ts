import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'
import { describe, expect, it } from 'vitest'

import { activityCounts, buildThread } from './missionView.js'

/**
 * H10: TWO FILES WITH ONE NAME STAY TWO. The host's observation of a changed
 * file was matched to the runtime's row by basename, and every other row of
 * that basename was then removed -- so packages/a/package.json and
 * packages/b/package.json were one row showing b's diff, "1 file", and a's
 * change was gone from the fold, the counts and Artifacts. The review's
 * scenario, as events.
 */
let sequence = 0
const event = (type: string, payload: Record<string, unknown>): NormalizedRuntimeEvent =>
  ({ id: `e${String(++sequence)}`, runId: 'run_1', missionId: 'mission_1', sequence, type, occurredAt: '2026-09-24T12:00:00.000Z', sourceAdapter: 'claude', payload }) as unknown as NormalizedRuntimeEvent
const patch = (path: string, from: string, to: string) => ({ text: `--- a/${path}\n+++ b/${path}\n@@ -2 +2 @@\n-  "version": "${from}"\n+  "version": "${to}"\n`, added: 1, removed: 1, truncated: false })
const REPORTED = 'reported by the runtime, read from disk'

function run(): NormalizedRuntimeEvent[] {
  const events: NormalizedRuntimeEvent[] = []
  for (const [id, pkg] of [['a', 'packages/a/package.json'], ['b', 'packages/b/package.json']] as const) {
    const absolute = `C:\\work\\repo\\${pkg.replace(/\//g, '\\')}`
    events.push(event('tool.started', { itemId: `edit_${id}`, toolKind: 'edit', name: 'edit', command: absolute, phase: 'started' }))
    events.push(event('tool.completed', { itemId: `edit_${id}`, toolKind: 'edit', name: 'edit', command: absolute, phase: 'completed', patch: patch(pkg, '1.0.0', '1.0.1') }))
  }
  for (const [id, pkg] of [['a', 'packages/a/package.json'], ['b', 'packages/b/package.json']] as const) {
    events.push(event('tool.started', { itemId: `obs_${id}`, toolKind: 'observed_edit', name: 'edit', command: pkg, status: REPORTED, phase: 'started' }))
    events.push(event('tool.completed', { itemId: `obs_${id}`, toolKind: 'observed_edit', name: 'edit', command: pkg, status: REPORTED, phase: 'completed', patch: patch(pkg, '1.0.0', '1.0.1') }))
  }
  return events
}

describe('two changed files that share a name', () => {
  for (const workspacePath of ['C:\\work\\repo', undefined]) {
    it(`are two rows, each with its own change${workspacePath === undefined ? ' (no workspace known)' : ''}`, () => {
      const thread = buildThread(run(), { running: false, ...(workspacePath === undefined ? {} : { workspacePath }) })
      const activity = thread.find((item) => item.type === 'activity')
      const details = activity?.type === 'activity' ? activity.details : []
      const edits = details.filter((detail) => detail.kind === 'edit')
      expect(edits.map((detail) => detail.name.replace(/\\/g, '/').toLowerCase().split('/').slice(-3).join('/')).sort()).toEqual(['packages/a/package.json', 'packages/b/package.json'])
      expect(activityCounts(details)).toEqual({ added: 2, removed: 2 })
      expect(activity?.type === 'activity' && activity.summary).toBe('Edited 2 files')
    })
  }
})
