import { describe, expect, it } from 'vitest'
import { MAX_WORKROOM_MESSAGE_LENGTH } from '@teammate/mission-store'

import { boundedShareText, MAX_SHARE_TEXT_LENGTH } from '../shared/peer-share.js'
import { MAX_RUNTIME_PROMPT_LENGTH } from './workroom-briefing.js'

/**
 * A BRIEF BETWEEN TEAMMATES ARRIVES WHOLE (0.486). Colin, 2026-09-30: Boss's
 * brief to Ghost was cut at "prepare an optimi…", and Ghost answered that its
 * message had been cut. The cap was 1,200 characters -- two paragraphs -- for
 * a brief the briefing asks to be written for a senior colleague.
 */
describe('a message from one teammate to another', () => {
  it('of a real brief\'s length is delivered as written', () => {
    const brief = `${'Inspect electron-builder.yml and discovery.ts, then prepare an optimization plan. '.repeat(40)}`.trim()
    expect(brief.length).toBeGreaterThan(3_000)
    expect(boundedShareText(brief)).toBe(brief)
  })

  it('is cut only past 6,000 characters, and says so with a mark', () => {
    const long = 'a'.repeat(MAX_SHARE_TEXT_LENGTH + 50)
    const cut = boundedShareText(long)
    expect(cut.length).toBe(MAX_SHARE_TEXT_LENGTH)
    expect(cut.endsWith('…')).toBe(true)
  })

  it('fits what the store keeps and what a teammate is sent', () => {
    expect(MAX_WORKROOM_MESSAGE_LENGTH).toBe(MAX_SHARE_TEXT_LENGTH)
    // With room beside it for the briefing: a message never has to wait for
    // a turn with less of the person's own text in it just to fit.
    expect(MAX_SHARE_TEXT_LENGTH).toBeLessThanOrEqual(MAX_RUNTIME_PROMPT_LENGTH / 2)
  })
})
