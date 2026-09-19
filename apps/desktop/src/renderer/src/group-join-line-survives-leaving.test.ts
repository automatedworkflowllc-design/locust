import { describe, expect, it } from 'vitest'

import { groupJoins } from './missionView.js'

/**
 * The join line stays after a conversation has left the group.
 *
 * Grok, passes 9, 10 and 11, the same sentence each time: after leaving,
 * "turns 3 and 4 were briefed and the thread no longer says so. Only the
 * stop is marked." The current membership drew the join line; a membership
 * that had ended drew only its leaving line, so a thread that had been in a
 * group and left told half the story -- and the half it dropped is the one
 * that says which turns were written under standing instructions.
 *
 * An ended membership records when it joined, when that was recorded. The
 * join line is drawn from that under the same rules as the current one.
 */

const T = (hour: number): string => `2026-09-17T${String(hour).padStart(2, '0')}:00:00.000Z`
const left = (at: string | undefined, instructions = 'Analysis only.') => ({
  name: 'Trading',
  instructions,
  ...(at === undefined ? {} : { at }),
  until: T(20)
})

describe('where an ended membership began briefing', () => {
  it('sits before the first turn started after the join, exactly as the live join line does', () => {
    expect(groupJoins([T(9), T(10), T(12)], [left(T(11))])).toEqual([
      { beforeTurn: 2, groupName: 'Trading', instructions: 'Analysis only.', joinedAt: T(11) }
    ])
  })

  it('brackets the briefed turns with the leaving line: join before turn 2, leave before turn 4', () => {
    // The shape Grok measured: six turns, joined after turn 2, left before
    // turn 5. Both lines, so turns 3 and 4 read as briefed.
    const starts = [T(1), T(2), T(3), T(4), T(5), T(6)]
    const [join] = groupJoins(starts, [{ name: 'Trading', instructions: 'Analysis only.', at: T(3), until: T(5) }])
    expect(join?.beforeTurn).toBe(2)
  })

  it('says nothing when the join moment was never recorded, or the group had no words', () => {
    // A file from before the moment was recorded: no line, rather than a
    // line at the top claiming every turn was briefed.
    expect(groupJoins([T(9), T(10)], [left(undefined)])).toEqual([])
    expect(groupJoins([T(9), T(10)], [left(T(9), '   ')])).toEqual([])
  })

  it('draws one join per ended membership, oldest first', () => {
    const joins = groupJoins([T(1), T(5), T(9)], [left(T(2)), left(T(6))])
    expect(joins.map((join) => join.beforeTurn)).toEqual([1, 2])
  })
})
