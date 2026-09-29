import { describe, expect, it } from 'vitest'

import { parseDecision, stripDecisionBlocks } from './decision.js'

/**
 * A QUESTION THAT IS NOT A CARD STAYS IN THE REPLY (QA-2026-09-29 round 2, R4, R5).
 *
 * Every ask block was taken out of the reply, including the ones no card was
 * made from, so the person read "I need a decision." and nothing under it.
 */
const ask = (body: string): string => `<locust-ask>\n${body}\n</locust-ask>`

describe('an ask block', () => {
  it('that became the card is taken out of the reply', () => {
    const reply = `I need a decision.\n\n${ask('Which database?\n- Postgres :: what the team knows\n- SQLite :: nothing to run')}`
    expect(parseDecision(reply)?.options).toHaveLength(2)
    expect(stripDecisionBlocks(reply)).toBe('I need a decision.')
  })

  it.each([
    ['one option', 'Ship it now?\n- Ship :: today'],
    ['five options', 'Which colour?\n- Red\n- Blue\n- Green\n- Gold\n- Grey'],
    ['Yes and No', 'Delete the old branch?\n- Yes :: it is merged\n- No :: keep it'],
    ['the same option twice', 'Which one?\n- Postgres\n- postgres']
  ])('that the card rules refused (%s) stays, as plain words', (_shape, body) => {
    const reply = `I need a decision.\n\n${ask(body)}`
    expect(parseDecision(reply)).toBeUndefined()
    const shown = stripDecisionBlocks(reply)
    expect(shown).toContain(body.split('\n')[0])
    expect(shown).not.toContain('locust-ask')
    expect(shown).not.toContain('::')
    expect(shown.split('\n').filter((line) => line.startsWith('- '))).toHaveLength(body.split('\n').length - 1)
  })

  it('after the first stays too: only the first is the card', () => {
    const reply = [
      'Two things.',
      ask('Which database?\n- Postgres\n- SQLite'),
      ask('Which host?\n- Fly :: cheaper\n- Render :: simpler')
    ].join('\n\n')
    expect(parseDecision(reply)?.question).toBe('Which database?')
    expect(stripDecisionBlocks(reply)).toBe('Two things.\n\nWhich host?\n- Fly — cheaper\n- Render — simpler')
  })

  it('shown as an example in code is left as written', () => {
    const reply = `Write it like this:\n\n\`\`\`\n${ask('Which?\n- A\n- B')}\n\`\`\``
    expect(stripDecisionBlocks(reply)).toBe(reply)
  })
})
