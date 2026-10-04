import { describe, expect, it } from 'vitest'

import type { PublicRoom } from '../../shared/ipc.js'
import type { SidebarMission } from './components/Sidebar.js'
import { conversationBoard, conversationColumn, conversationIsRunning } from './conversationBoard.js'
import { missionPhaseView } from './status.js'

/**
 * Conversations in columns, from the marks the sidebar already draws and the
 * two facts the window holds about a conversation (0.585): whether its run
 * waits on the person, and whether its finish has been looked at.
 */

const row = (over: Partial<SidebarMission> & { missionId: string }): SidebarMission =>
  ({ title: over.missionId, phase: 'completed', integrityIssueCount: 0, ...over })

const room = (missionId: string): PublicRoom =>
  ({
    roomId: 'room_release',
    name: 'Release',
    teammateIds: ['tm_wren'],
    createdAt: '2026-10-04T00:00:00.000Z',
    posts: [{ postId: 'post_1', text: 'What does README.md say?', at: '2026-10-04T00:01:00.000Z', missions: { tm_wren: missionId } }],
    tasks: []
  }) as unknown as PublicRoom

const idsIn = (board: ReturnType<typeof conversationBoard>): readonly (readonly [string, string, string | undefined])[] =>
  board?.flatMap((section) => section.members.map((card) => [card.row.missionId, section.key, card.parentId] as const)) ?? []

describe('conversations as a board', () => {
  it('puts a live run in Working and every other phase in Done', () => {
    const board = conversationBoard([
      row({ missionId: 'live', phase: 'running', lastAt: '2026-10-04T01:00:00.000Z' }),
      row({ missionId: 'finished', phase: 'completed', lastAt: '2026-10-04T02:00:00.000Z' }),
      row({ missionId: 'broke', phase: 'failed', lastAt: '2026-10-04T03:00:00.000Z' }),
      row({ missionId: 'stopped', phase: 'interrupted', lastAt: '2026-10-04T04:00:00.000Z' }),
      row({ missionId: 'called', phase: 'cancelled', lastAt: '2026-10-04T05:00:00.000Z' })
    ])
    expect(board?.map((section) => [section.key, section.title, section.members.map((card) => card.row.missionId)])).toEqual([
      ['working', 'Working', ['live']],
      ['done', 'Done', ['called', 'stopped', 'broke', 'finished']]
    ])
  })

  it('orders a column newest first', () => {
    const board = conversationBoard([
      row({ missionId: 'older', phase: 'running', lastAt: '2026-10-04T01:00:00.000Z' }),
      row({ missionId: 'newer', phase: 'running', lastAt: '2026-10-04T03:00:00.000Z' }),
      row({ missionId: 'middle', phase: 'running', lastAt: '2026-10-04T02:00:00.000Z' })
    ])
    expect(board?.map((section) => section.members.map((card) => card.row.missionId))).toEqual([['newer', 'middle', 'older']])
  })

  it('leaves a room and a trashed conversation out', () => {
    const board = conversationBoard(
      [
        row({ missionId: 'live', phase: 'running', lastAt: '2026-10-04T03:00:00.000Z' }),
        row({ missionId: 'room-answer', phase: 'running', lastAt: '2026-10-04T04:00:00.000Z' }),
        row({ missionId: 'trashed', phase: 'running', lastAt: '2026-10-04T05:00:00.000Z', rootId: 'root-trashed' })
      ],
      [room('room-answer')],
      new Set(['root-trashed'])
    )
    expect(idsIn(board).map(([id]) => id)).toEqual(['live'])
  })

  it('lists a sub-conversation once, with the conversation it sits under', () => {
    const board = conversationBoard([
      row({ missionId: 'boss', title: 'Boss', phase: 'running', lastAt: '2026-10-04T02:00:00.000Z' }),
      row({ missionId: 'tasks', title: 'Tasks', phase: 'completed', lastAt: '2026-10-04T03:00:00.000Z', nestedUnder: 'boss' })
    ])
    expect(idsIn(board)).toEqual([
      ['boss', 'working', undefined],
      ['tasks', 'done', 'boss']
    ])
    expect(idsIn(board).filter(([id]) => id === 'tasks')).toHaveLength(1)
  })

  it('draws nothing when nobody is working and nothing waits', () => {
    expect(conversationBoard([
      row({ missionId: 'finished', phase: 'completed' }),
      row({ missionId: 'broke', phase: 'failed' })
    ])).toBeUndefined()
    expect(conversationBoard([])).toBeUndefined()
  })

  it('lands each conversation in the column the sidebar mark already gives that row', () => {
    const rows = [
      row({ missionId: 'live', phase: 'running' }),
      row({ missionId: 'finished', phase: 'completed' }),
      row({ missionId: 'broke', phase: 'failed' }),
      row({ missionId: 'torn', phase: 'completed', integrityIssueCount: 2 })
    ]
    const board = conversationBoard(rows)
    const columnOf = new Map(idsIn(board).map(([id, key]) => [id, key]))
    for (const entry of rows) {
      const running = conversationIsRunning(entry)
      expect(running).toBe(missionPhaseView(entry.phase, entry.integrityIssueCount > 0).tag === 'RUNNING')
      expect(columnOf.get(entry.missionId)).toBe(running ? 'working' : 'done')
    }
  })

  describe('with what the window knows (0.585)', () => {
    const at = (hour: number): string => `2026-10-04T0${String(hour)}:00:00.000Z`

    it('puts a conversation waiting on you first, even while its run is live, and a finish not looked at since in Ready to look at', () => {
      const board = conversationBoard(
        [
          row({ missionId: 'asks', phase: 'running', lastAt: at(3) }),
          row({ missionId: 'live', phase: 'running', lastAt: at(2) }),
          row({ missionId: 'ended', phase: 'completed', lastAt: at(4), memberIds: ['ended-1', 'ended'] }),
          row({ missionId: 'old', phase: 'completed', lastAt: at(1) })
        ],
        [],
        new Set(),
        // Any turn's id stands for its conversation: the finish is known by an older turn's id.
        { needsYou: new Set(['asks']), toLookAt: new Set(['ended-1']) }
      )
      expect(board?.map((section) => [section.key, section.members.map((card) => card.row.missionId)])).toEqual([
        ['needs-you', ['asks']],
        ['working', ['live']],
        ['to-look-at', ['ended']],
        ['done', ['old']]
      ])
    })

    it('a finish to look at keeps the board up on its own; one looked at since does not (control)', () => {
      const ended = row({ missionId: 'ended', phase: 'completed' })
      expect(conversationBoard([ended], [], new Set(), { toLookAt: new Set(['ended']) })?.map((section) => section.key)).toEqual(['to-look-at'])
      expect(conversationBoard([ended], [], new Set(), { toLookAt: new Set(['someone-else']) })).toBeUndefined()
      expect(conversationColumn(ended, { needsYou: new Set(['ended']) })).toBe('needs-you')
      expect(conversationColumn(ended, {})).toBe('done')
    })
  })
})
