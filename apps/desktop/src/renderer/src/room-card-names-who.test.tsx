import { describe, expect, it } from 'vitest'

import { roomCardMeta } from './components/RoomScreen.js'

/**
 * A ROOM'S CARD SAYS WHO IS IN IT AND WHEN IT WAS USED (0.416).
 *
 * Fresh-eyes area 10: the Rooms screen's card read "2 teammates · 1 post".
 * drive-a-room-from-scratch reads the card on the packaged build.
 */
const team = [
  { teammateId: 'a', name: 'Atlas' },
  { teammateId: 'q', name: 'Quill' },
  { teammateId: 'w', name: 'Wren' },
  { teammateId: 'm', name: 'Marlow' }
]
const now = new Date('2026-09-27T12:00:00.000Z')

describe('roomCardMeta', () => {
  it('names the members, counts the posts, and says how long since the last', () => {
    const room = { teammateIds: ['a', 'q'], createdAt: '2026-09-26T12:00:00.000Z', posts: [{ at: '2026-09-27T11:58:00.000Z' }] } as never
    expect(roomCardMeta(room, team, now)).toBe('Atlas · Quill · 1 post · 2m')
  })

  it('says nothing has been posted, and dates a new room by its making', () => {
    const room = { teammateIds: ['a'], createdAt: '2026-09-27T09:00:00.000Z', posts: [] } as never
    expect(roomCardMeta(room, team, now)).toBe('Atlas · nothing posted yet · 3h')
  })

  it('names two and counts the rest past three', () => {
    const room = { teammateIds: ['a', 'q', 'w', 'm'], createdAt: '2026-09-27T11:00:00.000Z', posts: [] } as never
    expect(roomCardMeta(room, team, now)).toBe('Atlas · Quill +2 · nothing posted yet · 1h')
  })
})
