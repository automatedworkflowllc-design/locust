import type { MissionRuntimeId } from '@teammate/runtime-adapters'
import type { RecoveredMissionPhase } from '@teammate/mission-store'

import type { CodexMissionStartResponse, CodexMissionUpdate, MissionMode, PublicRoutine, RoutineRunResponse } from '../shared/ipc.js'
import { isDue } from '../shared/routine-schedule.js'
import type { MissionPeerContext } from './workroom-briefing.js'

/**
 * Replays a routine: step 1 starts as a new mission for the teammate, and each
 * later step starts as a follow-up of the same conversation once the step
 * before it COMPLETED. Built the way the relay is built -- the host starts
 * runs through the same service a person's do, each recorded as started by
 * the routine (`startedBy: { kind: 'routine', routineId, step }`), and the
 * thread that is being replayed hears every notice.
 *
 * Nothing skips ahead: a step that failed, was stopped, or was interrupted
 * ends the routine there, and the thread says which step and why. Continuing
 * past a failure would build step 3 on work step 2 never did.
 *
 * A routine with a schedule also starts on its own: the host ticks the
 * runner once a minute and a routine whose next run has passed starts
 * exactly as if the person pressed Run -- same path, same record, same
 * "one routine per teammate at a time". A teammate in the middle of a
 * person's run is skipped and tried on the next tick, never queued behind
 * them; a scheduled start that FAILS is held off for an hour rather than
 * retried every minute against a runtime that is down.
 */

export interface RoutineRunnerOptions {
  readonly routines: {
    get(routineId: unknown): Promise<PublicRoutine | undefined>
    recordRun(routineId: unknown): Promise<void>
    list(): Promise<readonly PublicRoutine[]>
  }
  /** Whether the teammate has a live run of anyone's. A scheduled routine waits for it to end. */
  readonly teammateBusy?: (teammateId: string) => Promise<boolean>
  readonly peerContextFor: (teammateId: string) => Promise<MissionPeerContext | undefined>
  readonly start: (input: {
    readonly prompt: string
    readonly runtime: MissionRuntimeId
    readonly mode: MissionMode
    readonly model: string | undefined
    readonly peer: MissionPeerContext
    readonly followUpOf: string | undefined
    readonly startedBy: { readonly kind: 'routine'; readonly routineId: string; readonly step: number }
  }) => Promise<CodexMissionStartResponse>
  readonly assignOwner: (teammateId: string, missionId: string) => Promise<void>
  /** How a finished mission ended, from the durable record. Undefined when the ledger cannot say. */
  readonly phaseOf: (missionId: string) => Promise<RecoveredMissionPhase | undefined>
  readonly notify: (update: CodexMissionUpdate) => void
}

export interface RoutineProgress {
  readonly routineId: string
  readonly name: string
  readonly teammateId: string
  /** The step now running, counting from 1. */
  readonly step: number
  readonly of: number
  readonly missionId: string
  readonly runId: string
}

export interface RoutineRunner {
  run(routineId: string): Promise<RoutineRunResponse>
  /** Any run ending, however it ended. Only a routine's own current step moves it. */
  onRunEnded(mission: { readonly missionId: string }): Promise<void>
  running(): readonly RoutineProgress[]
  /**
   * Start every scheduled routine whose next run has passed, as of `now`.
   * Returns the ids started. Safe to call every minute: a routine that is
   * running, or whose teammate is busy, or that failed to start within the
   * last hour, is skipped this tick.
   */
  tick(now: Date): Promise<readonly string[]>
}

/** How long a scheduled routine waits after a start that failed before it is tried again. */
export const SCHEDULE_HOLD_OFF_MS = 3_600_000

/** Runtimes the routine runner can start. Antigravity is driven through another service and records no starter. */
const ROUTINE_RUNTIMES: ReadonlySet<string> = new Set(['codex', 'claude', 'cursor', 'opencode', 'copilot'])

function phaseWords(phase: RecoveredMissionPhase | undefined): string {
  switch (phase) {
    case 'failed':
      return 'that run failed'
    case 'cancelled':
      return 'that run was stopped'
    case 'interrupted':
      return 'that run was interrupted'
    case 'completed':
      return 'that run completed'
    default:
      return 'the record of that run could not be read'
  }
}

