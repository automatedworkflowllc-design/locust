import { describe, expect, it } from 'vitest'

import { groupBoundary } from './missionView.js'

/**
 * The line marks where a group's instructions began to apply -- after the
 * last turn that ran without them -- and is not drawn at all when drawing it
 * would claim something the record cannot support.
 */

const trading = { name: 'Trading', instructions: 'Quote sizes in shares.' }
const T1 = '2026-09-16T10:00:00.000Z', T2 = '2026-09-16T11:00:00.000Z', T3 = '2026-09-16T12:00:00.000Z'

describe('where a group began briefing a conversation', () => {
  it('sits before the first turn started after the join', () => {
    const joined = { at: '2026-09-16T10:30:00.000Z' }
    expect(groupBoundary([T1, T2, T3], joined, trading)?.beforeTurn).toBe(1)
    expect(groupBoundary([T1, T2, T3], { at: '2026-09-16T09:00:00.000Z' }, trading)?.beforeTurn).toBe(0)
  })

  it('sits below the last turn when the join came after it -- the NEXT turn is the first briefed', () => {
    const joined = { at: '2026-09-16T13:00:00.000Z' }
    expect(groupBoundary([T1, T2, T3], joined, trading)?.beforeTurn).toBe(3)
  })

  it('is not drawn when the moment is unknown, the group has no words, or there is no group', () => {
    expect(groupBoundary([T1], {}, trading)).toBeUndefined()
    expect(groupBoundary([T1], { at: T1 }, { name: 'Plain', instructions: '  ' })).toBeUndefined()
    expect(groupBoundary([T1], undefined, trading)).toBeUndefined()
    expect(groupBoundary([T1], { at: 'not a time' }, trading)).toBeUndefined()
  })

  it('treats a turn with no known start as before the join', () => {
    const joined = { at: '2026-09-16T10:30:00.000Z' }
    expect(groupBoundary([undefined, T2], joined, trading)?.beforeTurn).toBe(1)
    expect(groupBoundary([undefined, undefined], joined, trading)?.beforeTurn).toBe(2)
  })
})
