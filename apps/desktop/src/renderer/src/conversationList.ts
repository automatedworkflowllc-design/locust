/**
 * The sidebar's list, flat and newest first.
 *
 * Until 0.139.0 conversations were nested under the teammate who owned them,
 * so the primary axis of the sidebar was **who ran it**. Finding a
 * conversation meant first remembering who you gave it to, which is a fact
 * about Locust's internals rather than about the work. People remember what
 * the work was and roughly when.
 *
 * Measured on a light week — fourteen conversations over four days, four
 * teammates, two rooms — at the default window, sidebar column 268px:
 *
 * | | nested | flat |
 * | --- | --- | --- |
 * | spent before the first conversation | 330px, 47% of the viewport | 0px |
 * | visible without scrolling | 7 of 14 | 14 of 14 |
 * | the title column | 128px | 175px |
 *
 * Two thirds of that 330px was per-teammate metadata repeated four times,
 * and the expensive line in it was the route — `OpenCode / Muse Spark 1.3 …`
 * truncated in every row, for a fact the composer chip already states about
 * the conversation you are actually in. It belongs on the roster, where
 * comparing models is the task.
 *
 * Ownership is untouched by any of this. It stops being the AXIS, not the
 * data: every row still knows its teammate and draws their face, and nothing
 * is migrated.
 */

import type { PublicRoom } from '../../shared/ipc.js'
import type { SidebarMission } from './components/Sidebar.js'

/**
 * Live first, then newest first.
 *
 * The live conversation outranks a more recent timestamp because it is the
 * one changing while you look at it. A row with no timestamp sorts LAST
 * rather than first — an unknown age must not outrank a known recent one,
 * which is what `0` would do if it were read as "the epoch".
 *
 * Shared with the rail's flyout rather than written twice: the rail lists the
 * same conversations in a narrower place, and two orderings that are meant to
 * agree are two orderings that will not.
 */
export function byLiveThenRecent(a: SidebarMission, b: SidebarMission): number {
  const liveA = a.phase === 'running' ? 1 : 0
  const liveB = b.phase === 'running' ? 1 : 0
  if (liveA !== liveB) return liveB - liveA
  const atA = a.lastAt === undefined ? 0 : Date.parse(a.lastAt)
  const atB = b.lastAt === undefined ? 0 : Date.parse(b.lastAt)
  return (Number.isNaN(atB) ? 0 : atB) - (Number.isNaN(atA) ? 0 : atA)
}

/**
 * Every conversation in this folder, in the order the sidebar draws them.
 *
 * No cap. The rail's flyout takes six because a popover that scrolls through
 * everything is the full sidebar again; the sidebar IS the full sidebar, and
 * a list that stopped at six would be hiding work behind nothing.
 */
export function conversationRows(missions: readonly SidebarMission[]): readonly SidebarMission[] {
  return [...missions].sort(byLiveThenRecent)
}

/**
 * Who a conversation belongs to, or nobody.
 *
 * `ownerId` is what the shell knows about a run that is still starting and
 * has no missionId to look up yet; `missionOwners` is the host's record.
 * Asking only one of them is how a conversation came to appear in two
 * different places depending on which had answered first.
 */
export function ownerOf(
  mission: SidebarMission,
  missionOwners: Readonly<Record<string, string>>
): string | undefined {
  return mission.ownerId ?? missionOwners[mission.missionId]
}

/**
 * Every id this row has ever been keyed by, newest identity first.
 *
 * A conversation is a chain of turns, and which id the app uses for it
 * depends on WHEN you ask. A live run does not always know its earlier turns,
 * so its row is keyed by the turn itself; once the ledger is re-read, the
 * same conversation is keyed by its ROOT. Anything saved against the first
 * key is then looked up under the second and found missing.
 *
 * Colin, 2026-09-16: "ive named a conversation 'code' and moved it to a group
 * named locust twice and it keeps disappearing" -- then, exactly: "it
 * actually didnt disappear it just renamed itself and left the group."
 *
 * Both symptoms, one cause. His ledger has it in the open:
 * `mission_77ef58ad` carries `continuesFrom`, so it is a follow-up turn, and
 * both his chosen name and his group membership were stored against it while
 * the row later keyed by the root.
 *
 * So a lookup asks for all of them. Writing still uses the root when it is
 * known -- that is the stable identity -- and reading tolerates whichever id
 * was current when the person acted.
 */
export function conversationKeys(mission: SidebarMission): readonly string[] {
  const keys = [mission.rootId, mission.missionId, ...(mission.memberIds ?? [])]
  return [...new Set(keys.filter((key): key is string => key !== undefined))]
}

/**
 * The sentence above a narrowed list: what narrowed it, and the count.
 *
 * `of` is the pile the person is standing in. With a face on, that is the
 * teammate's conversations, not the folder's -- Grok, pass 5 on 0.154.0:
 * Atlas's face and "invoice" typed said `Atlas · "invoice" — 1 of 20` next
 * to a list of one, which reads as the unfiltered world when the person had
 * already chosen Atlas. The brief's sentence was `1 of 5` because five is
 * Atlas's. Search alone keeps the whole list as its `of`.
 */
export function narrowingLine(input: {
  readonly faceName: string | undefined
  readonly query: string
  readonly shown: number
  readonly inFace: number
  readonly all: number
}): string | undefined {
  const narrowedBy: string[] = []
  if (input.faceName !== undefined) narrowedBy.push(input.faceName)
  const query = input.query.trim()
  if (query.length > 0) narrowedBy.push(`"${query}"`)
  if (narrowedBy.length === 0) return undefined
  const of = input.faceName === undefined ? input.all : input.inFace
  return `${narrowedBy.join(' · ')} — ${String(input.shown)} of ${String(of)}`
}

