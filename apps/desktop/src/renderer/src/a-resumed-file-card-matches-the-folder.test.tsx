import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'
import { ActivityCard } from './components/ActivityCard.js'
import { ThreadItems } from './components/Thread.js'
import { activityEntries, buildThread, netFileEntries, pathInWorkspace } from './missionView.js'
import type { ActivityDetail } from './missionView.js'

/**
 * A RESUMED COMPARE COLUMN'S FILE CARD (2026-10-05).
 *
 * After a three-model compare ran out of memory and each column was resumed,
 * Claude Code / Sonnet's foot said "Edited N files" over rows that each read
 * "Write · Claude Code did not report the change", while the column footer
 * said "+3456 −0 in 1 file". The Writes had completed (with paths, without
 * diffs) into a scratch folder outside the compare copy; the host had
 * observed only index.html inside it.
 */
;(globalThis as { window?: unknown }).window = { desktop: { platform: 'win32' } }

let sequence = 0
function event(type: string, payload: Record<string, unknown>): NormalizedRuntimeEvent {
  sequence += 1
  return {
    id: `evt_${String(sequence)}`,
    runId: 'run_1',
    missionId: 'mission_1',
    sequence,
    occurredAt: '2026-10-05T06:00:00.000Z',
    sourceAdapter: 'claude',
    type,
    payload: { evidence: { redacted: false }, ...payload }
  } as unknown as NormalizedRuntimeEvent
}

const WORKSPACE = 'C:/Users/me/.locust/compare/cmp_demo-a'
const SCRATCH = 'C:/Users/me/scratch/ember'

/** Shape of the resumed ledger: many outside Writes, no patches; one file seen in the folder. */
function resumedShape(): NormalizedRuntimeEvent[] {
  const writes = ['cdp.mjs', 'play.mjs', 'patch5.mjs', 't3.mjs'].flatMap((name, index) => {
    const path = `${SCRATCH}/${name}`
    const id = `w${String(index)}`
    return [
      event('tool.started', { itemId: id, toolKind: 'tool_use', name: 'Write', phase: 'started' }),
      event('tool.started', { itemId: id, toolKind: 'tool_use', name: 'Write', command: path, phase: 'started' }),
      event('tool.completed', { itemId: id, toolKind: 'tool_use', name: 'Write', command: path, phase: 'completed' })
    ]
  })
  // Same file written twice (Write then Edit): must still be one file once it counts.
  const twice = [
    event('tool.started', { itemId: 'same1', toolKind: 'tool_use', name: 'Write', command: `${SCRATCH}/profile.mjs`, phase: 'started' }),
    event('tool.completed', { itemId: 'same1', toolKind: 'tool_use', name: 'Write', command: `${SCRATCH}/profile.mjs`, phase: 'completed' }),
    event('tool.started', { itemId: 'same2', toolKind: 'tool_use', name: 'Edit', command: `${SCRATCH}/profile.mjs`, phase: 'started' }),
    event('tool.completed', { itemId: 'same2', toolKind: 'tool_use', name: 'Edit', command: `${SCRATCH}/profile.mjs`, phase: 'completed' })
  ]
  return [
    event('run.started', {}),
    event('message.delta', { itemId: 'm1', operation: 'append', text: 'Continuing.', final: true }),
    ...writes,
    ...twice,
    event('message.delta', { itemId: 'm2', operation: 'append', text: 'Done.', final: true }),
    event('run.completed', { process: { exitCode: 0 } }),
    event('tool.started', {
      itemId: 'obs',
      toolKind: 'observed_edit',
      name: 'edit',
      command: 'index.html',
      status: 'observed on disk',
      phase: 'started'
    }),
    event('tool.completed', {
      itemId: 'obs',
      toolKind: 'observed_edit',
      name: 'edit',
      command: 'index.html',
      status: 'observed on disk',
      phase: 'completed',
      patch: {
        text: 'diff --git a/index.html b/index.html\nnew file mode 100644\n--- /dev/null\n+++ b/index.html\n@@ -0,0 +1 @@\n+game\n',
        truncated: false,
        added: 3456,
        removed: 0
      }
    })
  ]
}

