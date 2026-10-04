import { describe, expect, it } from 'vitest'

import { glassStatus } from './homeCoverStatus.js'

describe('what the cover\'s glass says while work runs (0.610)', () => {
  it('names who is working and who waits on you, waiting first', () => {
    expect(glassStatus(['Codex'], ['Casper'])).toBe('Casper waiting on you · Codex working')
    expect(glassStatus(['Codex'], [])).toBe('Codex working')
    expect(glassStatus(['Codex', 'Robin'], [])).toBe('Codex working · Robin working')
  })

  it('counts past two, so it fits the glass', () => {
    expect(glassStatus(['Codex', 'Robin', 'Bro'], ['Casper'])).toBe('1 waiting on you · 3 working')
  })

  it('says nothing when nothing runs or waits: the glass keeps its claim', () => {
    expect(glassStatus([], [])).toBeUndefined()
  })
})
