import { describe, expect, it } from 'vitest'

import { STEP_BUDGET, stepTooLongNotice } from './step-budget.js'

describe('warning about a routine step that cannot be sent', () => {
  it('says nothing about a step that fits', () => {
    expect(stepTooLongNotice('Summarise yesterday.')).toBeUndefined()
    expect(stepTooLongNotice('x'.repeat(STEP_BUDGET))).toBeUndefined()
  })

  it('speaks the moment the budget is passed', () => {
    expect(stepTooLongNotice('x'.repeat(STEP_BUDGET + 1))).toBeDefined()
  })

  it('says how much to cut, not merely that it is too long', () => {
    // "Too long" invites deleting until it stops complaining. A number is
    // something a person can act on in one go.
    const notice = stepTooLongNotice('x'.repeat(STEP_BUDGET + 1_400))
    expect(notice).toContain('1400')
    expect(notice).toContain('too long')
  })

  it('gets the singular right at exactly one over', () => {
    expect(stepTooLongNotice('x'.repeat(STEP_BUDGET + 1))).toContain('1 character too long')
  })

  it('leaves room inside the prompt cap for everything else in the message', () => {
    // THE reason this file exists. The store accepts 20,000 and the runtime
    // prompt cap is 12,000 for the step AND the briefing AND waiting peer
    // messages AND the roster trailer -- so a step measured against 12,000
    // would still be a step that cannot be sent.
    expect(STEP_BUDGET).toBeLessThan(12_000)
    expect(STEP_BUDGET).toBeLessThan(20_000)
  })
})
