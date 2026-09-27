import { describe, expect, it } from 'vitest'

import CARD from './components/CancellationCard.tsx?raw'

/**
 * THE STOP CARD SAYS "TOOLS", NOT "WORK" (0.420).
 *
 * Fresh-eyes area 17: a stopped Claude Haiku had written the numbers 1 to 191
 * into the thread, and the card under them said "Stopped before it did any
 * work". Its condition is that no tool call settled, was cut off, or was
 * planned, so it names tool calls. drive-agent-everyday-jobs stops a run on
 * each agent and fails on the old sentence.
 */
describe('the card for a run stopped before any tool', () => {
  it('says no tools were used, not that no work was done', () => {
    expect(CARD).toContain('Stopped before it used any tools, so nothing is half-done.')
    // The old sentence, whole: the comment above the line quotes its words.
    expect(CARD).not.toContain('Stopped before it did any work, so there is nothing half-done.')
  })
})
