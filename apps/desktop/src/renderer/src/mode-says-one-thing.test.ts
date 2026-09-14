import { describe, expect, it } from 'vitest'

import type { MissionMode } from '../../shared/ipc.js'
import { MODE_FACTS, modeLabel, modeSentence, modeSummary } from './status.js'

/**
 * A mode means one thing, and it is written down once.
 *
 * There were FOUR tables of these — the composer's picker rows, `modeLabel`,
 * `modeSentence`, `modeSummary` — in four files, with nothing making them
 * agree, and by the time they were counted they already did not: the same
 * mode was `Ask` in one and `ask` in another, and only two of the four said
 * Ask is read-only, which is the single most load-bearing fact about it
 * (Grok's audit, 2026-09-13).
 *
 * The registers are allowed to differ. The facts are not.
 */

const EVERY_MODE: readonly MissionMode[] = ['ask', 'accept-edits', 'approve-each', 'plan', 'auto']

describe('one table of modes', () => {
  it('covers the whole union exactly once', () => {
    expect([...MODE_FACTS].map((facts) => facts.mode).sort()).toEqual([...EVERY_MODE].sort())
  })

  it('names each mode the same way everywhere it is named', () => {
    for (const facts of MODE_FACTS) {
      expect(modeSummary(facts.mode).startsWith(`${facts.name} `)).toBe(true)
      expect(modeLabel(facts.mode).startsWith(facts.name.toLowerCase())).toBe(true)
    }
  })

  it('says read-only for every mode that is read-only, on every surface', () => {
    // The two that change nothing. A surface that omits this is the defect.
    for (const mode of ['ask', 'plan'] as const) {
      expect(MODE_FACTS.find((facts) => facts.mode === mode)?.scope).toBe('read-only')
      expect(modeLabel(mode)).toContain('read-only')
      expect(`${modeSummary(mode)} ${modeSentence(mode)}`).toMatch(/refused|changes nothing/)
    }
  })

  it('says of Auto, on every surface, that it reaches past this folder', () => {
    expect(modeLabel('auto')).toContain('whole machine')
    expect(modeSummary('auto')).toContain('anything on this machine')
    expect(modeSentence('auto')).toContain('anywhere on this machine')
  })
})
