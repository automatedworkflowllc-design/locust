import { describe, expect, it } from 'vitest'

import { glancesAmong } from './glances.js'
import type { Handoff } from './glances.js'

/**
 * TWO TEAMMATES LOOK AT EACH OTHER WHEN ONE HANDS THE OTHER A MESSAGE.
 *
 * Colin's "have fun" list, 2026-09-23 -- "their two bots glance at each other
 * for a moment" -- and his answer: "you can run all those". Before, only the
 * one who got the message moved, looking around at nothing, and nothing on
 * screen said who it was from.
 */
const handoff = (from: string, to: string, key = `${from}->${to}`): Handoff => ({ key, from, to })

describe('a handoff between two faces in one line', () => {
  it('turns them toward each other along a row', () => {
    const sides = glancesAmong(['wren', 'atlas', 'sable'], [handoff('wren', 'sable')], 'row')
    expect(Object.fromEntries(sides)).toEqual({ wren: 'right', sable: 'left' })
  })

  it('and along a column', () => {
    const sides = glancesAmong(['wren', 'atlas', 'sable'], [handoff('sable', 'atlas')], 'column')
    expect(Object.fromEntries(sides)).toEqual({ sable: 'up', atlas: 'down' })
  })

  it('leaves everyone else as they were', () => {
    const sides = glancesAmong(['wren', 'atlas', 'sable'], [handoff('wren', 'atlas')], 'row')
    expect(sides.has('sable')).toBe(false)
  })
})

describe('no glance', () => {
  it('when the other face is not in the line: nobody to look at', () => {
    expect(glancesAmong(['wren', 'atlas'], [handoff('wren', 'pip')], 'row').size).toBe(0)
  })

  it('for a message to oneself', () => {
    expect(glancesAmong(['wren'], [handoff('wren', 'wren')], 'row').size).toBe(0)
  })

  it('with nothing handed over', () => {
    expect(glancesAmong(['wren', 'atlas'], [], 'row').size).toBe(0)
  })
})

it('a face in two handoffs at once looks toward the latest', () => {
  const sides = glancesAmong(['wren', 'atlas', 'sable'], [handoff('wren', 'atlas'), handoff('sable', 'atlas')], 'row')
  expect(sides.get('atlas')).toBe('right')
  expect(sides.get('wren')).toBe('right')
  expect(sides.get('sable')).toBe('left')
})
