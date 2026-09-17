import { describe, expect, it } from 'vitest'

import { groupLeavings } from './missionView.js'

/**
 * The mirror of the join line: where a group's words STOPPED briefing.
 *
 * Design agent, 2026-09-16, wording confirmed: "Trading's instructions no
 * longer apply from here". Same placement rules as the join line, mirrored.
 */

const T = (hour: number): string => `2026-09-17T${String(hour).padStart(2, '0')}:00:00.000Z`
const left = (until: string, instructions = 'Words.') => ({ name: 'Trading', instructions, until })

describe('where a group stopped briefing a conversation', () => {
  it('sits before the first turn started after the leave', () => {
    expect(groupLeavings([T(9), T(10), T(12)], [left(T(11))])).toEqual([{ beforeTurn: 2, groupName: 'Trading' }])
  })

  it('sits below the last turn when the leave came after it', () => {
    expect(groupLeavings([T(9), T(10)], [left(T(11))])).toEqual([{ beforeTurn: 2, groupName: 'Trading' }])
  })

  it('says nothing for a group that had no words, or a leave with no readable moment', () => {
    expect(groupLeavings([T(9)], [left(T(10), '  ')])).toEqual([])
    expect(groupLeavings([T(9)], [left('not a time')])).toEqual([])
  })

  it('draws one line per leave, oldest first, and treats an unknown turn start as before the leave', () => {
    expect(groupLeavings([undefined, T(10), T(14)], [left(T(9)), left(T(13))])).toEqual([
      { beforeTurn: 1, groupName: 'Trading' },
      { beforeTurn: 2, groupName: 'Trading' }
    ])
  })
})
