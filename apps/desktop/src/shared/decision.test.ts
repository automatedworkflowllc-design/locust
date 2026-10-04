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

describe('an option named after the template, not after itself', () => {
  // Colin's screenshot, 2026-09-25: a free Mimo run on 0.345 copied the
  // brief's example words, and the card showed two buttons titled "The
  // first option" and "The second option".
  it('is named by what it says instead', () => {
    const asked = parseDecision([
      '<locust-ask>',
      'How do you want the file creation handled, given write tools are disabled in this mode?',
      '- The first option :: Re-run with write/shell enabled, and I create forbidden-ask.txt',
      '- The second option :: Leave it undone; I only report the README values',
      '</locust-ask>'
    ].join('\n'))
    expect(asked?.options).toEqual([
      { label: 'Re-run with write/shell enabled, and I create forbidden-ask.txt', note: undefined },
      { label: 'Leave it undone; I only report the README values', note: undefined }
    ])
  })

  it('keeps a real name that happens to mention an option', () => {
    const asked = parseDecision('<locust-ask>\nWhich?\n- Keep the old option :: safer\n- Drop it :: simpler\n</locust-ask>')
    expect(asked?.options.map((one) => one.label)).toEqual(['Keep the old option', 'Drop it'])
  })
})
