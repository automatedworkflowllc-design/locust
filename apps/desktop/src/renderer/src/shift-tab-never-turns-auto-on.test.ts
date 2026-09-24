import { describe, expect, it } from 'vitest'

import { shiftTabMode } from './components/Composer.js'

/**
 * M33: Shift+Tab cycles the modes this route can run, and Auto is among them
 * only when the workspace's Auto switch is already on. Landing on it used to
 * turn that saved safety switch on, and it stayed on.
 */
const ALL = ['ask', 'accept-edits', 'plan', 'approve-each', 'auto'] as const

describe('Shift+Tab', () => {
  it('skips Auto while the Auto switch is off', () => {
    const seen: string[] = []
    let mode: (typeof ALL)[number] = 'ask'
    for (let i = 0; i < 8; i += 1) {
      mode = shiftTabMode(mode, ALL, false)!
      seen.push(mode)
    }
    expect(seen).not.toContain('auto')
  })

  it('includes it once the switch is on', () => {
    expect(shiftTabMode('approve-each', ALL, true)).toBe('auto')
  })

  it('moves off Auto to the first mode when Auto is no longer allowed', () => {
    expect(shiftTabMode('auto', ALL, false)).toBe('ask')
  })

  it('goes nowhere with fewer than two modes to cycle', () => {
    expect(shiftTabMode('ask', ['ask', 'auto'] as const, false)).toBeUndefined()
  })
})