/** The order the sidebar names them in, which is the order they sit in. */
const STORE_ORDER = ['teammates', 'groups', 'rooms', 'routines'] as const

/**
 * One sentence for every local file that exists and would not read.
 *
 * Each store tells unreadable apart from empty; the host relays it; and the
 * sidebar used to drop every one of those answers on the floor, so a roster
 * file with a torn byte looked like a fresh install. Names the files, says
 * nothing is lost, and says the one thing that makes it true: nothing is
 * written over them until they read again.
 */
export function unreadableSentence(stores: readonly string[]): { readonly happened: string; readonly safe: string } | undefined {
  const named = STORE_ORDER.filter((store) => stores.includes(store))
  if (named.length === 0) return undefined
  const list = named.length === 1 ? named[0] : `${named.slice(0, -1).join(', ')} and ${named[named.length - 1]}`
  const subject = list.charAt(0).toUpperCase() + list.slice(1)
  /*
   * Two facts, two registers (design agent, 2026-09-16): what happened at
   * body weight, what is safe in mono underneath. "Nothing is lost:" came
   * out because the sentence after it IS the reassurance -- the colon was
   * announcing it -- and "the groups file" became "the file", since the
   * first line just named it.
   */
  return named.length === 1
    ? { happened: `${subject} could not be read — everything is listed ungrouped.`, safe: 'Nothing is saved over the file until it reads again.' }
    : { happened: `${subject} could not be read.`, safe: 'Nothing is saved over them until they read again.' }
}

/**
 * The routine that started a run, when a routine did -- from a live run's
 * starter or a recorded mission's, which name it the same way.
 */
export function routineOf(startedBy: { readonly kind: string; readonly routineId?: string } | undefined): string | undefined {
  return startedBy?.kind === 'routine' ? startedBy.routineId : undefined
}

/** The first value stored against any id this conversation has worn. */
export function heldFor<T>(mission: SidebarMission, byKey: Readonly<Record<string, T>>): T | undefined {
  for (const key of conversationKeys(mission)) {
    const held = byKey[key]
    if (held !== undefined) return held
  }
  return undefined
}

/** A row of the list: a conversation, or a room standing for its answers. */
export type ListEntry =
  | { readonly kind: 'conversation'; readonly mission: SidebarMission }
  | { readonly kind: 'room'; readonly room: PublicRoom; readonly missions: readonly SidebarMission[] }

/**
 * The list with each room drawn as the room: one row, where its newest answer
 * was, in place of the answers themselves.
 *
 * A post to a room starts one conversation per teammate, each titled with the
 * post, and the ordinary sidebar has no Rooms section -- that is the compact
 * one's. So after leaving a room called "Release" the sidebar had no row for
 * it, and two identical rows reading "In one sentence each: what d..." stood
 * in for it; the only way back was the Rooms screen (Yurt's beta report,
 * 2026-09-23, #7). The answers are still one press away, in the room.
 */
export function withRoomsFolded(
  conversations: readonly SidebarMission[],
  rooms: readonly PublicRoom[]
): readonly ListEntry[] {
  const roomOf = new Map<string, PublicRoom>()
  for (const room of rooms) {
    for (const post of room.posts) for (const missionId of Object.values(post.missions)) roomOf.set(missionId, room)
  }
  const entries: ListEntry[] = []
  const placed = new Map<string, number>()
  for (const mission of conversations) {
    const room = (mission.memberIds ?? [mission.missionId]).map((id) => roomOf.get(id)).find((found) => found !== undefined)
    if (room === undefined) {
      entries.push({ kind: 'conversation', mission })
      continue
    }
    const at = placed.get(room.roomId)
    if (at === undefined) {
      placed.set(room.roomId, entries.length)
      entries.push({ kind: 'room', room, missions: [mission] })
      continue
    }
    const held = entries[at]
    if (held?.kind === 'room') entries[at] = { ...held, missions: [...held.missions, mission] }
  }
  /*
   * A ROOM NOBODY HAS POSTED TO YET is a row too, where its making would put it.
   *
   * It had none: a row stood for a room's answers, and an empty room has
   * none, so a room made and left could only be found again on the Rooms
   * screen. Colin, asked whether that was right: "I'll let you choose design
   * choice" -- and a thing you just made should be where you left it. Placed
   * by when it was made among the newest-first rows, never above one that is
   * running. A room with posts whose answers are all in another folder stays
   * that folder's.
   */
  const timeOf = (entry: ListEntry): number =>
    entry.kind === 'conversation'
      ? Date.parse(entry.mission.lastAt ?? '') || 0
      : Math.max(0, ...entry.missions.map((mission) => Date.parse(mission.lastAt ?? '') || 0))
  const running = (entry: ListEntry): boolean =>
    entry.kind === 'conversation' ? entry.mission.phase === 'running' : entry.missions.some((mission) => mission.phase === 'running')
  const empty = rooms.filter((room) => room.posts.length === 0).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
  for (const room of empty) {
    const made = Date.parse(room.createdAt) || 0
    const at = entries.findIndex((entry) => !running(entry) && timeOf(entry) < made)
    const row: ListEntry = { kind: 'room', room, missions: [] }
    if (at < 0) entries.push(row)
    else entries.splice(at, 0, row)
  }
  return entries
}