function foot(events: readonly NormalizedRuntimeEvent[]): string {
  return renderToStaticMarkup(
    <ThreadItems
      items={buildThread(events, { running: false, workspacePath: WORKSPACE })}
      owner={undefined}
      activity="idle"
      workspacePath={WORKSPACE}
      decision={undefined}
    />
  )
}

describe("a resumed run's file card", () => {
  it('counts the folder\'s change, not every Write outside it, and does not blame Claude Code for those Writes', () => {
    const html = foot(resumedShape())
    // The compare footer is one file; the turn's files card must agree.
    expect(html).toContain('lc-turnfoot')
    expect(html).toContain('1 file changed in the folder while it ran')
    expect(html).not.toContain('Claude Code did not report')
    expect(html).toContain('index.html')
    // The files card itself must not restate the scratch Writes as edited files.
    const footHtml = html.slice(html.indexOf('lc-turnfoot'))
    expect(footHtml).not.toMatch(/Edited \d+ files?/)
  })

  it('keeps a normal finished turn\'s card: one Write with a diff is still one edited file', () => {
    const events = [
      event('run.started', {}),
      event('tool.started', { itemId: 'w', toolKind: 'file_change', name: 'Write', command: 'report.md', phase: 'started' }),
      event('tool.completed', {
        itemId: 'w',
        toolKind: 'file_change',
        name: 'Write',
        command: 'report.md',
        phase: 'completed',
        patch: {
          text: 'diff --git a/report.md b/report.md\nnew file mode 100644\n--- /dev/null\n+++ b/report.md\n@@ -0,0 +1 @@\n+hi\n',
          truncated: false,
          added: 1,
          removed: 0
        }
      }),
      event('run.completed', { process: { exitCode: 0 } })
    ]
    const html = renderToStaticMarkup(
      <ThreadItems
        items={buildThread(events, { running: false, workspacePath: 'C:/work' })}
        owner={undefined}
        activity="idle"
        workspacePath="C:/work"
        decision={undefined}
      />
    )
    expect(html).toContain('Edited 1 file')
    expect(html).toContain('report.md')
    expect(html).not.toContain('did not report')
    expect(html).not.toContain('not confirmed')
  })

  it('says a Write the turn stopped before settling was stopped, not that Claude Code failed to report', () => {
    const detail = {
      kind: 'edit',
      name: 'notes.md',
      tool: 'Write',
      settled: false,
      failed: false
    } as ActivityDetail
    const html = renderToStaticMarkup(
      <ActivityCard
        summary=""
        variant="files"
        oneRowPerFile
        trace={[{ key: 'edited', text: 'Edited 1 file' }]}
        finished
        details={[detail]}
        runtimeName="Claude Code"
        workspacePath="C:/work"
        openByDefault
      />
    )
    expect(html).toContain('not confirmed')
    expect(html).not.toContain('Claude Code did not report')
    expect(html).not.toMatch(/>did not report</)
  })

  it('keeps one row when the same file was written twice without a diff', () => {
    const details: ActivityDetail[] = [
      { kind: 'edit', name: `${SCRATCH}/profile.mjs`, tool: 'Write', settled: true, failed: false },
      { kind: 'edit', name: `${SCRATCH}/profile.mjs`, tool: 'Edit', settled: true, failed: false }
    ]
    const entries = netFileEntries(activityEntries(details, WORKSPACE), WORKSPACE)
    expect(entries.filter((entry) => entry.kind === 'unreported')).toHaveLength(1)
  })

  it('knows a scratch path is not the compare folder', () => {
    expect(pathInWorkspace(`${SCRATCH}/cdp.mjs`, WORKSPACE)).toBe(false)
    expect(pathInWorkspace('index.html', WORKSPACE)).toBe(true)
    expect(pathInWorkspace(`${WORKSPACE}/index.html`, WORKSPACE)).toBe(true)
  })
})