export function createRoutineRunner(options: RoutineRunnerOptions): RoutineRunner {
  const active = new Map<string, RoutineProgress>()
  /** routineId -> epoch ms before which a scheduled start is not tried again. */
  const heldOff = new Map<string, number>()

  const notice = (progress: RoutineProgress, message: string): void => {
    options.notify({ kind: 'relay-notice', runId: progress.runId, missionId: progress.missionId, message })
  }

  const startStep = async (
    routine: PublicRoutine,
    peer: MissionPeerContext,
    step: number,
    followUpOf: string | undefined
  ): Promise<CodexMissionStartResponse> => {
    const prompt = routine.steps[step - 1]
    if (prompt === undefined) {
      return { ok: false, error: { code: 'RUNTIME_START_FAILED', message: `Routine has no step ${String(step)}.` } }
    }
    return options.start({
      prompt,
      runtime: routine.route.runtime,
      mode: routine.route.mode,
      model: routine.route.model === 'account-default' ? undefined : routine.route.model,
      peer,
      followUpOf,
      startedBy: { kind: 'routine', routineId: routine.routineId, step }
    })
  }

  const announce = (routine: PublicRoutine, peer: MissionPeerContext, step: number, response: CodexMissionStartResponse & { ok: true }): RoutineProgress => {
    const progress: RoutineProgress = {
      routineId: routine.routineId,
      name: routine.name,
      teammateId: peer.self.teammateId,
      step,
      of: routine.steps.length,
      missionId: response.data.missionId,
      runId: response.data.runId
    }
    active.set(routine.routineId, progress)
    options.notify({
      kind: 'mission-started',
      runId: response.data.runId,
      missionId: response.data.missionId,
      teammateId: peer.self.teammateId,
      prompt: routine.steps[step - 1] ?? '',
      data: response.data,
      startedBy: { kind: 'routine', routineId: routine.routineId, step }
    })
    return progress
  }

  return {
    async run(routineId) {
      const routine = await options.routines.get(routineId)
      if (routine === undefined) {
        return { ok: false, error: { code: 'ROUTINE_REJECTED', message: 'That routine no longer exists.' } }
      }
      if (!ROUTINE_RUNTIMES.has(routine.route.runtime)) {
        return {
          ok: false,
          error: { code: 'ROUTINE_REJECTED', message: `Routines cannot run on ${routine.route.runtime} yet.` }
        }
      }
      const already = [...active.values()].find((progress) => progress.teammateId === routine.teammateId)
      if (already !== undefined) {
        return {
          ok: false,
          error: {
            code: 'ROUTINE_REJECTED',
            message: `${already.name} is already running for this teammate (step ${String(already.step)} of ${String(already.of)}). One routine at a time.`
          }
        }
      }
      const peer = await options.peerContextFor(routine.teammateId)
      if (peer === undefined) {
        return { ok: false, error: { code: 'ROUTINE_REJECTED', message: 'The teammate this routine belongs to no longer exists.' } }
      }
      const response = await startStep(routine, peer, 1, undefined)
      if (!response.ok) {
        return { ok: false, error: { code: 'ROUTINE_REJECTED', message: response.error.message } }
      }
      await options.assignOwner(peer.self.teammateId, response.data.missionId).catch(() => undefined)
      const progress = announce(routine, peer, 1, response)
      await options.routines.recordRun(routine.routineId).catch(() => undefined)
      if (routine.steps.length > 1) {
        notice(progress, `Routine "${routine.name}" · step 1 of ${String(routine.steps.length)}. Each next step starts when this one completes.`)
      }
      return { ok: true, data: { missionId: response.data.missionId, runId: response.data.runId } }
    },

    async onRunEnded(mission) {
      const progress = [...active.values()].find((held) => held.missionId === mission.missionId)
      if (progress === undefined) return
      const phase = await options.phaseOf(mission.missionId).catch(() => undefined)
      if (phase !== 'completed') {
        active.delete(progress.routineId)
        notice(progress, `Routine "${progress.name}" stopped at step ${String(progress.step)} of ${String(progress.of)}: ${phaseWords(phase)}.`)
        return
      }
      if (progress.step >= progress.of) {
        active.delete(progress.routineId)
        notice(progress, `Routine "${progress.name}" finished: ${String(progress.of)} step${progress.of === 1 ? '' : 's'} completed.`)
        return
      }
      // The routine may have been edited or removed while it ran; the steps
      // that run are the ones on file NOW, so a correction lands next time.
      const routine = await options.routines.get(progress.routineId)
      const peer = routine === undefined ? undefined : await options.peerContextFor(routine.teammateId)
      if (routine === undefined || peer === undefined || progress.step >= routine.steps.length) {
        active.delete(progress.routineId)
        notice(progress, `Routine "${progress.name}" stopped after step ${String(progress.step)}: the routine changed while it was running.`)
        return
      }
      const next = progress.step + 1
      const response = await startStep(routine, peer, next, mission.missionId)
      if (!response.ok) {
        active.delete(progress.routineId)
        notice(progress, `Routine "${progress.name}" stopped before step ${String(next)} of ${String(routine.steps.length)}: ${response.error.message}`)
        return
      }
      await options.assignOwner(peer.self.teammateId, response.data.missionId).catch(() => undefined)
      const started = announce(routine, peer, next, response)
      notice(started, `Routine "${routine.name}" · step ${String(next)} of ${String(routine.steps.length)}.`)
    },

    running() {
      return [...active.values()]
    },

    async tick(now) {
      const started: string[] = []
      const all = await options.routines.list().catch(() => [] as readonly PublicRoutine[])
      for (const routine of all) {
        if (routine.schedule === undefined) continue
        if (!isDue(routine.schedule, routine.lastRunAt ?? routine.createdAt, now)) continue
        const until = heldOff.get(routine.routineId)
        if (until !== undefined && until > now.getTime()) continue
        heldOff.delete(routine.routineId)
        // Busy is a wait, not a failure: tried again next tick, no hold-off.
        if ([...active.values()].some((progress) => progress.teammateId === routine.teammateId)) continue
        if (options.teammateBusy !== undefined && (await options.teammateBusy(routine.teammateId).catch(() => true))) continue
        const response = await this.run(routine.routineId)
        if (response.ok) {
          started.push(routine.routineId)
        } else {
          const retryAt = now.getTime() + SCHEDULE_HOLD_OFF_MS
          heldOff.set(routine.routineId, retryAt)
          // Said, not just recorded. A scheduled routine is the one kind of
          // run nobody is watching start, so a refusal nobody is told about
          // is a routine that has quietly stopped happening.
          options.notify({
            kind: 'routine-blocked',
            routineId: routine.routineId,
            name: routine.name,
            message: response.error.message,
            retryAt: new Date(retryAt).toISOString()
          })
        }
      }
      return started
    }
  }
}
