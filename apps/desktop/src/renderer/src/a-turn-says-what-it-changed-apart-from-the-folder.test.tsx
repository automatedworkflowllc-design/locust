import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'
import { ThreadItems } from './components/Thread.js'
import { buildThread } from './missionView.js'

/**
 * A TURN SAYS WHAT IT CHANGED, APART FROM WHAT CHANGED AROUND IT (0.491).
 *
 * Colin works in his `.claude` folder, where Claude Code writes its own
 * backups and file history while a teammate runs. The host looks at the
 * folder after a run and lists every changed file, and a turn that wrote one
 * report closed with "Edited 20 files". The files the runtime named are what
 * it edited; the rest only changed in the folder while it ran.
 */
;(globalThis as { window?: unknown }).window = { desktop: { platform: 'win32' } }
let sequence = 0
function event(type: string, payload: Record<string, unknown>): NormalizedRuntimeEvent {
  sequence += 1
  return {
    id: `evt_${String(sequence)}`, runId: 'run_1', missionId: 'mission_1', sequence,
    occurredAt: '2026-09-30T05:00:00.000Z', sourceAdapter: 'claude', type,
    payload: { evidence: { redacted: false }, ...payload }
  } as unknown as NormalizedRuntimeEvent
}
const patch = (path: string): Record<string, unknown> => ({
  text: `diff --git a/${path} b/${path}\nnew file mode 100644\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1 @@\n+x\n`, truncated: false, added: 1, removed: 0
})

const events = [
  event('run.started', {}),
  event('message.delta', { itemId: 'm1', operation: 'append', text: 'Writing the report.', final: true }),
  event('tool.started', { itemId: 'w1', toolKind: 'file_change', name: 'Write', command: 'report.md', phase: 'started' }),
  event('tool.completed', { itemId: 'w1', toolKind: 'file_change', name: 'Write', command: 'report.md', phase: 'completed', patch: patch('report.md') }),
  event('message.delta', { itemId: 'm2', operation: 'append', text: 'Done.', final: true }),
  event('run.completed', { process: { exitCode: 0 } }),
  // The host's look at the folder: two files Claude Code itself wrote.
  ...['file-history/abc@v2', 'backups/.claude.json.backup.1'].flatMap((path, index) => [
    event('tool.started', { itemId: `obs${String(index)}`, toolKind: 'observed_edit', name: 'edit', command: path, status: 'observed on disk', phase: 'started' }),
    event('tool.completed', { itemId: `obs${String(index)}`, toolKind: 'observed_edit', name: 'edit', command: path, status: 'observed on disk', phase: 'completed', patch: patch(path) })
  ])
]

describe('the foot of a finished turn', () => {
  it('counts what the runtime edited apart from what only changed in the folder', () => {
    const html = renderToStaticMarkup(
      <ThreadItems items={buildThread(events, { running: false })} owner={undefined} activity="idle" workspacePath="C:/work" decision={undefined} />
    )
    expect(html).toContain('Edited 1 file · 2 more changed in the folder')
    expect(html).not.toContain('Edited 3 files')
  })

  it('says a turn that edited nothing itself only saw files change', () => {
    const quiet = events.filter((one) => !['w1'].includes((one.payload as { itemId?: string }).itemId ?? ''))
    const html = renderToStaticMarkup(
      <ThreadItems items={buildThread(quiet, { running: false })} owner={undefined} activity="idle" workspacePath="C:/work" decision={undefined} />
    )
    expect(html).toContain('2 files changed in the folder while it ran')
  })

  it('counts a file the host could not read once, as the step that changed it (0.672)', () => {
    // The host's look named report.md and could not read it (past 64 KB): its word sits beside the step's diff.
    const unread = [
      ...events.slice(0, 6),
      event('tool.started', { itemId: 'obs-r', toolKind: 'observed_edit', name: 'edit', command: 'report.md', status: 'reported by the runtime, changed on disk', phase: 'started' }),
      event('tool.completed', { itemId: 'obs-r', toolKind: 'observed_edit', name: 'edit', command: 'report.md', status: 'reported by the runtime, changed on disk', phase: 'completed' })
    ]
    const html = renderToStaticMarkup(
      <ThreadItems items={buildThread(unread, { running: false })} owner={undefined} activity="idle" workspacePath="C:/work" decision={undefined} />
    )
    expect(html).toContain('Edited 1 file')
    expect(html).not.toContain('more changed in the folder')
  })

  it('draws no foot while the turn is still going', () => {
    const html = renderToStaticMarkup(
      <ThreadItems items={buildThread(events.slice(0, 4), { running: true })} owner={undefined} activity="working" workspacePath="C:/work" decision={undefined} />
    )
    expect(html).not.toContain('lc-turnfoot')
    expect(html).toContain('lc-steps__line')
  })
})
