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

/** The first value stored against any id this conversation has worn. */
export function heldFor<T>(mission: SidebarMission, byKey: Readonly<Record<string, T>>): T | undefined {
  for (const key of conversationKeys(mission)) {
    const held = byKey[key]
    if (held !== undefined) return held
  }
  return undefined
}
