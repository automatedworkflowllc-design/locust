import { describe, expect, it } from 'vitest'

import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'
import { activityEntries, buildThread, netFileEntries } from './missionView.js'

/**
 * A STEP'S CHANGE STANDS IN FOR A FILE THE HOST COULD NOT READ (0.672).
 *
 * The turn's files card shows each file's net change, which the host reads
 * after the run. Past its limits it cannot read one -- a file over 64 KB,
 * a folder past 5,000 files; Colin works in `.claude` -- and its row said
 * "changed · seen on disk" with no counts, though the runtime had reported
 * the change exactly (Claude Code's Edit, since 0.672). One step that
 * changed the file IS its net change; several are not, and those keep the
 * host's word.
 */
let sequence = 0
const event = (type: string, payload: Record<string, unknown>): NormalizedRuntimeEvent => {
  sequence += 1
  return {
    id: `e${String(sequence)}`, runId: 'r', missionId: 'm', sequence, occurredAt: '2026-10-06T07:13:00.000Z',
    sourceAdapter: 'claude', type, payload: { evidence: { redacted: true }, ...payload }
  } as unknown as NormalizedRuntimeEvent
}
const FOLDER = 'C:\\work\\shop'
const NOTES = `${FOLDER}\\notes.txt`
const hunk = (path: string, to = 'line 2'): Record<string, unknown> => ({
  text: `--- ${path}\n+++ ${path}\n@@ -1,3 +1,3 @@\n line one\n-line two\n+${to}\n line three\n`,
  truncated: false, added: 1, removed: 1
})
const edit = (id: string, path: string, to?: string): NormalizedRuntimeEvent[] => [
  event('tool.started', { itemId: id, toolKind: 'tool_use', name: 'Edit', phase: 'started' }),
  event('tool.started', { itemId: id, toolKind: 'tool_use', name: 'Edit', command: path, phase: 'started' }),
  event('tool.completed', { itemId: id, toolKind: 'tool_use', name: 'Edit', command: path, phase: 'completed', patch: hunk(path, to) })
]
// The host's look after the run: the runtime named the file, and its text could not be read.
const unread = (id: string, path: string): NormalizedRuntimeEvent[] => [
  event('tool.started', { itemId: id, toolKind: 'observed_edit', name: 'edit', command: path, status: 'reported by the runtime, changed on disk', phase: 'started' }),
  event('tool.completed', { itemId: id, toolKind: 'observed_edit', name: 'edit', command: path, status: 'reported by the runtime, changed on disk', phase: 'completed' })
]
const filesOf = (events: readonly NormalizedRuntimeEvent[]): string[] => {
  const foot = buildThread(events, { running: false }).find((item) => item.type === 'activity')
  return netFileEntries(activityEntries(foot?.type === 'activity' ? foot.details : [], FOLDER), FOLDER).map((entry) =>
    entry.kind === 'file' ? `${entry.file.path} +${String(entry.counts.added)}/-${String(entry.counts.removed)}`
    : entry.kind === 'unreported' ? `${entry.name} ${entry.observed === true ? 'seen on disk' : 'unreported'}`
    : entry.kind)
}

describe("a turn's file the host could not read", () => {
  it('reads as the one step that changed it', () => {
    expect(filesOf([event('run.started', {}), ...edit('t1', NOTES), event('run.completed', {}), ...unread('o1', NOTES)])).toEqual([`${NOTES} +1/-1`])
  })

  it('reads as the step that landed, after edits that failed (Haiku, 2026-10-06: two Edits before reading)', () => {
    const failedEdit = (id: string): NormalizedRuntimeEvent[] => [
      event('tool.started', { itemId: id, toolKind: 'tool_use', name: 'Edit', command: NOTES, phase: 'started' }),
      event('tool.failed', { itemId: id, toolKind: 'tool_use', name: 'Edit', command: NOTES, phase: 'completed', status: 'error' })
    ]
    const events = [event('run.started', {}), ...failedEdit('f1'), ...failedEdit('f2'), ...edit('t1', NOTES), event('run.completed', {}), ...unread('o1', NOTES)]
    expect(filesOf(events)).toEqual([`${NOTES} +1/-1`])
    // And the failures stay failures among the steps: the host's look was laid on
    // the first of them, which then read "changed" with no failure at all.
    const steps = buildThread(events, { running: false }).flatMap((item) => (item.type === 'steps' ? item.details : []))
    expect(steps.filter((detail) => detail.kind === 'edit').map((detail) => detail.failed === true)).toEqual([true, true, false])
  })

  it('keeps the host\'s word when two steps changed it: neither is the whole change', () => {
    const files = filesOf([event('run.started', {}), ...edit('t1', NOTES), ...edit('t2', NOTES, 'line II'), event('run.completed', {}), ...unread('o1', NOTES)])
    expect(files).toHaveLength(1)
    expect(files[0]).toMatch(/notes\.txt seen on disk$/)
  })
})
