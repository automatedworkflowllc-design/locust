import { describe, expect, it } from 'vitest'

import { forgetMatch, memoryKey } from '../shared/memory.js'

/**
 * A `forget` resolves to exactly one memory, or it refuses and says why.
 *
 * The defect this replaces: the quote had to match a stored memory's whole
 * text, normalised, and a word out of place removed NOTHING -- silently. The
 * caller only reported successes, so the teammate believed it had corrected a
 * wrong memory, the wrong memory was still stored, and it was briefed to
 * every mission afterwards. Then the corrected memory landed beside it and
 * both were briefed. The store could not tell a correction from an addition.
 *
 * The rule is `OpenViking`'s and the reasons are theirs too: an anchor must
 * resolve to exactly one target, none and several are both refusals rather
 * than guesses, and similarity is not identity.
 */

const stored = (...texts: readonly string[]): readonly string[] => texts.map(memoryKey)

describe('what a forget points at', () => {
  it('hits the memory it quotes exactly', () => {
    const match = forgetMatch('The API is on port 3000', stored('The API is on port 3000', 'Tests run with pnpm'))
    expect(match.matched).toEqual([memoryKey('The API is on port 3000')])
    expect(match.refusal).toBeUndefined()
  })

  it('still hits it when the quote is punctuated or cased differently', () => {
    const match = forgetMatch('the api is on PORT 3000.', stored('The API is on port 3000'))
    expect(match.refusal).toBeUndefined()
    expect(match.matched).toHaveLength(1)
  })

  it('hits it when the teammate drops a trailing clause -- the case that used to fail', () => {
    // What a teammate actually does: quotes the part it remembers.
    const match = forgetMatch(
      'The API is on port 3000',
      stored('The API is on port 3000 in development, and 443 in production')
    )
    expect(match.refusal).toBeUndefined()
    expect(match.matched).toHaveLength(1)
  })

  it('hits it when the teammate quotes MORE than was stored', () => {
    const match = forgetMatch('I think the API is on port 3000 here', stored('API is on port 3000'))
    expect(match.refusal).toBeUndefined()
    expect(match.matched).toHaveLength(1)
  })

  it('refuses, rather than guessing, when nothing answers to the quote', () => {
    const match = forgetMatch('The database runs on Postgres', stored('The API is on port 3000'))
    expect(match.matched).toEqual([])
    expect(match.refusal).toBe('nothing-matched')
  })

  it('refuses when several memories answer to it, and removes neither', () => {
    // Two real memories that a loose quote covers. Guessing here deletes
    // something the person never agreed to lose.
    const match = forgetMatch(
      'port 3000',
      stored('port 3000 is the API', 'port 3000 is also the docs server')
    )
    expect(match.matched).toEqual([])
    expect(match.refusal).toBe('ambiguous')
  })

  it('prefers an exact match even when others contain the same words', () => {
    const match = forgetMatch(
      'The API is on port 3000',
      stored('The API is on port 3000', 'The API is on port 3000 except on Tuesdays')
    )
    expect(match.matched).toEqual([memoryKey('The API is on port 3000')])
    expect(match.refusal).toBeUndefined()
  })

  it('does not treat two memories as one because they share a topic', () => {
    // Similarity is NOT identity. These are both about the API and neither
    // contains the other, so the quote identifies nothing.
    const match = forgetMatch('The API needs a token', stored('The API is on port 3000'))
    expect(match.refusal).toBe('nothing-matched')
  })

  it('refuses an empty or wordless quote instead of matching everything', () => {
    expect(forgetMatch('', stored('The API is on port 3000')).refusal).toBe('nothing-matched')
    expect(forgetMatch('...', stored('The API is on port 3000')).refusal).toBe('nothing-matched')
    // Short filler words carry no identity and must not select a memory.
    expect(forgetMatch('is on a', stored('The API is on port 3000')).refusal).toBe('nothing-matched')
  })

  it('says nothing matched when the store is empty', () => {
    expect(forgetMatch('anything at all', []).refusal).toBe('nothing-matched')
  })
})
