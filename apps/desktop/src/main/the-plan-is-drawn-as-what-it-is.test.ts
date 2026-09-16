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

  it('decides it from the flag that already carries the distinction', () => {
    // `touchedNothing` is set only when a turn had no activity at all, so a
    // second flag meaning the same thing would be a second thing to keep
    // true.
    expect(THREAD).toContain('outcomes={item.touchedNothing !== true}')
  })
})
