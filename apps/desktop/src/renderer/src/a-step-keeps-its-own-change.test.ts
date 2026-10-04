import { describe, expect, it } from 'vitest'

import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'
import { activityEntries, buildThread, netFileEntries } from './missionView.js'

/**
 * A STEP KEEPS ITS OWN CHANGE; THE TURN'S FILES ARE ONE ROW EACH (0.494).
 *
 * Sol's 0.492 pass, on a real Codex run: after the run the host looks at the
 * folder and records each file's net change. That record was laid onto the
 * step row of the same name, so a +2/-2 refinement step read +81/-1 once the
 * turn ended; and where a step's change covered several files at once the
 * record found no row, so the turn's card listed the file twice and summed
 * both -- "Edited 10 files" over twelve rows.
 */
let sequence = 0
const event = (type: string, payload: Record<string, unknown>): NormalizedRuntimeEvent => {
  sequence += 1
  return {
    id: `e${String(sequence)}`, runId: 'r', missionId: 'm', sequence, occurredAt: '2026-09-30T07:13:00.000Z',
    sourceAdapter: 'codex', type, payload: { evidence: { redacted: true }, ...payload }
  } as unknown as NormalizedRuntimeEvent
}
const diff = (path: string, added: number, removed: number): Record<string, unknown> => ({
  text: `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1,${String(removed)} +1,${String(added)} @@\n${'-old\n'.repeat(removed)}${'+new\n'.repeat(added)}`,
  truncated: false, added, removed
})
const change = (id: string, names: string, patch: Record<string, unknown>): NormalizedRuntimeEvent[] => [
  event('tool.started', { itemId: id, toolKind: 'fileChange', name: 'file_change', command: names, phase: 'started' }),
  event('tool.completed', { itemId: id, toolKind: 'fileChange', name: 'file_change', command: names, phase: 'completed', patch })
]
const seen = (id: string, path: string, patch: Record<string, unknown>): NormalizedRuntimeEvent[] => [
  event('tool.started', { itemId: id, toolKind: 'observed_edit', name: 'edit', command: path, status: 'reported by the runtime, read from disk', phase: 'started' }),
  event('tool.completed', { itemId: id, toolKind: 'observed_edit', name: 'edit', command: path, status: 'reported by the runtime, read from disk', phase: 'completed', patch })
]

const events = [
  event('run.started', {}),
  ...change('c1', 'src/cli.mjs', diff('src/cli.mjs', 80, 1)),
  event('message.delta', { itemId: 'm1', operation: 'append', text: 'Refining the month check.', final: true }),
  ...change('c2', 'src/cli.mjs', diff('src/cli.mjs', 2, 2)),
  event('message.delta', { itemId: 'm2', operation: 'append', text: 'Done.', final: true }),
  event('run.completed', {}),
  ...seen('o1', 'src/cli.mjs', diff('src/cli.mjs', 81, 1))
]

describe("a turn's changes", () => {
  it('keep each step its own diff, after the turn has ended too', () => {
    const steps = buildThread(events, { running: false }).flatMap((item) =>
      item.type === 'steps' ? [activityEntries(item.details).flatMap((entry) => (entry.kind === 'file' ? [`+${String(entry.counts.added)}/-${String(entry.counts.removed)}`] : []))] : []
    )
    expect(steps).toEqual([['+80/-1'], ['+2/-2']])
  })

  it("list each file once in the turn's files, as its net change", () => {
    const foot = buildThread(events, { running: false }).find((item) => item.type === 'activity')
    const files = netFileEntries(activityEntries(foot?.type === 'activity' ? foot.details : []))
      .flatMap((entry) => (entry.kind === 'file' ? [`${entry.file.path} +${String(entry.counts.added)}/-${String(entry.counts.removed)}`] : []))
    expect(files).toEqual(['src/cli.mjs +81/-1'])
  })
})
