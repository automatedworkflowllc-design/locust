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
    expect(step?.orb).toBe('listening')
  })

  it('a read that is still open draws the searching orb', () => {
    const step = liveStep([started('t1', 'read_file')])
    expect(step?.orb).toBe('searching')
  })

  it('a subagent that is still out draws the connecting orb', () => {
    const step = liveStep([started('t1', 'Task')])
    expect(step?.orb).toBe('connecting')
  })

  it('stops claiming the work the moment the tool closes', () => {
    /*
     * The orb is a statement about work happening NOW, so when a tool closes
     * the SPECIFIC claim has to stop. The run is still going, so it drops to
     * the generic `working` rather than to nothing -- what it must not do is
     * keep saying `searching` over a read that finished.
     */
    const specific = liveStep([started('t1', 'read_file'), completed('t1')])
    expect(specific?.orb).not.toBe('searching')
    const step = liveStep([started('t1', 'shell', 'command_execution', 'ls'), completed('t1')])
    expect(step?.orb).toBe('listening')
  })

  it('a Plan-mode turn with no tool open draws the solving orb', () => {
    expect(liveStep([], true)?.orb).toBe('solving')
  })

  it('an ordinary turn with no tool open still draws the floor', () => {
    /*
     * Colin's frame, 2026-09-20: a real Cursor run at `starting ••• 16s` with
     * nothing drawn. A live row is never bare now -- the teammate is there,
     * and `breathing` says that and nothing more.
     */
    expect(liveStep([], false)?.orb).toBe('breathing')
  })

  it('a runtime that reports its tools only on completion still shows it is alive', () => {
    // OpenCode's shape, measured live twice: start and finish arrive
    // together, so no tool is ever open. Before the floor this drew nothing
    // at all, which is why the feature was invisible on the one route that
    // costs nothing to test with. It draws the generic orb now -- the run is
    // working, and the app does not pretend to know more than that.
    const step = liveStep([started('t1', 'shell', 'command_execution', 'echo orb'), completed('t1')])
    expect(step?.orb).toBe('listening')
  })
})
