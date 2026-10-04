import { describe, expect, it } from 'vitest'

import type { PublicRoom } from '../../shared/ipc.js'
import type { SidebarMission } from './components/Sidebar.js'
import { roomLastAt, withRoomsFolded } from './conversationList.js'

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

  it('keeps a room nobody has posted to yet, placed by when it was made', () => {
    const fresh = { ...release, roomId: 'room_fresh', name: 'Fresh', createdAt: '2026-09-23T04:45:00.000Z', posts: [] } as unknown as PublicRoom
    const list = [
      conversation('mission_running', '2026-09-23T04:00:00.000Z', { title: 'Still going', phase: 'running' }),
      conversation('mission_new', '2026-09-23T05:00:00.000Z', { title: 'Newer' }),
      conversation('mission_old', '2026-09-23T04:10:00.000Z', { title: 'Older' })
    ]
    const entries = withRoomsFolded(list, [fresh])
    expect(entries.map((entry) => (entry.kind === 'room' ? `room:${entry.room.name}` : entry.mission.title))).toEqual([
      'Still going',
      'Newer',
      'room:Fresh',
      'Older'
    ])
    const room = entries[2]
    expect(room?.kind === 'room' ? room.missions : ['x']).toEqual([])
  })

  it('leaves every other conversation as it was', () => {
    const list = [conversation('a', '2026-09-23T05:00:00.000Z'), conversation('b', '2026-09-23T04:00:00.000Z')]
    expect(withRoomsFolded(list, []).every((entry) => entry.kind === 'conversation')).toBe(true)
    expect(withRoomsFolded(list, [release]).every((entry) => entry.kind === 'conversation')).toBe(true)
  })
})

/*
 * L16 (the code review): two rooms nobody has posted to came out oldest
 * first. An empty room already placed timed as 0 -- it has no answers -- so
 * every older empty room was put above it.
 */
describe('rooms nobody has posted to', () => {
  it('are newest first, like every other row', () => {
    const empty = (roomId: string, name: string, createdAt: string): PublicRoom =>
      ({ roomId, name, teammateIds: [], createdAt, posts: [], tasks: [] }) as unknown as PublicRoom
    const entries = withRoomsFolded(
      [conversation('mission_old', '2026-09-20T00:00:00.000Z', { title: 'Old work' })],
      [empty('room_a', 'Made first', '2026-09-23T01:00:00.000Z'), empty('room_b', 'Made second', '2026-09-23T02:00:00.000Z'), empty('room_c', 'Made third', '2026-09-23T03:00:00.000Z')]
    )
    expect(entries.map((entry) => (entry.kind === 'room' ? entry.room.name : entry.mission.title))).toEqual(['Made third', 'Made second', 'Made first', 'Old work'])
  })
})

/*
 * "pair 15h" straight after two posts (drive-room-remembers, 2026-09-26): the
 * row read its answers' times alone, a run the host started had none, and the
 * room fell back to the day it was made.
 */
describe('how old a room reads', () => {
  const answer = (missionId: string, lastAt?: string): SidebarMission => ({
    missionId,
    title: 'x',
    phase: 'completed',
    integrityIssueCount: 0,
    ...(lastAt === undefined ? {} : { lastAt })
  })

  it('is its newest post when no answer has a time', () => {
    expect(roomLastAt(release, [answer('mission_wren'), answer('mission_booty')])).toBe('2026-09-23T04:31:00.000Z')
  })

  it('is its newest answer when that came after the post', () => {
    expect(roomLastAt(release, [answer('mission_wren', '2026-09-23T04:35:00.000Z'), answer('mission_booty', '2026-09-23T04:33:00.000Z')])).toBe('2026-09-23T04:35:00.000Z')
  })

  it('is its making only when nobody has posted to it', () => {
    const empty = { ...release, posts: [] } as unknown as PublicRoom
    expect(roomLastAt(empty, [])).toBe('2026-09-23T04:30:00.000Z')
  })

  it('ignores a time that is not one', () => {
    expect(roomLastAt(release, [answer('mission_wren', 'not a time')])).toBe('2026-09-23T04:31:00.000Z')
    const unposted = { ...release, posts: [] } as unknown as PublicRoom
    expect(roomLastAt(unposted, [answer('mission_wren', 'not a time')])).toBe('2026-09-23T04:30:00.000Z')
  })
})
