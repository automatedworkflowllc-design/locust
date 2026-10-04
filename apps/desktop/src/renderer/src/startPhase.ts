import type { CodexMissionUpdate, StartPhase } from '../../shared/ipc.js'
import { isMissionRuntime, runtimeDisplayName } from '../../shared/runtimes.js'
import { startPhaseLabel } from '../../shared/start-phase.js'

/** The part of a live run this needs: whether it is still starting, for whom, on what. */
export interface StartingRun {
  readonly phase: string
  readonly runtime?: string
  readonly teammateId?: string
  readonly startPhase?: StartPhase
}

/**
 * The run a start-phase update belongs to (0.602). A start-phase arrives
 * BEFORE the start's response, so the window's run has no id yet and the
 * update cannot be routed by one: it is the run still "starting" for that
 * teammate, or, for a start with no teammate, the one still starting on that
 * runtime. Nothing matching leaves the map as it was.
 */
export function withStartPhase<T extends StartingRun>(runs: ReadonlyMap<string, T>, update: CodexMissionUpdate): ReadonlyMap<string, T> {
  if (update.kind !== 'start-phase') return runs
  const found = [...runs.entries()].find(([, run]) =>
    run.phase === 'starting'
    && (update.teammateId === undefined ? run.teammateId === undefined && run.runtime === update.runtime : run.teammateId === update.teammateId)
  )
  if (found === undefined) return runs
  const [key, run] = found
  if (run.startPhase === update.phase) return runs
  const next = new Map(runs)
  next.set(key, { ...run, startPhase: update.phase })
  return next
}

/**
 * The start's last phase, carried onto the run the start's response makes.
 *
 * The response comes back the moment the program is launched -- 148 ms
 * after Send in the dev drive of 2026-10-04 -- and the runtime's first word
 * came 14 s later. The window rebuilds the run from the entry it made at
 * Send, which knows no phase, so the line fell back to a bare "Starting…"
 * for all of that wait. The phase is still the truth until the runtime
 * speaks; the thread builder drops it the moment it does.
 */
export function carriedStartPhase(run: { readonly startPhase?: StartPhase } | undefined): { readonly startPhase?: StartPhase } {
  return run?.startPhase === undefined ? {} : { startPhase: run.startPhase }
}

/** The option the thread builder takes for the live line while nothing has arrived yet. */
export function startingLabelOf(run: { readonly startPhase?: StartPhase; readonly runtime?: string }): { readonly startingLabel?: string } {
  if (run.startPhase === undefined || run.runtime === undefined || !isMissionRuntime(run.runtime)) return {}
  return { startingLabel: startPhaseLabel(run.startPhase, runtimeDisplayName(run.runtime)) }
}
