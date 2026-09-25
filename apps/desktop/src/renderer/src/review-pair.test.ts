import { describe, expect, it } from 'vitest'

import { reviewPairOf } from './review-pair.js'

const t = (name: string, runtime: string) => ({ teammateId: `tm_${name.toLowerCase()}`, name, runtime })

describe('two reviewers on different coding agents (A3.1)', () => {
  it('picks two agents that differ from each other and from the author', () => {
    const pair = reviewPairOf([t('Ash', 'codex'), t('Yurt', 'codex'), t('Booty', 'claude'), t('Vale', 'opencode')], 'codex')
    expect(pair?.map((one) => one.name)).toEqual(['Booty', 'Vale'])
  })

  it("uses the author's agent for one of them when the team has nothing else", () => {
    const pair = reviewPairOf([t('Ash', 'codex'), t('Booty', 'claude')], 'codex')
    expect(pair?.map((one) => one.name)).toEqual(['Ash', 'Booty'])
  })

  it('offers no pair when every reviewer is on the same agent', () => {
    expect(reviewPairOf([t('Ash', 'claude'), t('Booty', 'claude')], 'codex')).toBeUndefined()
    expect(reviewPairOf([t('Ash', 'claude')], 'codex')).toBeUndefined()
  })
})
