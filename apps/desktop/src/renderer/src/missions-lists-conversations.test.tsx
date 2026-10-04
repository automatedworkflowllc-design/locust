import { describe, expect, it } from 'vitest'

import SCREENS from './components/Screens.tsx?raw'
import { conversationsOf } from './missionsList.js'

/**
 * THE MISSIONS SCREEN LISTS CONVERSATIONS, AND SAYS WHEN (0.415).
 *
 * Fresh-eyes area 9, on 0.414 with sixteen conversations: the header said
 * "18 conversations" beside a sidebar of 16, every turn was its own row --
 * "Good, ship it" alone, meaning nothing -- and no row said when. Deleting a
 * row took one turn and left the rest of its conversation behind.
 * drive-missions-screen drives it on the packaged build.
 */
const turn = (missionId: string, createdAt: string, continuesFrom?: string) => ({
  missionId,
  createdAt,
  ...(continuesFrom === undefined ? {} : { continuesFrom: { missionId: continuesFrom } })
})
// Newest first, as the ledger hands them over.
const missions = [
  turn('m_ship', '2026-09-27T10:04:00Z', 'm_signup'),
  turn('m_signup', '2026-09-27T10:02:00Z', 'm_login'),
  turn('m_login', '2026-09-27T10:00:00Z'),
  turn('m_crm', '2026-09-27T09:00:00Z'),
  // A follow-up whose earlier turn is gone (deleted, or another folder's) stands as its own.
  turn('m_orphan', '2026-09-26T09:00:00Z', 'm_missing')
]

describe('conversationsOf', () => {
  const rows = conversationsOf(missions)

  it('is one row per conversation, where its newest turn stood', () => {
    expect(rows.map((row) => row.key)).toEqual(['m_login', 'm_crm', 'm_orphan'])
  })

  it('names it by its first turn, stands it on its newest, and holds every turn oldest first', () => {
    expect(rows[0]!.root.missionId).toBe('m_login')
    expect(rows[0]!.leaf.missionId).toBe('m_ship')
    expect(rows[0]!.members.map((member) => member.missionId)).toEqual(['m_login', 'm_signup', 'm_ship'])
  })

  it('ends a hand-edited cycle instead of spinning', () => {
    const cycle = conversationsOf([turn('a', '2026-09-27T10:00:00Z', 'b'), turn('b', '2026-09-27T09:00:00Z', 'a')])
    expect(cycle.flatMap((row) => row.members)).toHaveLength(2)
  })
})

describe('the Missions screen', () => {
  it('lists conversations, and deletes a conversation with every turn', () => {
    expect(SCREENS).toContain('const conversations = conversationsOf(missions)')
    expect(SCREENS).toContain('.flatMap((entry) => entry.members.map((mission) => mission.missionId))')
    expect(SCREENS).toContain('meta={`${conversations.length} ${conversations.length === 1 ?')
  })

  it('says when, and how many turns', () => {
    expect(SCREENS).toContain('{shortAgo(mission.lastUpdatedAt) ?? \'\'}')
    expect(SCREENS).toContain('`${String(entry.members.length)} turns · ${elapsed}`')
  })
})
