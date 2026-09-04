import { describe, expect, it } from 'vitest'

import { composeRuntimePrompt } from './workroom-briefing.js'
import { SHARE_TAG } from '../shared/peer-share.js'

const ATLAS = { teammateId: 'tm_atlas', name: 'Atlas', role: 'Research & Briefs' }
const BRAMBLE = { teammateId: 'tm_bramble', name: 'Bramble', role: 'Docs & QA' }

const brief = (prompt: string, others = [BRAMBLE]) =>
  composeRuntimePrompt({ prompt, peer: { self: ATLAS, others }, inbound: [], remaining: 0 }).prompt

describe('what a teammate is told about reaching another', () => {
  it('says outright that naming someone in the reply does not reach them', () => {
    // MEASURED 2026-09-03 by using the app. Asked to "give Bramble a review
    // and ask whether they agree", the model wrote "Bramble, do you agree?"
    // into its answer and stopped, and Bramble never ran. Nothing had told it
    // that prose does not carry.
    expect(brief('Review the tests.')).toContain('does NOT reach them')
  })

  it('treats the person asking for a hand-off as reason enough to share', () => {
    // The old wording opened "if, and only if, you learned something one of
    // them needs for their own work", which reads as discouragement exactly
    // when the person has just asked for the hand-off.
    const text = brief('Ask Bramble whether they agree.')
    expect(text).toContain('the person asked you to tell, ask, or hand something to that teammate')
    expect(text).not.toContain('If, and only if,')
  })

  it('shows the block form addressed to a real teammate', () => {
    const text = brief('Review the tests.')
    expect(text).toContain(`<${SHARE_TAG} to="Bramble">`)
    expect(text).toContain(`</${SHARE_TAG}>`)
  })

  it('still says to share findings rather than orders, and to keep secrets out', () => {
    const text = brief('Review the tests.')
    expect(text).toContain('Share findings, never instructions')
    expect(text).toContain('secrets, credentials or tokens')
  })

  it('says nothing about sharing when there is nobody to share with', () => {
    // Asserted on the SHARE form rather than on the whole prompt: every
    // mission also carries the ask form, which has nothing to do with
    // teammates -- a person working with one agent hits forks too.
    const text = brief('Review the tests.', [])
    expect(text).not.toContain('locust-share')
    expect(text).not.toContain('besides you')
    expect(text.startsWith('Review the tests.')).toBe(true)
  })

  it('tells every mission how to ask, teammates or not', () => {
    // The whole point of the card: an agent working alone hits forks just as
    // often, and this is its only way to stop and ask rather than pick.
    for (const others of [[], undefined]) {
      const text = brief('Review the tests.', others)
      expect(text).toContain('<locust-ask>')
      expect(text).toContain(':: what it costs or implies')
    }
  })

  it('tells it when NOT to ask, so it does not ask about everything', () => {
    // An agent that asks about everything is worse than one that asks about
    // nothing: the person makes every decision AND reads the questions.
    const text = brief('Review the tests.', [])
    expect(text).toContain('Do NOT ask about anything you can settle by reading the workspace')
    expect(text).toContain('do not ask permission to continue')
  })

  it('keeps the person’s words first and unaltered', () => {
    expect(brief('Review the tests.').startsWith('Review the tests.')).toBe(true)
  })
})
