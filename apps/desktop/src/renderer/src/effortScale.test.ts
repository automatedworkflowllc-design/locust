import { describe, expect, it } from 'vitest'

import { effortScale, joinEffort, splitEffort } from './effortScale.js'

const CURSOR = ['low', 'low-fast', 'medium', 'medium-fast', 'high', 'high-fast', 'xhigh', 'xhigh-fast']
const CLAUDE = ['low', 'medium', 'high', 'xhigh', 'max']

describe('reading a runtime list of efforts as a scale', () => {
  it('turns Cursor eight levels into four and a switch', () => {
    // The whole point: eight rows in a menu, four stops on a slider.
    expect(effortScale(CURSOR)).toEqual({ bases: ['low', 'medium', 'high', 'xhigh'], hasFast: true })
  })

  it('draws no switch for a runtime with no fast variants', () => {
    expect(effortScale(CLAUDE)).toEqual({ bases: CLAUDE, hasFast: false })
  })

  it('keeps the runtime own order, because right means more', () => {
    // A hard-coded ordering would put a level this build has never seen in the
    // wrong place, and the slider means nothing if right is not more.
    expect(effortScale(['tiny', 'enormous']).bases).toEqual(['tiny', 'enormous'])
  })

  it('is not fooled by a level that merely ends in the word fast', () => {
    expect(splitEffort('fast')).toEqual({ base: 'fast', fast: false })
    expect(splitEffort('-fast')).toEqual({ base: '-fast', fast: false })
    expect(splitEffort('high-fast')).toEqual({ base: 'high', fast: true })
  })
})

describe('turning the slider and the switch back into a real level', () => {
  it('gives the fast variant when one exists', () => {
    expect(joinEffort('high', true, CURSOR)).toBe('high-fast')
    expect(joinEffort('high', false, CURSOR)).toBe('high')
  })

  it('NEVER invents a level the runtime did not list', () => {
    // THE test. A control that produced `medium-fast` for a runtime that never
    // offered it would fail the run at the far end -- which is the exact class
    // of bug the Cursor effort work has been about all week.
    expect(joinEffort('medium', true, CLAUDE)).toBe('medium')
    expect(joinEffort('nonsense', true, CLAUDE)).toBeUndefined()
    expect(joinEffort('nonsense', false, CLAUDE)).toBeUndefined()
  })

  it('round-trips every level a runtime actually offers', () => {
    for (const list of [CURSOR, CLAUDE]) {
      for (const level of list) {
        const { base, fast } = splitEffort(level)
        expect(joinEffort(base, fast, list), level).toBe(level)
      }
    }
  })
})
