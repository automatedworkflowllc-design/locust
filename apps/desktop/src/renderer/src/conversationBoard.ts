import type { PublicRoom } from '../../shared/ipc.js'
import type { SidebarMission } from './components/Sidebar.js'
import { byLiveThenRecent, conversationKeys, withRoomsFolded } from './conversationList.js'
import { missionPhaseView } from './status.js'

/**
 * CONVERSATIONS, AS A BOARD (0.585).
 *
 * The team board (`teamBoard.ts`) groups teammates by what they need from
 * the person. This is that for conversations -- Devin Desktop's Command
 * Center, over every runtime at once. The screen that draws it is
 * `components/BoardScreen.tsx`; this only decides the columns.
 *
 * A card is one sidebar row. Two of its columns come from the mark the row
 * itself carries, and two from facts the window holds about it, handed in as
 * `ConversationBoardFacts` so this never disagrees with the sidebar or the
 * title bar about the same conversation:
 *
 *   Needs you          its run waits on a card or a question (the window's
 *                      needs-you list, by turn id)
 *   Working            the phase mark is RUNNING -- the spark, not the dot
 *   Ready to look at   its run ended while the person was elsewhere, and
 *                      the conversation has not been opened since
 *   Done               every other phase
 *
 * A conversation waiting on the person comes first even while its run is
 * live: it is paused on them. The data half was built by Grok on
 * `exec/conversation-board` from the rows alone and named the two columns
 * it could not fill; the facts were added when the screen was built.
 *
 * A room is not a conversation here: `withRoomsFolded` already decides
 * which rows stand for a room, and those rows are left out. So is anything
 * whose id is in the trash.
 *
 * A sub-conversation is its own card, once. The id it carries is
 * `nestedUnder` -- the conversation the sidebar draws it under -- not
 * `parentId`, which is the previous turn of the same conversation.
 *
 * Empty columns are left out. When nothing needs the person, nothing is
 * working and nothing waits to be looked at, the result is undefined: a
 * quiet list is not a board of one Done column.
 */

export type ConversationBoardKey = 'needs-you' | 'working' | 'to-look-at' | 'done'

export interface ConversationCard {
  readonly row: SidebarMission
  /** The conversation the sidebar nests this one under, when it does. */
  readonly parentId?: string
}

export interface ConversationBoardSection {
  readonly key: ConversationBoardKey
  readonly title: string
  readonly members: readonly ConversationCard[]
}

/** What the window knows about a conversation that its row does not carry. Any turn's id stands for the conversation. */
export interface ConversationBoardFacts {
  /** Turns whose run waits on a card or a question. */
  readonly needsYou?: ReadonlySet<string>
  /** Turns whose run ended while the person was elsewhere, not opened since. */
  readonly toLookAt?: ReadonlySet<string>
}

const TITLES: Readonly<Record<ConversationBoardKey, string>> = {
  'needs-you': 'Needs you',
  working: 'Working',
  'to-look-at': 'Ready to look at',
  done: 'Done'
}

const ORDER: readonly ConversationBoardKey[] = ['needs-you', 'working', 'to-look-at', 'done']

/** The sidebar's running mark for this row: the spark, which is the RUNNING phase. */
export function conversationIsRunning(row: SidebarMission): boolean {
  return missionPhaseView(row.phase, row.integrityIssueCount > 0).tag === 'RUNNING'
}

function anyOf(row: SidebarMission, ids: ReadonlySet<string> | undefined): boolean {
  return ids !== undefined && ids.size > 0 && conversationKeys(row).some((id) => ids.has(id))
}

export function conversationColumn(row: SidebarMission, facts: ConversationBoardFacts = {}): ConversationBoardKey {
  if (anyOf(row, facts.needsYou)) return 'needs-you'
  if (conversationIsRunning(row)) return 'working'
  if (anyOf(row, facts.toLookAt)) return 'to-look-at'
  return 'done'
}

function cardOf(row: SidebarMission): ConversationCard {
  return row.nestedUnder === undefined ? { row } : { row, parentId: row.nestedUnder }
}

function inTrash(row: SidebarMission, trashed: ReadonlySet<string>): boolean {
  return conversationKeys(row).some((id) => trashed.has(id))
}

/**
 * The board, in order, newest activity first inside a column -- or undefined
 * when it would be one Done column. `rooms` and `trashed` are the same facts
 * the sidebar and the trash screen already hold; all default to nothing.
 */
export function conversationBoard(
  rows: readonly SidebarMission[],
  rooms: readonly PublicRoom[] = [],
  trashed: ReadonlySet<string> = new Set(),
  facts: ConversationBoardFacts = {}
): readonly ConversationBoardSection[] | undefined {
  const kept = rows.filter((row) => !inTrash(row, trashed))
  const conversations = withRoomsFolded(kept, rooms).flatMap((entry) => (entry.kind === 'conversation' ? [entry.mission] : []))
  const sections = ORDER.map((key) => ({
    key,
    title: TITLES[key],
    members: conversations.filter((row) => conversationColumn(row, facts) === key).sort(byLiveThenRecent).map(cardOf)
  }))
  if (sections.every((section) => section.key === 'done' || section.members.length === 0)) return undefined
  return sections.filter((section) => section.members.length > 0)
}
