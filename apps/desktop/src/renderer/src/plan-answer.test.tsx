import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { PlanSteps } from './components/ThreadItems.js'
import type { PlanStep } from './missionView.js'

/**
 * A plan that has no fold is the teammate's ANSWER, not a card.
 *
 * `PlanCard` drew it as an `lc-card` — the register this app reserves for
 * something holding a control — with a `PLAN` label, a `0 of 5 done` counter
 * and five identical dots. All three reported on a run that, in Plan mode,
 * by contract never happened, and together they read as a run stalled at step
 * one rather than as an answer to the question.
 *
 * The design's resolution (2026-09-09) was a deletion rather than a fourth
 * register: the answer to a turn already has a register, the one the
 * teammate's prose lives in. So the census goes from fourteen species to
 * thirteen, and the three-register test keeps passing untouched because
 * nothing new was added to test.
 *
 * One component, one question behind it: does this plan have step outcomes.
 */

const steps = (count: number, state: PlanStep['state'] = 'pending'): readonly PlanStep[] =>
  Array.from({ length: count }, (_, index) => ({ text: `step ${String(index + 1)}`, state }) as PlanStep)

const answer = (plan: readonly PlanStep[]): string =>
  renderToStaticMarkup(<PlanSteps steps={plan} doneCount={0} outcomes={false} />)

const record = (plan: readonly PlanStep[], doneCount: number): string =>
  renderToStaticMarkup(<PlanSteps steps={plan} doneCount={doneCount} outcomes />)

describe('a plan with no run behind it', () => {
  it('is an ordered list, not a card', () => {
    const html = answer(steps(5))
    expect(html).toContain('<ol')
    // A real `ol`, so it is an ordered list to a screen reader as well.
    expect(html).not.toContain('lc-card')
    expect(html).not.toContain('<ul')
  })

  it('numbers the steps instead of giving them states', () => {
    /*
     * THE change. A dot means "not done yet", which is a state; in Plan mode
     * nothing was attempted and nothing will be, so five dots say something
     * false five times. Ordinals say order, which is the whole content of a
     * plan.
     */
    const html = answer(steps(5))
    expect(html).toContain('lc-plan__ordinal')
    expect(html).not.toContain('lc-dot')
    expect(html).not.toContain('lc-plan__marker')
  })

  it('has no header at all — not the label, not the counter', () => {
    const html = answer(steps(5))
    expect(html).not.toContain('PLAN')
    expect(html).not.toMatch(/0 of 5 done/)
  })

  it('widens the gutter past nine steps so the text column stays flush', () => {
    expect(answer(steps(9))).not.toContain('is-wide')
    expect(answer(steps(10))).toContain('is-wide')
  })

  it('renders nothing at all when the turn produced no steps', () => {
    // Not an empty list with a header: a Plan-mode turn with no steps is the
    // silent-turn case, which already has its own diagnostic. An empty `ol`
    // would be this component inventing a plan nobody made.
    expect(answer([])).toBe('')
  })
})

describe('the same component inside an activity fold', () => {
  it('keeps its markers, its counter and its label', () => {
    /*
     * The control, and the reason this is one component rather than two.
     * Inside a fold a run DID happen, the steps have outcomes, and the counter
     * is a fact about them. If the change above had leaked into this branch it
     * would have deleted real information.
     */
    const html = record([{ text: 'a', state: 'done' } as PlanStep, ...steps(4)], 1)
    expect(html).toContain('PLAN')
    expect(html).toContain('1 of 5 done')
    expect(html).toContain('lc-plan__marker')
    expect(html).toContain('<ul')
    expect(html).not.toContain('lc-plan__ordinal')
  })

  it('also renders nothing when there are no steps', () => {
    expect(record([], 0)).toBe('')
  })
})

/*
 * The census claim is checked on the MAIN side, in
 * `src/main/plan-is-not-a-card.test.ts`, because reading source needs node
 * types and this file is compiled under `tsconfig.web.json` which has none.
 * Every test here would pass while the web typecheck failed -- the same
 * boundary I crossed a day ago and wrote down, then crossed again.
 */
