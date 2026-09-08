import { describe, expect, it } from 'vitest'

import { parseDecision } from './decision.js'

const ask = (body: string): string => `<locust-ask>\n${body}\n</locust-ask>`

/**
 * A numbered list of choices is a decision.
 *
 * The briefing writes its example with dashes and the parser accepted only
 * dashes and asterisks, so a model that answered "1. Rewrite it  2. Patch it"
 * produced a block with NO options: the card never appeared and the run just
 * ended, with the question stranded in prose. Reported by a Cursor teammate
 * reading this source from inside Locust (2026-09-08).
 */
describe('reading the options out of an ask', () => {
  it('reads the dashed form the briefing teaches', () => {
    const parsed = parseDecision(ask('Which way?\n- Rewrite it :: slower, cleaner\n- Patch it :: quicker, riskier'))
    expect(parsed?.options.map((option) => option.label)).toEqual(['Rewrite it', 'Patch it'])
  })

  it('reads a NUMBERED list, which used to produce no card at all', () => {
    for (const body of [
      'Which way?\n1. Rewrite it :: slower, cleaner\n2. Patch it :: quicker, riskier',
      'Which way?\n1) Rewrite it :: slower, cleaner\n2) Patch it :: quicker, riskier'
    ]) {
      const parsed = parseDecision(ask(body))
      expect(parsed?.options.map((option) => option.label), body).toEqual(['Rewrite it', 'Patch it'])
    }
  })

  it('still reads asterisks', () => {
    const parsed = parseDecision(ask('Which way?\n* Rewrite it\n* Patch it'))
    expect(parsed?.options).toHaveLength(2)
  })

  it('does not turn an ordinary numbered sentence into an option', () => {
    // The control. Prose that merely contains a number must not become a
    // button, or every answer with a count in it grows a card.
    expect(parseDecision(ask('I found 2 files.\nThere were 3 problems.'))).toBeUndefined()
  })
})
