import { describe, expect, it } from 'vitest'

import { sweepText } from './components/ThreadItems.js'

/**
 * Three dots, capitalised, and nothing after them.
 *
 * The library's own page writes `Solving\u2026.` — an ellipsis followed by a
 * full stop, which draws FOUR dots. Colin: *"3 ...'s is standard with us
 * humans"*. He is right: four dots is not a punctuation mark anyone writes,
 * and a stop after an ellipsis reads as a typo rather than as a style.
 */
describe('the live word says three dots', () => {
  it('capitalises and ends in one ellipsis', () => {
    expect(sweepText('thinking')).toBe('Thinking\u2026')
    expect(sweepText('using a connector')).toBe('Using a connector\u2026')
  })

  it('never trails a full stop after the ellipsis', () => {
    for (const word of ['starting', 'working', 'writing', 'using a tool']) {
      expect(sweepText(word).endsWith('\u2026.')).toBe(false)
      expect(sweepText(word).endsWith('\u2026')).toBe(true)
    }
  })

  it('leaves the rest of the phrase alone', () => {
    // "Using a tool", not "Using A Tool": only the first letter is raised.
    expect(sweepText('using a tool')).toBe('Using a tool\u2026')
  })
})
