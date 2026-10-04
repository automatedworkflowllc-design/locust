import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * The thread asks whether a plan was carried out; it does not assume.
 *
 * Its behaviour is guarded next door in
 * `renderer/src/a-plan-shows-what-happened-to-it.test.ts`. This half reads
 * the component, which needs node types and so has to live here.
 */

const THREAD = readFileSync(
  fileURLToPath(new URL('../renderer/src/components/Thread.tsx', import.meta.url)),
  'utf8'
)

describe('drawing a plan', () => {
  it('no longer hard-codes every plan as an answer', () => {
    /*
     * `outcomes={false}` draws the plain numbered list -- no markers, no
     * "N of M done". Right for a turn that only planned; wrong for one that
     * did the work, which is every other turn. Colin's ledger had 29
     * `plan.updated` events whose last state was all `TODO_STATUS_COMPLETED`
     * being drawn as though nothing had happened to them.
     */
    expect(THREAD).not.toContain('outcomes={false}')
  })

  it('draws the plan as the answer only when the person asked for a plan', () => {
    /*
     * `touchedNothing` alone was the rule here, on the reasoning that it is
     * set only when a turn had no activity at all. It is also true of a turn
     * in ACCEPT EDITS that answers a question without editing anything --
     * and that turn's working to-do list was then drawn as a deliverable:
     * ordinals, reading size, no PLAN header, landing mid-conversation as a
     * stray numbered line. Colin, in his own app, 2026-09-19: "the task/plan
     * looked like it was showing up glitchy and not our usual ui".
     *
     * The mode is the other half, and it is the same half the sentence under
     * the steps needs (Fable, pass 1, finding 4).
     */
    expect(THREAD).toContain('outcomes={!(planMode && item.touchedNothing === true)}')
    expect(THREAD).toContain('planMode && item.steps.length > 0 && item.touchedNothing === true')
  })
})
