import { describe, expect, it } from 'vitest'

import { buildThread } from './missionView.js'
import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

/**
 * A PLAN STEP LEFT `pending` UNDER A FINISHED ANSWER IS A LIE ABOUT TENSE.
 *
 * A plan's last state is whatever the runtime last sent. A run that ends --
 * completed, failed, cancelled -- without a closing `plan.updated` therefore
 * leaves its unfinished steps exactly as they were, and the card drew a
 * pending step the same way whether the run was still coming to it or had
 * stopped without it. So a finished turn sat under a list of things that
 * read as still to come and never were.
 *
 * Neither agent that looked at this reproduced it: both their runs ended
 * with every step `is-done`, which is what a well-behaved runtime does. The
 * handoff of 2026-09-21 said to build the fixture by hand, so this is that
 * fixture -- a plan whose last update leaves a step pending, then a
 * `run.completed`.
 *
 * What is NOT done: the steps are not rewritten. Marking them done would be
 * a lie about the run, and dropping them would hide that it planned
 * something it did not do -- which is usually the most useful thing on the
 * card.
 */
const RUN = 'run_1'
let sequence = 0

function event(type: string, payload: unknown): NormalizedRuntimeEvent {
  sequence += 1
  return {
    id: `${RUN}:${String(sequence)}`,
    runId: RUN,
    sequence,
    occurredAt: new Date(Date.UTC(2026, 8, 22, 6, sequence)).toISOString(),
    sourceAdapter: 'codex',
    type,
    payload
  } as unknown as NormalizedRuntimeEvent
}

/** Two steps: the first done, the second never started. */
const PLAN = [
  { step: 'Read the config', status: 'completed' },
  { step: 'Rewrite the failing test', status: 'pending' }
]

function planItem(events: readonly NormalizedRuntimeEvent[], running: boolean) {
  return buildThread(events, { running, mayEdit: true }).find((item) => item.type === 'plan')
}

describe('a step that never ran is not still to come', () => {
  const events = [
    event('run.started', {}),
    event('plan.updated', { itemId: 'plan', plan: PLAN, final: false }),
    event('message.delta', { itemId: 'msg', operation: 'replace', text: 'I read the config.', final: true }),
    event('run.completed', {})
  ]

  it('still shows the plan, with the step it did not reach', () => {
    const plan = planItem(events, false)
    expect(plan, 'the plan vanished from a finished turn').toBeDefined()
    const card = plan as { steps: readonly { text: string; state: string }[]; doneCount: number; finished?: boolean }
    expect(card.steps).toHaveLength(2)
    expect(card.doneCount).toBe(1)
    // The unreached step is KEPT, and kept honest: not promoted to done.
    expect(card.steps[1]?.state).not.toBe('done')
  })

  it('tells the card the run has ended', () => {
    // This is the whole fix: the card cannot tell "not yet" from "never"
    // without being told which one it is looking at.
    expect((planItem(events, false) as { finished?: boolean }).finished).toBe(true)
  })

  it('says nothing of the sort while the run is still going', () => {
    /*
     * The control, and it is the one that matters. `pending` means "not
     * yet" during a run and the card must go on saying so -- a fix that
     * reported "not reached" on a live turn would be the same defect
     * pointed at the other tense.
     */
    const live = planItem(events.slice(0, 3), true) as { finished?: boolean }
    expect(live).toBeDefined()
    expect(live.finished).toBeUndefined()
  })

  it('has nothing to report when the runtime closed its own plan', () => {
    // The ordinary case both earlier agents saw: every step done, so there
    // is no gap between what was planned and what happened.
    const tidy = [
      event('run.started', {}),
      event('plan.updated', {
        itemId: 'plan',
        plan: PLAN.map((step) => ({ ...step, status: 'completed' })),
        final: true
      }),
      event('run.completed', {})
    ]
    const card = planItem(tidy, false) as { steps: readonly unknown[]; doneCount: number }
    expect(card.doneCount).toBe(card.steps.length)
  })
})
