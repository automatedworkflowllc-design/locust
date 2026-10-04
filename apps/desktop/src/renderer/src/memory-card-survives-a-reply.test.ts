import { describe, expect, it } from 'vitest'

import { memoriesOfConversation, memoriesOfTurn, turnsOfConversation } from './conversationMemories.js'
import type { ConversationMemory } from './conversationMemories.js'

/**
 * A memory does not vanish because you replied.
 *
 * Colin, 2026-09-10: "after an agent 'remembers something' it disappears in
 * chat." A reply is its own mission, so the card -- which matched the memory
 * against the mission the workroom is SHOWING -- lost every memory learned on
 * an earlier turn the moment a later one began.
 */

const memory = (missionId: string, text: string): ConversationMemory => ({
  missionId,
  by: { name: 'Wren' },
  text,
  status: 'kept'
})

/** One conversation of three turns, as the sidebar holds it. */
const ROWS = [
  { missionId: 'turn1', memberIds: ['turn1', 'turn2', 'turn3'] },
  { missionId: 'other', memberIds: ['other'] }
]

describe('the memories of a conversation', () => {
  it('are every turn of it, whichever turn is on screen', () => {
    const memories = [memory('turn1', 'prefers tabs'), memory('turn3', 'deploys on Fridays')]
    for (const shown of ['turn1', 'turn2', 'turn3']) {
      const found = memoriesOfConversation(memories, turnsOfConversation(shown, ROWS))
      expect(found.map((line) => line.text), shown).toEqual(['prefers tabs', 'deploys on Fridays'])
    }
  })

  it('never leak in from another conversation', () => {
    const memories = [memory('turn1', 'ours'), memory('other', 'theirs')]
    const found = memoriesOfConversation(memories, turnsOfConversation('turn2', ROWS))
    expect(found.map((line) => line.text)).toEqual(['ours'])
  })

  it('are the shown turn alone when the sidebar has not caught up yet', () => {
    // A conversation that started a moment ago has no row. Its own memories
    // are still its own.
    const found = memoriesOfConversation([memory('fresh', 'just learned')], turnsOfConversation('fresh', []))
    expect(found.map((line) => line.text)).toEqual(['just learned'])
  })

  it('are none at all when nothing is shown', () => {
    expect(turnsOfConversation(undefined, ROWS).size).toBe(0)
    expect(memoriesOfConversation([memory('turn1', 'x')], turnsOfConversation(undefined, ROWS))).toEqual([])
  })

  it('ignore a memory that names no conversation', () => {
    const orphan: ConversationMemory = { by: { name: 'Wren' }, text: 'from nowhere', status: 'kept' }
    const found = memoriesOfConversation([orphan, memory('turn1', 'ours')], turnsOfConversation('turn1', ROWS))
    expect(found.map((line) => line.text)).toEqual(['ours'])
  })

  it('keep the order they were learned in', () => {
    const memories = [memory('turn3', 'third'), memory('turn1', 'first')]
    const found = memoriesOfConversation(memories, turnsOfConversation('turn2', ROWS))
    // The list's own order is the order they were learned; this does not
    // re-sort, it filters.
    expect(found.map((line) => line.text)).toEqual(['third', 'first'])
  })
})

/**
 * And each one is drawn where it HAPPENED.
 *
 * Colin, 2026-09-11: "the remembered tab should stay at where the memory
 * happened, not permanently at the bottom." The conversation's memories were
 * gathered correctly and then drawn as one card at the foot of the thread, so
 * a memory learned on turn one appeared under turn five -- reading as
 * something the last reply had just done.
 */
describe('a memory belongs to the turn it was learned on', () => {
  const lines = memoriesOfConversation(
    [memory('turn1', 'learned first'), memory('turn3', 'learned later')],
    turnsOfConversation('turn2', ROWS)
  )

  it('keeps the turn on the line, so the thread can place it', () => {
    expect(lines.map((line) => line.missionId)).toEqual(['turn1', 'turn3'])
  })

  it('gives each turn only its own', () => {
    expect(memoriesOfTurn(lines, 'turn1').map((line) => line.text)).toEqual(['learned first'])
    expect(memoriesOfTurn(lines, 'turn3').map((line) => line.text)).toEqual(['learned later'])
  })

  it('gives a turn that taught nothing an empty card rather than a neighbour list', () => {
    expect(memoriesOfTurn(lines, 'turn2')).toEqual([])
  })

  it('draws nothing at all when there is no turn to draw under', () => {
    expect(memoriesOfTurn(lines, undefined)).toEqual([])
  })
})
