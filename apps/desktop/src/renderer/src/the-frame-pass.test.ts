import { describe, expect, it } from 'vitest'

import { buildThread } from './missionView.js'
import { runtimeListOrder } from './status.js'
import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'
import type { PublicRuntimeStatus } from '../../shared/ipc.js'

/**
 * Three findings from the frame pass of 2026-09-15 that needed no design
 * input — each one visible in a screenshot and invisible in the source.
 */

const event = (type: string, occurredAt: string, payload: Record<string, unknown> = {}): NormalizedRuntimeEvent =>
  ({
    id: `e-${occurredAt}`,
    runId: 'r',
    missionId: 'm',
    sequence: 1,
    occurredAt,
    sourceAdapter: 'opencode',
    type,
    payload
  }) as unknown as NormalizedRuntimeEvent

const liveLine = (events: readonly NormalizedRuntimeEvent[], startedAt: string): { startedAt?: string } => {
  const items = buildThread(events, { running: true, mayEdit: true, startedAt })
  const live = items.find((item) => item.type === 'live-step')
  return (live ?? {}) as { startedAt?: string }
}

describe('A1 · the elapsed counter only ever climbs', () => {
  /*
   * Two captures of one running turn, seconds apart:
   *
   *     starting ... - 3s
   *     working  -    0s
   *
   * The counter restarted when the register changed, because each branch
   * timed from its own beginning. That is the one thing an elapsed counter
   * must never do, and it is worse here than in most apps: this number is
   * how a person tells a slow runtime from a hung one.
   */
  const TURN = '2026-09-15T10:00:00.000Z'

  it('times from the turn, not from the phase, before anything has happened', () => {
    expect(liveLine([], TURN).startedAt).toBe(TURN)
  })

  it('does not restart when a step opens three seconds in', () => {
    // The measured case: `starting` at 3s becoming `working` at 0s.
    const line = liveLine([event('run.started', '2026-09-15T10:00:03.000Z')], TURN)
    expect(line.startedAt).toBe(TURN)
  })

  it('does not restart when a tool opens either', () => {
    // `itemId` is the key the thread builder actually uses; a fixture with
    // the wrong field never opens a tool at all, and the test then passes
    // by missing the branch it is about. It did, until this was checked
    // against the un-fixed code and passed anyway.
    const line = liveLine(
      [
        event('run.started', '2026-09-15T10:00:01.000Z'),
        event('tool.started', '2026-09-15T10:00:09.000Z', { itemId: 't1', name: 'read', command: 'read' })
      ],
      TURN
    )
    expect(line.startedAt).toBe(TURN)
  })
})

describe('A3 · what you can use comes first', () => {
  /*
   * The list ran READY, READY, READY, **PLANNED**, READY, READY,
   * **PLANNED**, EXPERIMENTAL. Two runtimes that do not exist sat in the
   * middle of six that do, so a person scanning for what they could use had
   * to read every tag.
   */
  const runtime = (id: string, displayName: string): PublicRuntimeStatus =>
    ({ id, displayName, installed: true, version: null, auth: 'unknown', ready: true, status: 'ready' }) as PublicRuntimeStatus

  const TAGS: Record<string, string> = {
    codex: 'READY',
    claude: 'READY',
    cursor: 'READY',
    gemini: 'PLANNED',
    opencode: 'READY',
    copilot: 'READY',
    omniroute: 'PLANNED',
    antigravity: 'EXPERIMENTAL',
    offline: 'SIGN IN',
    absent: 'NOT INSTALLED'
  }

  it('bands them ready, experimental, sign-in, not installed, planned', () => {
    const order = runtimeListOrder(
      [
        runtime('gemini', 'Gemini CLI'),
        runtime('codex', 'Codex CLI'),
        runtime('antigravity', 'Antigravity'),
        runtime('absent', 'Absent CLI'),
        runtime('offline', 'Offline CLI'),
        runtime('omniroute', 'OmniRoute')
      ],
      (entry) => TAGS[entry.id] ?? 'NOT INSTALLED'
    ).map((entry) => entry.id)

    expect(order).toEqual(['codex', 'antigravity', 'offline', 'absent', 'gemini', 'omniroute'])
  })

  it('never leaves something that does not exist above something that does', () => {
    const order = runtimeListOrder(
      Object.keys(TAGS).map((id) => runtime(id, id)),
      (entry) => TAGS[entry.id] ?? 'NOT INSTALLED'
    )
    const lastReady = order.map((entry) => TAGS[entry.id]).lastIndexOf('READY')
    const firstPlanned = order.map((entry) => TAGS[entry.id]).indexOf('PLANNED')
    expect(firstPlanned).toBeGreaterThan(lastReady)
  })

  it('is stable between launches, so the list does not shuffle', () => {
    // Alphabetical inside a band: discovery order is not guaranteed, and a
    // settings list that reorders itself is one a person cannot learn.
    const order = runtimeListOrder(
      [runtime('cursor', 'Cursor Agent'), runtime('claude', 'Claude Code'), runtime('codex', 'Codex CLI')],
      () => 'READY'
    ).map((entry) => entry.displayName)
    expect(order).toEqual(['Claude Code', 'Codex CLI', 'Cursor Agent'])
  })
})
