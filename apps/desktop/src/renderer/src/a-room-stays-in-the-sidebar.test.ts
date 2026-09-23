import { describe, expect, it } from 'vitest'

import type { PublicRoom } from '../../shared/ipc.js'
import type { SidebarMission } from './components/Sidebar.js'
import { withRoomsFolded } from './conversationList.js'

/**
 * A ROOM STAYS IN THE SIDEBAR, AS ITSELF.
 *
 * Yurt's beta report (2026-09-23, #7): after making "Release" and opening one
 * answer, the sidebar had no row for the room -- two identical rows titled "In
 * one sentence each: what d..." stood in for it, and the only way back was the
 * Rooms screen. A post starts a conversation per teammate, each titled with
 * the post, and the ordinary sidebar has no Rooms section.
 */
const conversation = (missionId: string, lastAt: string, extra: Partial<SidebarMission> = {}): SidebarMission => ({
  missionId,
  title: 'In one sentence each: what does README.md say?',
  phase: 'completed',
  integrityIssueCount: 0,
  lastAt,
  ...extra
})

const release: PublicRoom = {
  roomId: 'room_release',
  name: 'Release',
  teammateIds: ['tm_wren', 'tm_booty'],
  createdAt: '2026-09-23T04:30:00.000Z',
  posts: [
    {
      postId: 'post_1',
      text: 'In one sentence each: what does README.md say?',
      at: '2026-09-23T04:31:00.000Z',
      missions: { tm_wren: 'mission_wren', tm_booty: 'mission_booty' }
    }
  ],
  tasks: []
} as unknown as PublicRoom

describe('a room in the sidebar', () => {
  it('is one row for its answers, where its newest answer was', () => {
    const list = [
      conversation('mission_other_new', '2026-09-23T05:00:00.000Z', { title: 'Fix the tests' }),
      conversation('mission_wren', '2026-09-23T04:32:00.000Z'),
      conversation('mission_between', '2026-09-23T04:31:30.000Z', { title: 'Something else' }),
      conversation('mission_booty', '2026-09-23T04:31:20.000Z')
    ]
    const entries = withRoomsFolded(list, [release])
    expect(entries.map((entry) => (entry.kind === 'room' ? `room:${entry.room.name}` : entry.mission.title))).toEqual([
      'Fix the tests',
      'room:Release',
      'Something else'
    ])
    const room = entries[1]
    expect(room?.kind === 'room' ? room.missions.map((mission) => mission.missionId) : []).toEqual(['mission_wren', 'mission_booty'])
  })

  it('finds a room answer that was replied to, by any turn of the conversation', () => {
    const replied = conversation('mission_reply', '2026-09-23T04:40:00.000Z', { memberIds: ['mission_wren', 'mission_reply'] })
    const entries = withRoomsFolded([replied], [release])
    expect(entries[0]?.kind).toBe('room')
  })

  it('leaves every other conversation as it was', () => {
    const list = [conversation('a', '2026-09-23T05:00:00.000Z'), conversation('b', '2026-09-23T04:00:00.000Z')]
    expect(withRoomsFolded(list, []).every((entry) => entry.kind === 'conversation')).toBe(true)
    expect(withRoomsFolded(list, [release]).every((entry) => entry.kind === 'conversation')).toBe(true)
  })
})
