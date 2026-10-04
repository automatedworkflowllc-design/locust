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

/*
 * The scale has to BE a scale.
 *
 * "Order is the runtime's own, first appearance wins" rested on the catalogue
 * listing levels lowest to highest. Cursor does not: `cursor-agent --help`
 * lists `cursor-grok-4.6-high-fast` before `cursor-grok-4.6-low`, so the
 * scale came out `[high, low, medium, xhigh]` and a teammate on `high` drew
 * its knob hard left against "Faster" while the word above it said `high`
 * (Colin, 2026-09-11, screenshot). MEASURED on the same build: a route on
 * `medium` put the knob at 67%, index 2 of that same wrong order.
 */
describe('a scale where right is more', () => {
  // The real list, in the real order, from `cursor-agent --help`.
  const CURSOR = [
    'cursor-grok-4.6-high-fast',
    'cursor-grok-4.6-low',
    'cursor-grok-4.6-low-fast',
    'cursor-grok-4.6-medium',
    'cursor-grok-4.6-medium-fast',
    'cursor-grok-4.6-high',
    'cursor-grok-4.6-xhigh',
    'cursor-grok-4.6-xhigh-fast'
  ].map((id) => id.replace('cursor-grok-4.6-', ''))

  it('sorts a list the runtime did not sort', () => {
    expect(effortScale(CURSOR).bases).toEqual(['low', 'medium', 'high', 'xhigh'])
  })

  it('puts high above medium, which is the whole bug', () => {
    const { bases } = effortScale(CURSOR)
    expect(bases.indexOf('high')).toBeGreaterThan(bases.indexOf('medium'))
    // And not at the far left, where it drew itself.
    expect(bases.indexOf('high')).not.toBe(0)
  })

  it('leaves an already-sorted list alone', () => {
    expect(effortScale(['low', 'medium', 'high']).bases).toEqual(['low', 'medium', 'high'])
    expect(effortScale(['none', 'low', 'medium', 'high', 'xhigh', 'max']).bases).toEqual([
      'none',
      'low',
      'medium',
      'high',
      'xhigh',
      'max'
    ])
  })

  it('keeps a word it has never seen after the ones it knows, in the runtime order', () => {
    // An unfamiliar level must not land between `low` and `medium` and claim
    // a meaning nothing gave it.
    const { bases } = effortScale(['ludicrous', 'high', 'low', 'brisk'])
    expect(bases).toEqual(['low', 'high', 'ludicrous', 'brisk'])
  })

  it('still finds the fast variants wherever they were listed', () => {
    expect(effortScale(CURSOR).hasFast).toBe(true)
    expect(effortScale(['low', 'medium']).hasFast).toBe(false)
  })

  it('a level the scale holds can always be found on it', () => {
    // The failure was `indexOf` returning -1 and `Math.max(0, ...)` turning
    // "not on this scale" into "the lowest one", silently.
    const { bases } = effortScale(CURSOR)
    for (const base of ['low', 'medium', 'high', 'xhigh']) {
      expect(bases.indexOf(base), base).toBeGreaterThanOrEqual(0)
    }
  })
})
