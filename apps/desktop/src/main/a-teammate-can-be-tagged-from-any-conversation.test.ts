import { describe, expect, it } from 'vitest'

import { MAX_TAGGED, taggedPrompt, taggedWordsOf } from '../shared/tagging.js'

/**
 * TAG A TEAMMATE FROM ANY CONVERSATION (0.438).
 *
 * Colin, 2026-09-28: "can we tag teammates from any conversation? i saw you
 * added that in rooms but it should be doable from anywhere honestly."
 */
describe('what a tagged teammate is sent', () => {
  it('is the message first -- so their conversation is titled by it -- then where it came from and the latest answer there', () => {
    const prompt = taggedPrompt({ message: 'Can you double-check the tax rate?', fromName: 'Wren', answer: 'I changed TAX_RATE to 0.07 in prices.py.' })
    expect(prompt.startsWith('Can you double-check the tax rate?\n\n')).toBe(true)
    expect(prompt).toContain("(You were tagged in Wren's conversation. Wren's latest answer there, for context:)")
    expect(prompt.endsWith('I changed TAX_RATE to 0.07 in prices.py.')).toBe(true)
  })

  it('says only where it came from when that conversation has no answer yet', () => {
    expect(taggedPrompt({ message: 'Take a look.', fromName: 'Wren' })).toBe("Take a look.\n\n(You were tagged in Wren's conversation.)")
  })

  it('is the message alone when it was sent from nobody\'s conversation', () => {
    expect(taggedPrompt({ message: 'Take a look.' })).toBe('Take a look.')
  })

  it('fits the mission limit, cutting the answer rather than the message', () => {
    const prompt = taggedPrompt({ message: 'Check this.', fromName: 'Wren', answer: 'x'.repeat(20_000) })
    expect(prompt.length).toBeLessThanOrEqual(8_000)
    expect(prompt.startsWith('Check this.')).toBe(true)
    expect(prompt).toContain('(cut short here)')
  })

  it('reaches at most a handful of teammates at once', () => {
    expect(MAX_TAGGED).toBe(5)
  })
})

describe('what the tagged conversation shows', () => {
  const prompt = taggedPrompt({ message: 'Can you double-check the tax rate?', fromName: 'Wren', answer: 'I changed TAX_RATE.' })

  // The bubble and the title use it: a-tagged-conversation-shows-the-message.test.ts.
  it('is the message, after a restart too, when the ledger has recorded the run as an ordinary one', () => {
    expect(taggedWordsOf(prompt)).toBe('Can you double-check the tax rate?')
  })

  it('leaves a message nobody was tagged in alone', () => {
    expect(taggedWordsOf('Just a message.\n\n(an aside)')).toBe('Just a message.\n\n(an aside)')
  })
})
