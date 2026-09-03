import type { PublicRecoveredMission } from '../../shared/ipc.js'
import type { RunCost } from './cost.js'
import { runCostOf, sumCosts } from './cost.js'

/**
 * What a teammate has actually done, for their card to say.
 *
 * The roster showed a route, a mission count, and a mode -- enough to know a
 * teammate exists, not enough to know how they have been used. Everything
 * here is read from the missions already recovered for the Missions screen,
 * so a card cannot claim work the ledger does not hold.
 */
export interface TeammateWork {
  readonly missionCount: number
  /** When they last finished something, ISO, or undefined if never. */
  readonly lastRunAt: string | undefined
  /** What their work has cost, in whatever units the runtimes reported. */
  readonly cost: RunCost | undefined
  /** Their newest missions, newest first. */
  readonly recent: readonly {
    readonly missionId: string
    readonly title: string
    readonly phase: PublicRecoveredMission['phase']
  }[]
}

/** How many recent missions a card lists before it is a list rather than a card. */
export const RECENT_MISSION_LIMIT = 3

/**
 * Their missions, newest first. Ownership comes from the host's own record of
 * who a mission belongs to; a mission nobody owns belongs on nobody's card.
 */
export function teammateWork(
  teammateId: string,
  missions: readonly PublicRecoveredMission[],
  missionOwners: Readonly<Record<string, string>>,
  titleOf: (mission: PublicRecoveredMission) => string = (mission) => mission.prompt
): TeammateWork {
  const theirs = missions
    .filter((mission) => missionOwners[mission.missionId] === teammateId)
    .slice()
    .sort((left, right) => Date.parse(right.lastUpdatedAt) - Date.parse(left.lastUpdatedAt))

  return {
    missionCount: theirs.length,
    lastRunAt: theirs[0]?.lastUpdatedAt,
    // Undefined, not zero: a runtime that reported no usage has not told us
    // the work was free, and a card must not say it was.
    cost: sumCosts(theirs.map((mission) => runCostOf(mission.events))),
    recent: theirs.slice(0, RECENT_MISSION_LIMIT).map((mission) => ({
      missionId: mission.missionId,
      title: titleOf(mission),
      phase: mission.phase
    }))
  }
}

/**
 * `4 minutes ago`, `3 days ago`, and so on -- what a person wants from "when
 * did this teammate last work", where the exact clock time is noise.
 */
export function agoLabel(iso: string, now: Date = new Date()): string | undefined {
  const at = Date.parse(iso)
  if (Number.isNaN(at)) return undefined
  const seconds = Math.floor((now.getTime() - at) / 1000)
  if (seconds < 0) return 'just now'
  if (seconds < 60) return 'just now'
  const units: readonly (readonly [number, string])[] = [
    [60, 'minute'],
    [3_600, 'hour'],
    [86_400, 'day'],
    [604_800, 'week']
  ]
  let label = `${String(Math.floor(seconds / 604_800))} weeks ago`
  for (let index = units.length - 1; index >= 0; index -= 1) {
    const [size, name] = units[index]!
    const count = Math.floor(seconds / size)
    if (count >= 1) {
      label = `${String(count)} ${name}${count === 1 ? '' : 's'} ago`
      break
    }
  }
  return label
}
