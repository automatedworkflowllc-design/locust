import type { TeammateStatusView } from './status.js'

/**
 * THE TEAM, AS A BOARD (0.380).
 *
 * The Team screen was a roster -- route, mode, how many missions -- built for
 * setting teammates up. Nothing on it said who was working, who was waiting
 * on you, or who had just finished. Orca's dashboard answers that with
 * columns, "Needs You / Working / Done / Idle", where "tint means look here"
 * (read 2026-09-26). Locust's version keeps the cards and their faces --
 * which already act out what they are doing (faceState.ts) -- and groups
 * them by what they need from the person, most urgent first:
 *
 *   Needs you      waiting on an approval or a question, or unable to run
 *   Working        a run is live
 *   Just finished  a run ended that the person has not looked at since
 *   Ready          everyone else
 *
 * A team with nobody in the first three is shown as it always was: one
 * grid, no headings -- a quiet team is not a board of empty columns.
 */

export type BoardSectionKey = 'needs-you' | 'working' | 'finished' | 'ready'

export interface BoardSection<T> {
  readonly key: BoardSectionKey
  readonly title: string
  readonly members: readonly T[]
}

const TITLES: Readonly<Record<BoardSectionKey, string>> = {
  'needs-you': 'Needs you',
  working: 'Working',
  finished: 'Just finished',
  ready: 'Ready'
}

/** Where one teammate sits. An unseen finish outranks idle, never a live run or a wait. */
export function boardSectionOf(view: TeammateStatusView | undefined, finishedUnseen: boolean): BoardSectionKey {
  if (view?.status === 'approval-needed' || view?.status === 'blocked') return 'needs-you'
  if (view?.status === 'working') return 'working'
  return finishedUnseen ? 'finished' : 'ready'
}

/**
 * The board, in order, with empty sections left out -- or undefined when
 * everyone is ready, which the screen draws as its plain grid.
 */
export function teamBoard<T extends { readonly teammateId: string }>(
  teammates: readonly T[],
  viewByTeammate: Readonly<Record<string, TeammateStatusView>>,
  finishedUnseen: ReadonlySet<string>
): readonly BoardSection<T>[] | undefined {
  const order: readonly BoardSectionKey[] = ['needs-you', 'working', 'finished', 'ready']
  const sections = order.map((key) => ({
    key,
    title: TITLES[key],
    members: teammates.filter((teammate) => boardSectionOf(viewByTeammate[teammate.teammateId], finishedUnseen.has(teammate.teammateId)) === key)
  }))
  if (sections.every((section) => section.key === 'ready' || section.members.length === 0)) return undefined
  return sections.filter((section) => section.members.length > 0)
}
