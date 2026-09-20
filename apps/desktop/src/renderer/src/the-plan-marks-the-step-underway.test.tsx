import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { PlanSteps } from './components/ThreadItems.js'
import type { PlanStep } from './missionView.js'

/**
 * The plan's running step carries the same orb the live line does.
 *
 * Colin, 2026-09-20: *"lets use the orbs for the working portion of the plan
 * as well."* The two are making one claim — this is what is happening now —
 * so they show one mark, and it is the live line's own orb rather than a
 * second opinion about the same turn.
 *
 * Pinned here rather than driven because a drive would have to produce a run
 * that states a plan AND is still running when the frame is taken, which is a
 * lot of live machinery to assert a branch. The orb reaching the screen at
 * all is proven live by `_tools/orb-drive.mjs`; this proves the branch.
 */

const steps: readonly PlanStep[] = [
  { text: 'Read the ledger', state: 'done' },
  { text: 'Fix the parser', state: 'running' },
  { text: 'Write it up', state: 'pending' }
] as unknown as readonly PlanStep[]

const drawn = (orb?: 'working' | 'searching'): string =>
  renderToStaticMarkup(
    <PlanSteps steps={steps} doneCount={1} outcomes {...(orb === undefined ? {} : { orb })} />
  )

describe('the plan marks the step underway', () => {
  it('draws the orb on the running step when a turn is still going', () => {
    const html = drawn('working')
    expect(html).toContain('lc-plan__orb')
  })

  it('replaces the pulsing pip rather than joining it', () => {
    // Two things pulsing on one row is the row saying "now" twice.
    expect(drawn('working')).not.toContain('is-pulsing')
  })

  it('keeps the pip when no turn is running', () => {
    /*
     * A finished plan gets no orb. A moving mark on a step of a run that has
     * ended would say work is underway when none is — the same defect as an
     * orb left spinning over a closed tool.
     */
    const html = drawn()
    expect(html).not.toContain('lc-plan__orb')
    expect(html).toContain('is-pulsing')
  })

  it('never marks a done step as underway', () => {
    const html = drawn('working')
    const orbAt = html.indexOf('lc-plan__orb')
    const firstStep = html.indexOf('Read the ledger')
    // The orb comes after the first (done) step's text, i.e. on the second row.
    expect(orbAt).toBeGreaterThan(firstStep)
  })
})
