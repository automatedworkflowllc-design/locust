import { describe, expect, it } from 'vitest'

import { buildThread } from './missionView.js'
import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

/**
 * A plan that ran shows what happened to it.
 *
 * Colin, 2026-09-15: *"i thought we fixed this but plans are still bugged and
 * not showing in the UI."* They were showing. They were showing as though
 * nothing had happened to them.
 *
 * The thread drew every plan with `outcomes={false}` — a plain numbered list,
 * no markers, no `N of M done`. That is correct for a Plan-MODE turn, where
 * the plan is the teammate's answer and nothing ran. It was being used for
 * every other turn too.
 *
 * MEASURED IN HIS OWN LEDGER, which is what settled it: 29 `plan.updated`
 * events across 27 Cursor missions, and the last update of each mission all
 * `TODO_STATUS_COMPLETED`. The app knew three of three steps were done and
 * drew three identical lines, while the fold underneath said "3 of 3 steps".
 *
 * `touchedNothing` already carried the distinction — it is set only when a
 * turn had no activity at all — so it decides this too rather than a second
 * flag meaning the same thing.
 *
 * This half is behaviour. The half that reads `Thread.tsx` lives in `main/`,
 * where node types are configured -- the web tsconfig has none, so a
 * `node:fs` import here does not compile. Third time that has caught me.
 */

const at = '2026-09-15T10:00:00.000Z'
const event = (type: string, payload: Record<string, unknown> = {}): NormalizedRuntimeEvent =>
  ({ id: `e-${type}-${JSON.stringify(payload).length}`, runId: 'r', missionId: 'm', sequence: 1, occurredAt: at, sourceAdapter: 'cursor', type, payload }) as unknown as NormalizedRuntimeEvent

/** Cursor's own spelling, from the ledger: `content` and `TODO_STATUS_*`. */
const plan = (...states: string[]) =>
  event('plan.updated', {
    plan: states.map((status, index) => ({ content: `step ${String(index + 1)}`, status }))
  })

const planItem = (events: readonly NormalizedRuntimeEvent[]) =>
  buildThread(events, { running: false, mayEdit: true, startedAt: at }).find((item) => item.type === 'plan') as
    | { readonly steps: readonly { readonly state: string }[]; readonly doneCount: number; readonly touchedNothing?: true }
    | undefined

describe('a turn that only planned', () => {
  it('is marked as having touched nothing, so it draws as an answer', () => {
    const item = planItem([plan('TODO_STATUS_PENDING', 'TODO_STATUS_PENDING')])
    expect(item?.touchedNothing).toBe(true)
  })
})

describe('a turn that carried its plan out', () => {
  it('is NOT marked as having touched nothing, so its outcomes are drawn', () => {
    /*
     * This is the whole bug. With activity in the turn the flag is absent,
     * and the thread now reads that as "show the markers".
     */
    const item = planItem([
      plan('TODO_STATUS_COMPLETED', 'TODO_STATUS_COMPLETED'),
      event('tool.started', { itemId: 't1', name: 'read', command: 'read' }),
      event('tool.completed', { itemId: 't1' })
    ])
    expect(item?.touchedNothing).toBeUndefined()
  })

  it('counts the steps that finished', () => {
    const item = planItem([
      plan('TODO_STATUS_COMPLETED', 'TODO_STATUS_COMPLETED', 'TODO_STATUS_PENDING'),
      event('tool.started', { itemId: 't1', name: 'read', command: 'read' })
    ])
    expect(item?.doneCount).toBe(2)
    expect(item?.steps).toHaveLength(3)
  })

  it("reads Cursor's own status spelling", () => {
    // `TODO_STATUS_COMPLETED` and `TODO_STATUS_IN_PROGRESS` are what the
    // ledger actually holds -- 38 and 17 of them across his missions.
    const item = planItem([
      plan('TODO_STATUS_COMPLETED', 'TODO_STATUS_IN_PROGRESS', 'TODO_STATUS_PENDING'),
      event('tool.started', { itemId: 't1', name: 'read', command: 'read' })
    ])
    expect(item?.steps.map((step) => step.state)).toEqual(['done', 'running', 'pending'])
  })
})
