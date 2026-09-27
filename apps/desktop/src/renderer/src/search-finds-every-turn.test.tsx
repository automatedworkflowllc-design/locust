import { describe, expect, it } from 'vitest'

import APP from './App.tsx?raw'
import PALETTE from './components/CommandPalette.tsx?raw'
import SIDEBAR from './components/Sidebar.tsx?raw'
import { collapseConversations, missionsMatching } from './status.js'

/**
 * SEARCH FINDS A WORD FROM ANY TURN, AND A TEAMMATE'S NAME (0.414).
 *
 * Fresh-eyes area 8, on 0.413: a conversation is named by its first turn, and
 * search matched only that name. "signup", said in the second turn, found
 * nothing; "Atlas" found nothing of Atlas's; and Escape left the box as it
 * was. drive-sidebar-and-search drives all three on the packaged build.
 */
const turn = (missionId: string, title: string, words: string, parentId?: string) => ({
  missionId,
  title,
  words,
  phase: 'completed',
  integrityIssueCount: 0,
  rootId: 'mission_login',
  ...(parentId === undefined ? {} : { parentId })
})
const rows = collapseConversations([
  turn('mission_login', 'Fix the login redirect loop', 'Fix the login redirect loop'),
  turn('mission_signup', 'Fix the login redirect loop', 'Also check the signup form does the same thing', 'mission_login'),
  turn('mission_ship', 'Fix the login redirect loop', 'Good, ship it', 'mission_signup'),
  { missionId: 'mission_crm', title: 'Summarize the CRM quotes', words: 'Summarize the CRM quotes', phase: 'completed', integrityIssueCount: 0 }
])

describe('the sidebar search', () => {
  it('keeps every turn’s words on the conversation’s one row', () => {
    expect(rows).toHaveLength(2)
    expect(rows[0]!.said).toBe('Fix the login redirect loop · Also check the signup form does the same thing · Good, ship it')
  })

  it('finds a conversation by a word only its second turn said, as one row under its own name', () => {
    const found = missionsMatching(rows, 'signup')
    expect(found.map((row) => row.title)).toEqual(['Fix the login redirect loop'])
    // The row is the conversation's newest turn, so opening it opens the conversation where it is.
    expect(found[0]!.missionId).toBe('mission_ship')
  })

  it('finds a teammate’s conversations by the teammate’s name', () => {
    const owner = (row: { readonly missionId: string }): string | undefined => (row.missionId === 'mission_crm' ? 'Atlas' : 'Wren')
    expect(missionsMatching(rows, 'atlas', owner).map((row) => row.missionId)).toEqual(['mission_crm'])
    expect(missionsMatching(rows, 'atlas').map((row) => row.missionId)).toEqual([])
  })
})

describe('Escape in the search box', () => {
  const sidebar = SIDEBAR
  it('empties it, and lets Escape through when it is already empty', () => {
    expect(sidebar).toContain("if (event.key !== 'Escape' || query.length === 0) return")
    expect(sidebar).toContain("setQuery('')")
  })

  it('every list the search narrows is narrowed by the teammate’s name too', () => {
    expect(sidebar).toContain('missionsMatching(missions, query, ownerName)).filter(')
    expect(sidebar).toContain('missionsMatching(owned, query, ownerName)')
    expect(sidebar).toContain('missionsMatching(missions, query, ownerName).length === 0')
    expect(sidebar).not.toMatch(/missionsMatching\((missions|owned), query\)/)
  })
})

describe('Ctrl K', () => {
  it('lists conversations, found by every turn and the teammate -- the only search in the rail layout', () => {
    expect(APP).toContain("group: 'Conversations',")
    expect(APP).toContain("keywords: `${mission.said ?? ''} ${owner ?? ''}`,")
    expect(APP).toContain('run: () => openMission(mission.missionId)')
    expect(PALETTE).toContain("`${action.group} ${action.label} ${action.keywords ?? ''}`.toLowerCase().includes(needle)")
  })

  it('shows only the five newest before anything is typed', () => {
    expect(APP).toContain('...(position < 5 ? {} : { whenTyped: true }),')
    expect(PALETTE).toContain('if (needle.length === 0) return actions.filter((action) => action.whenTyped !== true)')
  })
})
