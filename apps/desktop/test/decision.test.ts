import { describe, expect, it } from 'vitest'

import {
  decisionReply,
  MAX_OPTION_LABEL_LENGTH,
  MAX_QUESTION_LENGTH,
  parseDecision,
  stripDecisionBlocks
} from '../src/shared/decision.js'

const block = (body: string): string => `Here is what I found.\n\n<locust-ask>\n${body}\n</locust-ask>`

const WELL_FORMED = block(
  [
    'The v2 handler has two callers outside billing. Keep them on v2 behind',
    'the flag, or migrate them in this mission?',
    '- Keep them on v2 :: Smaller change, flag stays until you flip it',
    '- Migrate all callers now :: Touches 4 more files, adds ~10 min'
  ].join('\n')
)

describe('a runtime asking which way to go', () => {
  it('reads the question and both options', () => {
    const asked = parseDecision(WELL_FORMED)
    expect(asked?.question).toBe(
      'The v2 handler has two callers outside billing. Keep them on v2 behind the flag, or migrate them in this mission?'
    )
    expect(asked?.options).toEqual([
      { label: 'Keep them on v2', note: 'Smaller change, flag stays until you flip it' },
      { label: 'Migrate all callers now', note: 'Touches 4 more files, adds ~10 min' }
    ])
  })

  it('accepts an option that states no cost', () => {
    const asked = parseDecision(block('Which one?\n- Do it now\n- Wait for review'))
    expect(asked?.options.map((option) => option.note)).toEqual([undefined, undefined])
  })

  it('takes an asterisk bullet as readily as a dash', () => {
    // Models write lists both ways and the block is meant to be easy to emit.
    expect(parseDecision(block('Which one?\n* First\n* Second'))?.options).toHaveLength(2)
  })

  it('refuses a single option, which is an announcement rather than a decision', () => {
    // The card would offer a button whose only effect is to agree -- that is
    // the approval card, and this is deliberately not it.
    expect(parseDecision(block('Shall I proceed?\n- Yes go ahead'))).toBeUndefined()
  })

  it('refuses more options than a person will read', () => {
    const many = ['Which?', '- One', '- Two', '- Three', '- Four', '- Five'].join('\n')
    expect(parseDecision(block(many))).toBeUndefined()
  })

  it('refuses two options that say the same thing', () => {
    // One option written twice is not a choice.
    expect(parseDecision(block('Which?\n- Keep it\n- keep it'))).toBeUndefined()
  })

  it('refuses a block with options but no question', () => {
    expect(parseDecision(block('- One\n- Two'))).toBeUndefined()
  })

  it('refuses a block with a question but no options', () => {
    expect(parseDecision(block('What should I do here?'))).toBeUndefined()
  })

  it('ignores prose that arrives after the options', () => {
    // A model still talking below the list is not part of the question.
    const asked = parseDecision(block('Which one?\n- One\n- Two\nI can start whenever you say.'))
    expect(asked?.question).toBe('Which one?')
  })

  it('takes only the first well-formed question', () => {
    // Two forks in one run is two unresolved decisions; answering the second
    // would be answering out of order.
    const two = `${WELL_FORMED}\n${block('And after that?\n- Ship it\n- Hold it')}`
    expect(parseDecision(two)?.question).toContain('v2 handler')
  })

  it('skips a malformed block to find a good one after it', () => {
    const text = `${block('Broken, only one\n- Only')}\n${WELL_FORMED}`
    expect(parseDecision(text)?.question).toContain('v2 handler')
  })

  it('finds nothing in an ordinary reply', () => {
    expect(parseDecision('I changed two files and the tests pass.')).toBeUndefined()
  })

  it('strips a control byte rather than refusing the whole question', () => {
    const nasty = block(`What now?${String.fromCharCode(7)}\n- One\n- Two`)
    expect(parseDecision(nasty)?.question).toBe('What now?')
  })

  it('cuts an overlong question rather than showing a memo', () => {
    const long = parseDecision(block(`${'word '.repeat(400)}?\n- One\n- Two`))
    expect(long?.question.length).toBe(MAX_QUESTION_LENGTH)
    expect(long?.question.endsWith('…')).toBe(true)
  })

  it('cuts an overlong option label', () => {
    const long = parseDecision(block(`Which?\n- ${'x'.repeat(300)}\n- Two`))
    expect(long?.options[0]?.label.length).toBe(MAX_OPTION_LABEL_LENGTH)
  })
})

describe('the question in the reply bubble', () => {
  it('is taken out, because the card asks it answerably', () => {
    const stripped = stripDecisionBlocks(WELL_FORMED)
    expect(stripped).toBe('Here is what I found.')
    expect(stripped).not.toContain('locust-ask')
  })

  it('leaves an ordinary reply exactly as it was', () => {
    expect(stripDecisionBlocks('No question here.')).toBe('No question here.')
  })

  it('takes out a malformed block too, so no raw tag ever reaches the reader', () => {
    // It produced no card, so the words are lost either way -- but a stray
    // `<locust-ask>` in a bubble reads as the product leaking its own wiring.
    const broken = block('Only one\n- Only')
    expect(parseDecision(broken)).toBeUndefined()
    expect(stripDecisionBlocks(broken)).not.toContain('locust-ask')
  })
})

describe('what the next turn is sent when a person picks', () => {
  it('reads as the answer the person gave', () => {
    expect(decisionReply({ label: 'Keep them on v2', note: 'Smaller change' }))
      .toBe('Keep them on v2 (Smaller change). Continue with that.')
  })

  it('says the label alone when the option stated no cost', () => {
    expect(decisionReply({ label: 'Wait for review', note: undefined }))
      .toBe('Wait for review. Continue with that.')
  })
})
