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
