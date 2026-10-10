import type { PublicRecoveredMission } from '../../shared/ipc.js'
import type { RunCost } from './cost.js'
import { missionCost, sumCosts } from './cost.js'
import { rootMission } from './missionView.js'

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
  /** Their newest conversations, newest first: each its newest turn, named by its first. */
  readonly recent: readonly {
    readonly missionId: string
    readonly title: string
    readonly phase: PublicRecoveredMission['phase']
    /**
     * Whether its record could be read to the end.
     *
     * Carried because the row draws a phase DOT, and a completed mission whose
     * ledger is incomplete is amber everywhere else in the app. This list had
     * no way to know, so it passed `false` and stayed blue -- one mission, two
     * colours, depending which screen you were on (Grok's finding 4,
     * 2026-09-13).
     */
    readonly hasIntegrityIssues: boolean
    /** When it last changed, so a row can say how long ago it was. */
    readonly at: string
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
    cost: sumCosts(theirs.map((mission) => missionCost(mission))),
    /*
     * One row per CONVERSATION, named as the conversation list names it: by its first turn's words. It was one
     * row per turn, so a three-turn conversation filled the card with its own follow-ups -- "Good, ship it",
     * "Also check the signup ..." -- and no other work (the declutter pass, 0.723).
     */
    recent: (() => {
      const byId = new Map(missions.map((mission) => [mission.missionId, mission]))
      const seen = new Set<string>()
      const rows: TeammateWork['recent'][number][] = []
      for (const mission of theirs) {
        const root = rootMission(mission, byId)
        if (seen.has(root.missionId)) continue
        seen.add(root.missionId)
        rows.push({
          missionId: mission.missionId,
          title: titleOf(root),
          phase: mission.phase,
          hasIntegrityIssues: mission.integrityIssueCount > 0,
          at: mission.lastUpdatedAt
        })
        if (rows.length === RECENT_MISSION_LIMIT) break
      }
      return rows
    })()
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
