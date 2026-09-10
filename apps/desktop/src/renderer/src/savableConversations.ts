/**
 * The finished conversations an empty Routines screen offers to save.
 *
 * The design agent's rule, 2026-09-10: *a feature needs an entrance where its
 * material is, and an entrance where its absence is felt -- and the second
 * must CONTAIN the first, not describe it.*
 *
 * The empty screen used to name the gesture in prose: finish a conversation,
 * right-click it under its teammate, choose Save as routine. That was the
 * right floor -- the row has no visible affordance, so saying so out loud beat
 * saying nothing -- but it is the app describing a gesture instead of offering
 * one. Colin had read that screen and still said "i still have not seen that
 * ability pop up for me".
 *
 * So the screen lists the material: the most recent finished conversations,
 * with Save on each. Nothing is invented -- these are the same rows the
 * sidebar draws, filtered and sorted -- and Save opens the RoutineDialog that
 * already exists.
 *
 * There is deliberately no "New routine": a routine cannot be made from
 * nothing, and a blank form would be a lie about what it is.
 */

/** How many to offer. Four fills the space the prose left without scrolling. */
export const SAVABLE_SHOWN = 4

/** The parts of a sidebar mission this picker needs. Structural on purpose. */
export interface SavableConversation {
  readonly missionId: string
  readonly title: string
  readonly phase: string
  /** Turns in the conversation; absent means one. */
  readonly turns?: number
  /** When it last moved, which is what "most recent" means here. */
  readonly lastAt?: string
}

/**
 * The newest finished conversations, newest first.
 *
 * `completed` only. A failed or cancelled run is not turns worth repeating,
 * and offering to save one would be the screen recommending it -- the same
 * rule that keeps the header button off those missions.
 *
 * A conversation with no `lastAt` still counts: it sorts last rather than
 * disappearing, because a row that exists and cannot be saved is a smaller
 * problem than a row that silently is not there.
 */
export function savableConversations(
  missions: readonly SavableConversation[],
  limit: number = SAVABLE_SHOWN
): readonly SavableConversation[] {
  const at = (mission: SavableConversation): number => {
    const parsed = mission.lastAt === undefined ? Number.NaN : Date.parse(mission.lastAt)
    return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed
  }
  return [...missions]
    .filter((mission) => mission.phase === 'completed')
    .sort((first, second) => at(second) - at(first))
    .slice(0, Math.max(0, limit))
}

/** `4 turns`, and `1 turn` rather than `1 turns`. */
export function turnsLabel(turns: number | undefined): string {
  const count = turns === undefined || turns < 1 ? 1 : turns
  return `${String(count)} turn${count === 1 ? '' : 's'}`
}

/**
 * The line under the title when there is nothing to offer.
 *
 * A brand-new workspace has no finished conversations either, and only then
 * is the old sentence's job gone: there is no gesture to name because there
 * is nothing to name it about.
 */
export const NOTHING_TO_SAVE_YET = 'Finish a conversation and it can be saved here as a routine.'

/**
 * Whether the conversation on screen may be saved as a routine right now.
 *
 * The header button is ABSENT rather than disabled when it is not, which is
 * the same rule the effort switch follows: there is nothing to explain about
 * an action with no material. The right-click menu still says WHY, because a
 * menu the person deliberately opened is a place an explanation belongs.
 *
 * `completed` only. A failed or cancelled run is not turns worth repeating,
 * and a conversation whose turns were all written by the host has none of the
 * person's words in it to replay.
 */
export function savableMissionId(shown: {
  readonly missionId: string | undefined
  readonly phase: string | undefined
  readonly running: boolean
  /** Whether there are steps to replay -- the same check the menu makes. */
  readonly hasDraft: boolean
}): string | undefined {
  if (shown.missionId === undefined || shown.missionId.startsWith('pending:')) return undefined
  if (shown.running || shown.phase !== 'completed' || !shown.hasDraft) return undefined
  return shown.missionId
}
