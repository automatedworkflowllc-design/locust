import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { PlanSteps } from './components/ThreadItems.js'
import type { PlanStep } from './missionView.js'

/**
 * The plan's running step carries an orb of its OWN, and that is the point.
 *
 * It used to mirror the live line's, on the reasoning that both say "this is
 * happening now". They do not say the same thing, and Colin saw it before I
 * did — 2026-09-20, with a photograph of the sparse `working` dots: *"i see
 * it plan consistently and i think it would look alot better as one of the
 * more spherical assets"*, then *"maybe this one? the one thats like a
 * spherical rubix cube"*.
 *
 * The live line names a REGISTER and sits beside a word it must not
 * contradict. The plan's step names a STEP, and the only claim being made
 * about it is that it is the one being worked through — which is true
 * whatever tool happens to be open. So the plan is told WHETHER a turn is
 * underway, never which orb to draw, and `PLAN_ORB` answers the rest.
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

const drawn = (underway: boolean): string =>
  renderToStaticMarkup(<PlanSteps steps={steps} doneCount={1} outcomes underway={underway} />)

describe('the plan marks the step underway', () => {
  it('draws the orb on the running step when a turn is still going', () => {
    expect(drawn(true)).toContain('lc-plan__orb')
  })

  it('replaces the pulsing pip rather than joining it', () => {
    // Two things pulsing on one row is the row saying "now" twice.
    expect(drawn(true)).not.toContain('is-pulsing')
  })

  it('keeps the pip when no turn is running', () => {
    /*
     * A finished plan gets no orb. A moving mark on a step of a run that has
     * ended would say work is underway when none is — the same defect as an
     * orb left spinning over a closed tool.
     */
    const html = drawn(false)
    expect(html).not.toContain('lc-plan__orb')
    expect(html).toContain('is-pulsing')
  })

  it('never marks a done step as underway', () => {
    const html = drawn(true)
    const orbAt = html.indexOf('lc-plan__orb')
    const firstStep = html.indexOf('Read the ledger')
    // The orb comes after the first (done) step's text, i.e. on the second row.
    expect(orbAt).toBeGreaterThan(firstStep)
  })

  it('is not told which orb to draw', () => {
    /*
     * The guard on the whole change. `underway` is a boolean on purpose: if
     * this ever becomes an `OrbState` again, the plan starts borrowing the
     * live line's register and the row goes back to saying two things.
     */
    const rendered = drawn(true)
    expect(rendered).toContain('lc-plan__orb')
    // Same markup whichever way the run is going — there is no other input.
    expect(rendered).toBe(drawn(true))
  })
})
