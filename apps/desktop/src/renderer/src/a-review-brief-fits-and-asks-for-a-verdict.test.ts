import { describe, expect, it } from 'vitest'

import { STEP_BUDGET } from '../../shared/step-budget.js'
import { reviewBrief, trimmedFromTheMiddle } from './reviewBrief.js'
import type { ReviewMaterial } from './reviewBrief.js'

/**
 * A3.2 AND A5.2: THE REVIEW BRIEF.
 *
 * - It fits where it is sent. It is the reviewer's mission prompt, at most
 *   8,000 characters, and a long turn's reply alone was allowed 8,000 -- so
 *   reviewing a long turn was refused before it started.
 * - The reviewer's contract (impeccable): it edits nothing, the author's
 *   account is not evidence, and the answer opens with a verdict.
 */
const LONG: ReviewMaterial = {
  request: 'r'.repeat(5_000),
  openedWith: 'o'.repeat(5_000),
  said: `First, what I did. ${'s'.repeat(30_000)} Finally: the fix is in src/net.ts and the tests pass.`,
  changed: Array.from({ length: 40 }, (_, index) => `src/file-${String(index)}.ts`),
  commands: Array.from({ length: 30 }, (_, index) => ({ name: `pnpm test ${String(index)}`, exitCode: 0 })),
  changedEarlier: Array.from({ length: 40 }, (_, index) => `docs/page-${String(index)}.md`),
  ranOn: 'Claude Code · Haiku · Accept edits · in the folder',
  author: 'Wren'
}

describe('the review brief', () => {
  it('fits in a mission prompt however long the turn was', () => {
    const brief = reviewBrief(LONG)
    expect(brief.length).toBeLessThanOrEqual(STEP_BUDGET)
    // And it is the reply that gave way, from its middle: both ends stay.
    expect(brief).toContain('First, what I did.')
    expect(brief).toContain('Finally: the fix is in src/net.ts and the tests pass.')
    expect(brief).toContain('characters from the middle of the reply left out')
  })

  it('leaves a reply that fits exactly as it was', () => {
    const brief = reviewBrief({ ...LONG, request: 'Fix the null check.', openedWith: undefined, said: 'Fixed it in src/net.ts.', changed: ['src/net.ts'], commands: [], changedEarlier: [] })
    expect(brief).toContain('WHAT THEY SAID\nFixed it in src/net.ts.\n')
    expect(brief).not.toContain('left out')
  })

  it('cuts from the middle, and counts what it cut', () => {
    const cut = trimmedFromTheMiddle(`HEAD ${'x'.repeat(5_000)} TAIL`, 1_000)
    expect(cut.length).toBeLessThanOrEqual(1_000)
    expect(cut.startsWith('HEAD')).toBe(true)
    expect(cut.endsWith('TAIL')).toBe(true)
    const said = Number(/\[\.\.\. ([\d,]+) characters/.exec(cut)?.[1]?.replace(/,/g, ''))
    expect(said).toBeGreaterThan(4_000)
  })

  it('asks for a verdict first, and for no edits, and does not take the author at their word', () => {
    const brief = reviewBrief(LONG)
    expect(brief).toContain('Start your answer with a one-line verdict -- Ready, Needs changes, or Start over -- then the reasons.')
    expect(brief).toContain('edit no file')
    expect(brief).toContain('What they said about their own work is their account, not evidence')
  })
})
