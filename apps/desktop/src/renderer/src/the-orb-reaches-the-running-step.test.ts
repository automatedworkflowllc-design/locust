import { describe, expect, it } from 'vitest'

import { buildThread } from './missionView.js'
import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

/**
 * The orb on the live step, through the whole path: a runtime's own
 * `tool.started` in, a mapped orb out.
 *
 * `the-orb-never-contradicts-the-row.test.ts` pins the mapping function.
 * This pins the thing that is easy to get wrong around it — that the mapping
 * is actually consulted, on the right branch, and that it stops the moment
 * the tool closes.
 *
 * IT EXISTS BECAUSE THE DRIVE COULD NOT SEE IT. A live drive on the free
 * OpenCode model ran a read and an eight-second shell command, and the live
 * step said `working` for all fifty seconds: OpenCode reports its tool events
 * when the tool FINISHES, so there is never an open-tool window to draw an
 * orb in. Measured twice, 2026-09-20 — once with a fast tool, then again with
 * a deliberately slow one to rule out the sampling rate.
 *
 * That is a real fact about the feature and not a gap in it: on OpenCode the
 * orb is simply absent, which is the honest outcome when the runtime reports
 * nothing to be honest about. On runtimes that stream tool starts it appears.
 * Here that is proven with constructed events rather than with quota.
 */

const at = '2026-09-20T10:00:00.000Z'

const started = (itemId: string, name: string, toolKind?: string, command?: string): NormalizedRuntimeEvent =>
  ({
    id: `s-${itemId}`,
    runId: 'r',
    missionId: 'm',
    sequence: 1,
    occurredAt: at,
    sourceAdapter: 'codex',
    type: 'tool.started',
    payload: { itemId, name, ...(toolKind === undefined ? {} : { toolKind }), ...(command === undefined ? {} : { command }) }
  }) as unknown as NormalizedRuntimeEvent

const completed = (itemId: string): NormalizedRuntimeEvent =>
  ({
    id: `c-${itemId}`,
    runId: 'r',
    missionId: 'm',
    sequence: 2,
    occurredAt: at,
    sourceAdapter: 'codex',
    type: 'tool.completed',
    payload: { itemId, status: 'completed' }
  }) as unknown as NormalizedRuntimeEvent

const liveStep = (events: readonly NormalizedRuntimeEvent[], planMode = false) => {
  const item = buildThread(events, { running: true, mayEdit: true, startedAt: at, planMode }).find(
    (entry) => entry.type === 'live-step'
  )
  return item?.type === 'live-step' ? item : undefined
}

describe('the orb reaches the running step', () => {
  it('a shell command that is still open draws the working orb', () => {
    const step = liveStep([started('t1', 'shell', 'command_execution', 'pnpm test billing')])
    expect(step?.register).toBe('tool')
    expect(step?.orb).toBe('working')
  })

  it('a read that is still open draws the searching orb', () => {
    const step = liveStep([started('t1', 'read_file')])
    expect(step?.orb).toBe('searching')
  })

  it('a subagent that is still out draws the connecting orb', () => {
    const step = liveStep([started('t1', 'Task')])
    expect(step?.orb).toBe('connecting')
  })

  it('stops the moment the tool closes', () => {
    /*
     * The orb is a statement about work happening NOW. A tool that has
     * completed is not happening, and an orb left spinning over a finished
     * call is the app saying something is running when nothing is.
     */
    const step = liveStep([started('t1', 'shell', 'command_execution', 'ls'), completed('t1')])
    expect(step?.orb).toBeUndefined()
  })

  it('a Plan-mode turn with no tool open draws the solving orb', () => {
    expect(liveStep([], true)?.orb).toBe('solving')
  })

  it('an ordinary turn with no tool open draws none', () => {
    expect(liveStep([], false)?.orb).toBeUndefined()
  })

  it('a runtime that reports its tools only on completion draws none, and that is correct', () => {
    // OpenCode's shape, measured live: start and finish arrive together, so
    // the tool is never open when the thread is built. No orb, no lie.
    const step = liveStep([started('t1', 'shell', 'command_execution', 'echo orb'), completed('t1')])
    expect(step?.orb).toBeUndefined()
  })
})
