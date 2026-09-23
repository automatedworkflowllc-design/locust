import { describe, expect, it } from 'vitest'

import { buildThread, lastPlanOf } from './missionView.js'
import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

/**
 * A TURN'S PLAN CARD SHOWS THAT TURN'S STEPS.
 *
 * OpenCode keeps one to-do list for the whole session and sends all of it on
 * every turn. Yurt's beta report (2026-09-23, #5): on turn eight of eight the
 * card read "8 of 8 done" over the seven "Create notes/..." steps turns one to
 * seven had already finished -- and since every card grew by one each turn,
 * it is also why a long conversation's newest answer sat further and further
 * below the fold (#3). The drive of 2026-09-23 showed turn three listing
 * seven steps, five of them from turns one and two.
 */
let sequence = 0

function event(type: string, payload: unknown): NormalizedRuntimeEvent {
  sequence += 1
  return {
    id: `run:${String(sequence)}`,
    runId: 'run',
    sequence,
    occurredAt: new Date(Date.UTC(2026, 8, 23, 8, sequence)).toISOString(),
    sourceAdapter: 'opencode',
    type,
    payload
  } as unknown as NormalizedRuntimeEvent
}

/** OpenCode's todo list, in its own words (`content`, `status`). */
const todo = (...steps: readonly (readonly [string, string])[]) =>
  steps.map(([content, status]) => ({ content, status }))

const TURN_2 = [
  event('run.started', {}),
  event('plan.updated', {
    itemId: 'todo',
    plan: todo(['Create notes/one.txt containing ALPHA', 'completed'], ['Create notes/two.txt containing BRAVO', 'in_progress'])
  }),
  event('plan.updated', {
    itemId: 'todo',
    plan: todo(['Create notes/one.txt containing ALPHA', 'completed'], ['Create notes/two.txt containing BRAVO', 'completed'])
  }),
  event('run.completed', {})
]

const TURN_3 = [
  event('run.started', {}),
  event('plan.updated', {
    itemId: 'todo',
    plan: todo(
      ['Create notes/one.txt containing ALPHA', 'completed'],
      ['Create notes/two.txt containing BRAVO', 'completed'],
      ['Create notes/three.txt containing CHARLIE', 'pending']
    )
  }),
  event('plan.updated', {
    itemId: 'todo',
    plan: todo(
      ['Create notes/one.txt containing ALPHA', 'completed'],
      ['Create notes/two.txt containing BRAVO', 'completed'],
      ['Create notes/three.txt containing CHARLIE', 'completed']
    )
  }),
  event('run.completed', {})
]

type PlanCard = { readonly steps: readonly { readonly text: string; readonly state: string }[]; readonly doneCount: number }
const planOf = (events: readonly NormalizedRuntimeEvent[], carried: ReturnType<typeof lastPlanOf>): PlanCard | undefined =>
  buildThread(events, { running: false, mayEdit: true, carriedPlan: carried }).find((item) => item.type === 'plan') as PlanCard | undefined

describe("a turn's plan card", () => {
  it('leaves out the steps earlier turns finished', () => {
    const card = planOf(TURN_3, lastPlanOf(TURN_2))
    expect(card?.steps.map((step) => step.text)).toEqual(['Create notes/three.txt containing CHARLIE'])
    expect(card?.doneCount).toBe(1)
  })

  it('keeps a step this turn worked on, even one an earlier turn had finished', () => {
    // Re-opened and done again: it is this turn's work too.
    const again = [
      event('plan.updated', { itemId: 'todo', plan: todo(['Create notes/two.txt containing BRAVO', 'in_progress']) }),
      event('plan.updated', { itemId: 'todo', plan: todo(['Create notes/two.txt containing BRAVO', 'completed']) })
    ]
    expect(planOf(again, lastPlanOf(TURN_2))?.steps).toHaveLength(1)
  })

  it('draws no card for a turn that only repeated a finished list', () => {
    const repeated = [event('plan.updated', { itemId: 'todo', plan: lastPlanOf(TURN_2).map((step) => ({ content: step.text, status: 'completed' })) })]
    expect(planOf(repeated, lastPlanOf(TURN_2))).toBeUndefined()
  })

  it('is untouched on the first turn, and where the runtime starts a fresh plan each turn', () => {
    expect(planOf(TURN_2, [])?.steps).toHaveLength(2)
    const fresh = [event('plan.updated', { itemId: 'todo', plan: todo(['Read the config', 'completed']) })]
    expect(planOf(fresh, lastPlanOf(TURN_2))?.steps).toHaveLength(1)
  })
})
