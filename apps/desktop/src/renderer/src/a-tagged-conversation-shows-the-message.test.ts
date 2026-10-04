import { describe, expect, it } from 'vitest'

import { taggedPrompt } from '../../shared/tagging.js'
import { shownPrompt, turnPromptLine } from './missionView.js'

/**
 * A teammate tagged from another conversation (0.438) is sent the message and,
 * after it, where it came from and the latest answer there. The ledger records
 * the run as an ordinary one, so after a restart the title and the bubble
 * would have carried that context as though the person had typed it.
 */
describe("a tagged teammate's conversation", () => {
  const prompt = taggedPrompt({ message: 'Can you double-check the tax rate?', fromName: 'Wren', answer: 'I changed TAX_RATE.' })

  it('is titled by the message', () => {
    expect(shownPrompt({ prompt })).toBe('Can you double-check the tax rate?')
  })

  it('draws the message as the bubble, without the context after it', () => {
    expect(turnPromptLine({ prompt })).toBe('Can you double-check the tax rate?')
    expect(turnPromptLine({ prompt: 'Can you double-check the tax rate?', startedBy: { kind: 'tag' } })).toBe('Can you double-check the tax rate?')
  })
})
