import type { WorkroomMessage } from '@teammate/mission-store'
import { describe, expect, it } from 'vitest'

import { ROOM_HISTORY_CLOSE } from '../shared/room-history.js'
import type { RoomHistory } from '../shared/room-history.js'
import { composeRuntimePrompt, MAX_RUNTIME_PROMPT_LENGTH } from './workroom-briefing.js'
import type { MissionPeerContext } from './workroom-briefing.js'

/**
 * A ROOM MEMBER IS TOLD THE ROOM SO FAR (0.370).
 *
 * The room's earlier posts and finished answers ride with the peer context
 * and go just ahead of the post, in the room the rest of the prompt leaves.
 * They are the first thing to give way: a waiting message is never shed to
 * make space for them.
 */
const PEER: MissionPeerContext = {
  self: { teammateId: 'tm_wren', name: 'Wren', role: 'Code & Migrations' },
  others: [{ teammateId: 'tm_booty', name: 'Booty', role: 'Research & Briefs' }]
}
const HISTORY: RoomHistory = {
  roomName: 'Release',
  posts: [
    {
      text: 'Plan the release.',
      answers: [
        { teammateId: 'tm_wren', name: 'Wren', text: 'First, tag. Second, publish the notes.' },
        { teammateId: 'tm_booty', name: 'Booty', text: 'Smoke test before the tag.' }
      ]
    }
  ]
}
const IN_ROOM: MissionPeerContext = { ...PEER, roomHistory: HISTORY }
const POST = 'Wren, say more about your second point.'
const message = (index: number, text: string): WorkroomMessage => ({
  messageId: `wm_${String(index)}`,
  sequence: index,
  from: { teammateId: 'tm_booty', name: 'Booty', missionId: `mission_${String(index)}` },
  to: { teammateId: 'tm_wren', name: 'Wren' },
  text,
  postedAt: '2026-09-26T12:00:00.000Z'
})

describe('a room member’s brief', () => {
  it('carries the room so far between what arrived this turn and the post', () => {
    const composed = composeRuntimePrompt({ prompt: POST, peer: IN_ROOM, inbound: [message(1, 'The tests pass on main.')], remaining: 0 })
    const prompt = composed.prompt
    const said = prompt.indexOf('You answered: First, tag. Second, publish the notes.')
    expect(said).toBeGreaterThan(-1)
    expect(prompt).toContain('Booty answered: Smoke test before the tag.')
    expect(prompt.indexOf('The tests pass on main.')).toBeLessThan(said)
    expect(prompt.endsWith(`${ROOM_HISTORY_CLOSE}\n\n${POST}`)).toBe(true)
    expect(composed.delivered).toHaveLength(1)
  })

  it('is exactly the brief it was when there is no room', () => {
    const outside = composeRuntimePrompt({ prompt: POST, peer: PEER, inbound: [], remaining: 0 })
    const empty = composeRuntimePrompt({ prompt: POST, peer: { ...PEER, roomHistory: { roomName: 'Release', posts: [] } }, inbound: [], remaining: 0 })
    expect(outside.prompt).not.toContain('What was said in the room')
    expect(empty.prompt).toBe(outside.prompt)
  })

  it('never pushes out a waiting message: it takes only what is left', () => {
    const long = { ...HISTORY, posts: Array.from({ length: 4 }, (_, index) => ({ text: `Q${String(index)}`, answers: [{ teammateId: 'tm_booty', name: 'Booty', text: 'z '.repeat(2_000) }] })) }
    const messages = Array.from({ length: 5 }, (_, index) => message(index + 1, 'm'.repeat(700)))
    // A post long enough that the messages only just fit beside it.
    const without = composeRuntimePrompt({ prompt: 'p'.repeat(6_500), peer: PEER, inbound: messages, remaining: 0 })
    const withRoom = composeRuntimePrompt({ prompt: 'p'.repeat(6_500), peer: { ...PEER, roomHistory: long }, inbound: messages, remaining: 0 })
    expect(withRoom.delivered).toHaveLength(without.delivered.length)
    expect(withRoom.prompt.length).toBeLessThanOrEqual(MAX_RUNTIME_PROMPT_LENGTH)
  })

  it('gives way entirely when the post and the brief fill the prompt', () => {
    const full = composeRuntimePrompt({ prompt: 'p'.repeat(MAX_RUNTIME_PROMPT_LENGTH), peer: IN_ROOM, inbound: [], remaining: 0 })
    expect(full.prompt).not.toContain('What was said in the room')
  })
})
