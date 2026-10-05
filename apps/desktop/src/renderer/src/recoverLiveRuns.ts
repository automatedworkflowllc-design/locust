import type { PublicRecoveredMission } from '../../shared/ipc.js'

interface RecoverableRun {
  readonly phase: string
  readonly restored?: boolean
  readonly error?: string
  readonly restoredMission?: PublicRecoveredMission
}

/** Restore every process the host still owns, including silent comparison columns.
 * A queued update also proves ownership and is replayed, including a terminal
 * receipt that raced the history read. Existing runs always win that race.
 */
export function recoverLiveRuns<TRun extends RecoverableRun, TUpdate>(
  held: ReadonlyMap<string, TRun>,
  missions: readonly PublicRecoveredMission[],
  liveMissionIds: readonly string[],
  pending: ReadonlyMap<string, readonly TUpdate[]>,
  restore: (mission: PublicRecoveredMission) => TRun,
  apply: (run: TRun, update: TUpdate) => TRun
): ReadonlyMap<string, TRun> {
  const live = new Set(liveMissionIds)
  let next: Map<string, TRun> | undefined
  for (const mission of missions) {
    if (held.has(mission.runId)) continue
    const queued = pending.get(mission.runId) ?? []
    if (!live.has(mission.missionId) && queued.length === 0) continue
    let run = restore(mission)
    if (live.has(mission.missionId) && mission.phase === 'interrupted') {
      const { error: _error, restoredMission: _mission, ...rest } = run
      run = { ...rest, phase: 'running', restored: false } as TRun
    }
    for (const update of queued) run = apply(run, update)
    next ??= new Map(held)
    next.set(mission.runId, run)
  }
  return next ?? held
}
