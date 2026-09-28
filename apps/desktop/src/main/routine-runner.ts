import type { MissionRuntimeId } from '@teammate/runtime-adapters'
import type { RecoveredMissionPhase } from '@teammate/mission-store'

import type { CodexMissionStartResponse, CodexMissionUpdate, MissionMode, PublicRoutine, RoutineHandOff, RoutineRunResponse, TeammateRoute } from '../shared/ipc.js'
import { handOffPrompt, verdictOf } from '../shared/hand-off.js'
import { isDue } from '../shared/routine-schedule.js'
import type { MissionPeerContext } from './workroom-briefing.js'
import { randomUUID } from 'node:crypto'
import type { RoutineExecution, RoutineRecoveryRequest, RoutineRecoveryResponse } from '../shared/routine-recovery.js'
import type { RoutineStore } from './routine-store.js'
import { hostReadsEventsOf } from '../shared/runtimes.js'
import { stepTooLongNotice } from '../shared/step-budget.js'

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
  readonly workspaceId: string
  /**
   * The folder a routine was made in: its own record, or for one saved
   * before that was recorded, the folder of the mission it was learned
   * from. Undefined when neither says; such a routine runs as before (M15).
   */
  readonly homeOf?: (routine: PublicRoutine) => Promise<string | undefined>
  readonly routines: Pick<RoutineStore, 'get' | 'list' | 'recordRun' | 'saveProgress' | 'clearProgress' | 'abandon' | 'keepSchedule'>
  /** Whether the teammate has a live run of anyone's. A scheduled routine waits for it to end. */
  readonly teammateBusy?: (teammateId: string) => Promise<boolean>
  readonly peerContextFor: (teammateId: string) => Promise<MissionPeerContext | undefined>
  readonly start: (input: {
    readonly prompt: string
    readonly runtime: MissionRuntimeId
    readonly mode: MissionMode
    readonly model: string | undefined
    /** The level the routine was taught with; absent where the route reports none. */
    readonly effort: string | undefined
    readonly peer: MissionPeerContext
    readonly followUpOf: string | undefined
    readonly startedBy: { readonly kind: 'routine'; readonly routineId: string; readonly step: number }
  }) => Promise<CodexMissionStartResponse>
  readonly assignOwner: (teammateId: string, missionId: string) => Promise<void>
  /** How a finished mission ended, from the durable record. Undefined when the ledger cannot say. */
  readonly phaseOf: (missionId: string) => Promise<RecoveredMissionPhase | undefined>
  /**
   * Whether that mission is still RUNNING somewhere in this process.
   *
   * The ledger cannot answer it. `phaseFor` reads the events and returns
   * `interrupted` when it finds no terminal one -- which is exactly what a
   * mission that has not finished yet looks like. So "still going" and
   * "abandoned mid-flight" are the same record, and only the live set can
   * tell them apart.
   */
  readonly isLive?: (missionId: string) => boolean
  /**
   * Whether that turn ended by ASKING the person something.
   *
   * A turn that ends on a decision block completes perfectly normally -- exit
   * 0, a receipt, phase 'completed' -- so the runner read it as success and
   * started the next step. The person's answer then arrived at a teammate
   * already working on step 2 and was refused as RUN_ALREADY_ACTIVE, so the
   * routine carried on without the answer it had asked for. Verified
   * 2026-09-08 from a report by a Cursor teammate reading this source.
   *
   * Absent, or a read that fails, means "cannot tell" and now holds for review.
   * Counting an unreadable answer as completion would bypass recovery policy.
   */
  readonly askedAQuestion?: (missionId: string) => Promise<boolean>
  /** A teammate's route now, for a step handed to them (0.435). Absent: only the routine's own teammate can take a step. */
  readonly routeOf?: (teammateId: string) => Promise<TeammateRoute | undefined>
  /** A finished step's answer, for the teammate the next step goes to and for a checker's verdict (0.435). */
  readonly replyOf?: (missionId: string) => Promise<string | undefined>
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
  reconcile(): Promise<void>
  recover(request: RoutineRecoveryRequest): Promise<RoutineRecoveryResponse>
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

/**
 * Whether a refused start means "no room right now" rather than "this is
 * broken". Matched on the host's own sentence, which names the cap.
 */
function isAtCapacity(message: string): boolean {
  return /missions can run at once/i.test(message)
}

/** How long a scheduled routine waits after a start that failed before it is tried again. */
export const SCHEDULE_HOLD_OFF_MS = 3_600_000

/**
 * Runtimes the routine runner can start: the ones whose events this host
 * reads through a process it owns. Antigravity is excluded by that same
 * rule, which is the right reason -- it is driven through another service
 * and records no starter.
 *
 * ASKED, NOT LISTED. This was a hand-written set of five ids, and a set
 * like that is how Muse Code came to be pickable in the composer and
 * refused by the mission ledger on the same build. A routine would have
 * been refused here with "Routines cannot run on muse yet", which is a
 * sentence about a list nobody had updated rather than about the runtime.
 */
const canStartRoutine = (runtime: MissionRuntimeId): boolean => hostReadsEventsOf(runtime)

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

/** Who takes a step of a hand-off chain (0.435): its named teammate, or the routine's own. */
const ownerOf = (routine: { readonly teammateId: string; readonly handOffs?: readonly RoutineHandOff[] }, step: number): string =>
  routine.handOffs?.[step - 1]?.teammateId ?? routine.teammateId
/** What a step's notice adds when it was handed on (0.435): who has it, with whose answer, and whether they check. */
const handedTo = (to: string, from: string | undefined, check: boolean): string =>
  from === undefined
    ? check ? `, ${to} checks it` : ''
    : check ? `, handed to ${to} with ${from}'s answer to check` : `, handed to ${to} with ${from}'s answer`

/** Whether that step is the checker, whose approval the run needs. */
const checks = (routine: { readonly handOffs?: readonly RoutineHandOff[] }, step: number): boolean =>
  routine.handOffs?.[step - 1]?.check === true

export function createRoutineRunner(options: RoutineRunnerOptions): RoutineRunner {
  const active = new Map<string, RoutineProgress>()
  /** routineId -> epoch ms before which a scheduled start is not tried again. */
  const heldOff = new Map<string, number>()
  const changed = (): void => options.notify({ kind: 'routine-recovery-changed' })

  const hold = async (
    routine: PublicRoutine,
    execution: RoutineExecution,
    reason: string,
    canContinue = false,
    settledAtDispatch = false
  ): Promise<void> => {
    if (execution.status === 'held' && execution.reason === reason && execution.canContinue === canContinue) return
    await options.routines.saveProgress(
      routine.routineId,
      { ...execution, status: 'held', reason, canContinue, ...(settledAtDispatch ? { settledAtDispatch: true } : {}) },
      execution.attemptId
    )
    active.delete(routine.routineId)
    changed()
  }

  const nameOf = async (teammateId: string): Promise<string | undefined> =>
    (await options.peerContextFor(teammateId).catch(() => undefined))?.self.name

  /**
   * Whether a CHECKER step's answer approves (0.435). Anything but a clear
   * approval -- changes asked for, no verdict, an answer that cannot be read
   * -- is not one, and says which.
   */
  const checkerSaid = async (missionId: string, teammateId: string): Promise<{ readonly approved: boolean; readonly why: string }> => {
    const verdict = verdictOf(await options.replyOf?.(missionId).catch(() => undefined))
    const name = (await nameOf(teammateId)) ?? 'The checker'
    if (verdict?.approved === true) return { approved: true, why: `approved by ${name}` }
    return {
      approved: false,
      why: verdict === undefined
        ? `${name}, the checker, gave no verdict`
        : `${name}, the checker, asked for changes${verdict.changes.length > 0 ? `: ${verdict.changes}` : ''}`
    }
  }

  const complete = async (routineId: string, execution: RoutineExecution): Promise<void> => {
    await options.routines.recordRun(routineId, execution.attemptId)
    active.delete(routineId)
    changed()
  }

  // Policy (c): ask. A separate runtime can outlive Electron, and a missing
  // receipt is not proof of no side effects. The cost is unattended routines
  // waiting indefinitely for review, so the hold is persisted on their cards.
  // Reconciliation is retried independently of lastRunAt, never the dispatch.
  const reconcile = async (): Promise<void> => {
    for (const routine of await options.routines.list()) {
      const execution = routine.execution
      if (execution === undefined || execution.status === 'abandoned' || active.has(routine.routineId)) continue
      /*
       * A refusal the dispatch already explained is not re-decided.
       *
       * Without this, every reconcile overwrote a precise reason with the
       * generic one below, because there is no mission to ask about -- so
       * the card blamed a restart for a route the runtime had refused
       * outright, and told the person to review external work that never
       * ran. See `settledAtDispatch`.
       */
      if (execution.status === 'held' && execution.settledAtDispatch === true) continue
      if (execution.workspaceId !== options.workspaceId) {
        await hold(routine, execution, 'Open the original workspace to reconcile this attempt. Nothing will be replayed.')
        continue
      }
      /*
       * A mission that is STILL RUNNING is not a mission to review.
       *
       * `phaseFor` returns `interrupted` for any mission with no terminal
       * event, and a run that is a second from finishing has none -- so
       * reconciling during that window held the routine with "Review
       * required: that run was interrupted", and nothing re-checked it. The
       * routine then sat at "waiting for review, 0 completed runs" forever,
       * with both its steps done. Measured 2026-09-11: the same routine
       * passed and failed on an unchanged build depending on whether the
       * terminal event landed first.
       */
      if (execution.missionId !== undefined && options.isLive?.(execution.missionId) === true) continue
      const phase = execution.missionId === undefined ? undefined : await options.phaseOf(execution.missionId).catch(() => undefined)
      const question = execution.missionId === undefined || options.askedAQuestion === undefined
        ? true : await options.askedAQuestion(execution.missionId).catch(() => true)
      const confirmed = phase === 'completed' && !question
      // A checker that finished while the app was closed is read like one
      // that finished while it was open: only an approval lets it count (0.435).
      const verdict = confirmed && execution.missionId !== undefined && checks(execution, execution.step)
        ? await checkerSaid(execution.missionId, ownerOf({ teammateId: routine.teammateId, ...(execution.handOffs === undefined ? {} : { handOffs: execution.handOffs }) }, execution.step))
        : undefined
      if (verdict !== undefined && !verdict.approved) {
        await hold(routine, execution, `${verdict.why}. The run does not count as done. Review the work, then run the routine again.`, false, true)
      } else if (confirmed && execution.step === execution.of) {
        await complete(routine.routineId, execution)
      } else {
        await hold(routine, execution, confirmed
          ? 'The saved step completed. Review the remaining steps before continuing.'
          : execution.missionId === undefined
            ? 'Dispatch outcome is uncertain: the app stopped before saving a mission receipt. Review external work; nothing will be replayed.'
            : `Review required: ${phaseWords(phase)}${question && phase === 'completed' ? ', but it asked a question or its answer could not be checked' : ''}. Nothing will be replayed.`, confirmed)
      }
    }
  }

  const notice = (progress: RoutineProgress, message: string): void => {
    options.notify({ kind: 'relay-notice', runId: progress.runId, missionId: progress.missionId, message })
  }

  const startStep = async (
    routine: PublicRoutine,
    peer: MissionPeerContext,
    step: number,
    followUpOf: string | undefined,
    /** The step before, when this one goes to another teammate or checks it (0.435). */
    handedFrom?: { readonly missionId: string; readonly name: string }
  ): Promise<CodexMissionStartResponse> => {
    const prompt = routine.steps[step - 1]
    if (prompt === undefined) {
      return { ok: false, error: { code: 'RUNTIME_START_FAILED', message: `Routine has no step ${String(step)}.` } }
    }
    /*
     * A STEP TOO LONG TO SEND IS REFUSED HERE, BEFORE ANYTHING IS RECORDED
     * (A5.1).
     *
     * It used to be written down as dispatching, handed to the mission
     * service, refused there ("Enter a mission between 1 and 8,000
     * characters."), and -- from step 2 on -- held as "Dispatch not confirmed
     * ... Review external work before proceeding": a person sent to check
     * for side effects of a step that provably never started. A routine
     * saved before 0.316 can still hold one (the store reads 20,000 and
     * saves 8,000), so the check stays here too.
     */
    const tooLong = stepTooLongNotice(prompt)
    if (tooLong !== undefined) {
      const message = `Step ${String(step)} is too long to send: ${tooLong} Shorten it in Edit, then run the routine again. Nothing was started.`
      const prior = routine.execution
      // Settled at dispatch: the reason is exact, and a later reconcile must
      // not trade it for "The saved step completed ... Continue", which would
      // only run into the same refusal (the 0.316 drive caught exactly that).
      if (step > 1 && prior !== undefined && prior.status !== 'abandoned') await hold(routine, prior, message, false, true)
      return { ok: false, error: { code: 'INVALID_PROMPT', message } }
    }
    /*
     * Approve-each replays now, and draws its cards.
     *
     * This used to refuse. The cards existed only on a second mission service
     * that the composer's own start reached and nothing else did; everything
     * here went through exec, where the mode fell through to `read-only`, so
     * a routine on a teammate saved to "approve each action" ran with no
     * cards and no writes and said neither. Refusing was the honest answer to
     * that. Since every Codex mode runs on one loop with the approval channel
     * attached, the honest answer is to run it: the routine stops at each
     * action and waits for the person, which is what the teammate was saved
     * to do.
     */
    /*
     * A STEP HANDED TO ANOTHER TEAMMATE (0.435) runs on THEIR route -- their
     * runtime, model and mode, as a message to them would -- and is given the
     * answer of the step before, quoted above the step's own words. Refused
     * here, before anything is recorded, when that teammate has no route this
     * host can run.
     */
    const owner = ownerOf(routine, step)
    const route = owner === routine.teammateId ? routine.route : await options.routeOf?.(owner).catch(() => undefined)
    if (route === undefined || !canStartRoutine(route.runtime)) {
      const message = route === undefined
        ? `Step ${String(step)} goes to ${peer.self.name}, whose route could not be read. Nothing was started.`
        : `Step ${String(step)} goes to ${peer.self.name}, whose runtime routines cannot run on yet. Nothing was started.`
      const held = routine.execution
      if (step > 1 && held !== undefined && held.status !== 'abandoned') await hold(routine, held, message, false, true)
      return { ok: false, error: { code: 'INVALID_PROMPT', message } }
    }
    const sent = handedFrom === undefined && !checks(routine, step)
      ? prompt
      : handOffPrompt({
          step: prompt,
          ...(handedFrom === undefined ? {} : { from: { name: handedFrom.name, answer: await options.replyOf?.(handedFrom.missionId).catch(() => undefined) } }),
          check: checks(routine, step)
        })
    const prior = routine.execution
    const intent: RoutineExecution = {
      attemptId: prior?.status === 'abandoned' || prior === undefined ? randomUUID() : prior.attemptId,
      status: 'dispatching', step, of: routine.steps.length, steps: routine.steps, route: routine.route,
      ...(routine.handOffs === undefined ? {} : { handOffs: routine.handOffs }),
      workspaceId: options.workspaceId,
      ...(prior?.recovered === true ? { recovered: true } : {}),
      startedAt: prior?.status === 'abandoned' || prior === undefined ? new Date().toISOString() : prior.startedAt,
      updatedAt: new Date().toISOString(), ...(followUpOf === undefined ? {} : { followUpOf })
    }
    // Persist BEFORE spawn. If spawn succeeds but recording its id fails, the
    // intent remains uncertain; restart must not replay it as an unstarted step.
    await options.routines.saveProgress(routine.routineId, intent, prior?.status === 'abandoned' ? null : prior?.attemptId ?? null)
    let response: CodexMissionStartResponse
    try {
      response = await options.start({
        prompt: sent,
        runtime: route.runtime,
        mode: route.mode,
        model: route.model === 'account-default' ? undefined : route.model,
        // A routine replays the turns you typed, and how hard the model was
        // asked to think is part of how it ran: one saved at `high` that
        // replays at the runtime's default is not the same routine.
        effort: route.effort,
        peer,
        followUpOf,
        startedBy: { kind: 'routine', routineId: routine.routineId, step }
      })
      if (response.ok) {
        await options.routines.saveProgress(routine.routineId, { ...intent, status: 'running',
          missionId: response.data.missionId, runId: response.data.runId }, intent.attemptId)
      } else if (step === 1 && (prior === undefined || prior.status === 'abandoned')
        && ['INVALID_PROMPT', 'RUN_ALREADY_ACTIVE', 'CODEX_UNAVAILABLE', 'SPEND_LIMIT_REACHED'].includes(response.error.code)) {
        // Only preflight refusals prove no dispatch. RUNTIME_START_FAILED and
        // PERSISTENCE_FAILED can also come from the spawn boundary; without an
        // id they remain uncertain, even though the service returned an error.
        await options.routines.clearProgress(routine.routineId, intent.attemptId)
      } else if (response.error.code === 'SPEND_LIMIT_REACHED') {
        // A later step at the teammate's monthly limit was refused before
        // anything was recorded, which PROVES it never started: said exactly,
        // never as "dispatch not confirmed ... review external work". It can
        // go on once the limit is raised or the month turns.
        await hold(routine, intent, `Step ${String(step)} was not started: ${response.error.message}`, true, true)
      } else {
        await hold(
          routine,
          intent,
          `Dispatch not confirmed for step ${String(step)}: ${response.error.message}. Review external work before proceeding.`,
          false,
          true
        )
      }
    } catch (error) {
      active.delete(routine.routineId)
      changed()
      throw error
    }
    return response
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

  const runner: RoutineRunner = {
    reconcile,
    async recover(request) {
      await reconcile()
      const routine = await options.routines.get(request.routineId)
      const execution = routine?.execution
      if (routine === undefined || execution?.status !== 'held' || execution.attemptId !== request.attemptId || execution.step !== request.step) {
        return { ok: false, error: { message: 'This recovery decision is stale. Reload routines and review the current attempt.' } }
      }
      if (request.decision === 'keep') {
        await options.routines.keepSchedule(routine.routineId, execution.attemptId, new Date().toISOString())
        changed()
        return { ok: true }
      }
      if (request.decision === 'abandon') {
        await options.routines.abandon(routine.routineId, execution.attemptId)
        changed()
        return { ok: true }
      }
      if (!execution.canContinue || execution.missionId === undefined) return { ok: false, error: { message: 'The saved step is not confirmed complete. Review its mission and external work; it cannot be safely continued.' } }
      // Recovery uses the saved definition, not edits made four days later --
      // who takes each step included (0.435).
      const { handOffs: _current, ...base } = routine
      const saved = { ...base, steps: execution.steps, route: execution.route, ...(execution.handOffs === undefined ? {} : { handOffs: execution.handOffs }), execution: { ...execution, recovered: true } }
      const next = execution.step + 1
      const owner = ownerOf(saved, next)
      const before = ownerOf(saved, execution.step)
      if (options.teammateBusy !== undefined && await options.teammateBusy(owner)) return { ok: false, error: { message: `${(await nameOf(owner)) ?? 'This teammate'} is busy. Wait for their current mission to finish.` } }
      const peer = await options.peerContextFor(owner)
      if (peer === undefined) return { ok: false, error: { message: 'The teammate no longer exists.' } }
      const handedFrom = owner !== before || checks(saved, next) ? { missionId: execution.missionId, name: (await nameOf(before)) ?? 'The teammate before' } : undefined
      const response = await startStep(saved, peer, next, owner === before ? execution.missionId : undefined, handedFrom)
      if (!response.ok) return { ok: false, error: { message: response.error.message } }
      await options.assignOwner(peer.self.teammateId, response.data.missionId).catch(() => undefined)
      const started = announce(saved, peer, next, response)
      if (handedFrom !== undefined) notice(started, `Routine "${saved.name}" · step ${String(next)} of ${String(saved.steps.length)}${handedTo(peer.self.name, handedFrom.name, checks(saved, next))}.`)
      changed()
      return { ok: true }
    },
    async run(routineId) {
      await reconcile()
      const routine = await options.routines.get(routineId)
      if (routine === undefined) {
        return { ok: false, error: { code: 'ROUTINE_REJECTED', message: 'That routine no longer exists.' } }
      }
      if (routine.execution !== undefined && routine.execution.status !== 'abandoned') {
        return { ok: false, error: { code: 'ROUTINE_REJECTED', message: 'This routine is already running or waiting for review. Open its routine card before starting more work.' } }
      }
      if (!canStartRoutine(routine.route.runtime)) {
        return {
          ok: false,
          error: { code: 'ROUTINE_REJECTED', message: `Routines cannot run on ${routine.route.runtime} yet.` }
        }
      }
      const first = ownerOf(routine, 1)
      const already = [...active.values()].find((progress) => progress.teammateId === first)
      if (already !== undefined) {
        return {
          ok: false,
          error: {
            code: 'ROUTINE_REJECTED',
            message: `${already.name} is already running for this teammate (step ${String(already.step)} of ${String(already.of)}). One routine at a time.`
          }
        }
      }
      const peer = await options.peerContextFor(first)
      if (peer === undefined) {
        return { ok: false, error: { code: 'ROUTINE_REJECTED', message: 'The teammate this routine belongs to no longer exists.' } }
      }
      const response = await startStep(routine, peer, 1, undefined)
      if (!response.ok) {
        return { ok: false, error: { code: 'ROUTINE_REJECTED', message: response.error.message } }
      }
      await options.assignOwner(peer.self.teammateId, response.data.missionId).catch(() => undefined)
      const progress = announce(routine, peer, 1, response)
      if (routine.steps.length > 1) {
        notice(progress, `Routine "${routine.name}" · step 1 of ${String(routine.steps.length)}. Each next step starts when this one completes.`)
      }
      return { ok: true, data: { missionId: response.data.missionId, runId: response.data.runId } }
    },

    async onRunEnded(mission) {
      const progress = [...active.values()].find((held) => held.missionId === mission.missionId)
      if (progress === undefined) return
      const phase = await options.phaseOf(mission.missionId).catch(() => undefined)
      const stored = await options.routines.get(progress.routineId)
      const execution = stored?.execution
      if (stored === undefined) {
        active.delete(progress.routineId)
        return
      }
      if (execution === undefined || execution.missionId !== mission.missionId) return
      if (phase !== 'completed') {
        await hold(stored, execution, phaseWords(phase))
        notice(progress, `Routine "${progress.name}" stopped at step ${String(progress.step)} of ${String(progress.of)}: ${phaseWords(phase)}.`)
        return
      }
      // A step that ended by asking something did not finish, whatever its
      // exit code says. Stopping here leaves the decision card answerable: the
      // teammate is free, so the answer starts a run instead of being refused
      // as busy by the step this would otherwise have begun.
      if (options.askedAQuestion === undefined || (await options.askedAQuestion(mission.missionId).catch(() => true))) {
        await hold(stored, execution, 'The step asked you something. Review its mission before proceeding.')
        notice(
          progress,
          /*
           * WHAT RUNNING IT AGAIN WOULD ACTUALLY DO.
           *
           * Astra's acceptance pass, 2026-09-14, finding 1. This said
           * "Answer it, then run the routine again when you are ready" --
           * which reads as "carry on from here" and is not what happens. The
           * attempt is HELD with `canContinue: false`, Routines asks you to
           * acknowledge or abandon it, and a later Run starts at step one.
           *
           * She did not answer and rerun, so no duplicate side effect is
           * claimed -- and that is exactly why the wording matters: a person
           * recovering work that is not repeatable needs to know whether the
           * next action continues or repeats, BEFORE they press it. Durable
           * state that is correct does not excuse instructions that are not.
           */
          `Routine "${progress.name}" stopped at step ${String(progress.step)} of ${String(progress.of)}: it asked you something. Answer it in that mission, then deal with the held attempt under Routines — this attempt cannot be continued, so running the routine again starts from step 1.`
        )
        return
      }
      // A CHECKER step counts only if it approves (0.435); the hold is final,
      // so a restart cannot re-decide it into a completed run.
      let approval = ''
      if (checks(execution, progress.step)) {
        const verdict = await checkerSaid(mission.missionId, progress.teammateId)
        if (!verdict.approved) {
          await hold(stored, execution, `${verdict.why}. The run does not count as done. Review the work, then run the routine again.`, false, true)
          notice(progress, `Routine "${progress.name}" stopped at step ${String(progress.step)} of ${String(progress.of)}: ${verdict.why}.`)
          return
        }
        approval = `, ${verdict.why}`
      }
      if (progress.step >= progress.of) {
        await complete(progress.routineId, execution)
        notice(progress, `Routine "${progress.name}" finished: ${String(progress.of)} step${progress.of === 1 ? '' : 's'} completed${approval}.`)
        return
      }
      // The routine may have been edited or removed while it ran; the steps
      // that run are the ones on file NOW, so a correction lands next time.
      const current = await options.routines.get(progress.routineId)
      const recoveredPlan = (held: PublicRoutine): PublicRoutine => {
        const { handOffs: _now, ...base } = held
        return { ...base, steps: execution.steps, route: execution.route, ...(execution.handOffs === undefined ? {} : { handOffs: execution.handOffs }) }
      }
      const routine = current === undefined ? undefined : execution.recovered === true ? recoveredPlan(current) : current
      const next = progress.step + 1
      const owner = routine === undefined ? undefined : ownerOf(routine, next)
      /*
       * HANDED TO A TEAMMATE WHO IS BUSY (0.435): held, not queued and not
       * refused -- the person continues it from the routine card once they
       * are free. Final, so a restart does not re-decide the reason away.
       */
      if (routine !== undefined && owner !== undefined && owner !== progress.teammateId && options.teammateBusy !== undefined
        && (await options.teammateBusy(owner).catch(() => true))) {
        const who = (await nameOf(owner)) ?? 'The next teammate'
        await hold(stored, execution, `Step ${String(next)} is ${who}'s, and ${who} is busy. Continue it here when they are free.`, true, true)
        notice(progress, `Routine "${progress.name}" is waiting after step ${String(progress.step)} of ${String(progress.of)}: step ${String(next)} is ${who}'s, who is busy. Continue it under Routines when they are free.`)
        return
      }
      const peer = routine === undefined || owner === undefined ? undefined : await options.peerContextFor(owner)
      if (routine === undefined || peer === undefined || progress.step >= routine.steps.length) {
        await hold(stored, execution, 'The routine or teammate changed while it was running.')
        notice(progress, `Routine "${progress.name}" stopped after step ${String(progress.step)}: the routine changed while it was running.`)
        return
      }
      // Another teammate's step starts a conversation of its own, given what
      // the step before answered; the same teammate's continues its own.
      const handedFrom = owner !== progress.teammateId || checks(routine, next)
        ? { missionId: mission.missionId, name: (await nameOf(progress.teammateId)) ?? 'The teammate before' }
        : undefined
      const response = await startStep(routine, peer, next, owner === progress.teammateId ? mission.missionId : undefined, handedFrom)
      if (!response.ok) {
        active.delete(progress.routineId)
        notice(progress, `Routine "${progress.name}" stopped before step ${String(next)} of ${String(routine.steps.length)}: ${response.error.message}`)
        return
      }
      await options.assignOwner(peer.self.teammateId, response.data.missionId).catch(() => undefined)
      const started = announce(routine, peer, next, response)
      notice(started, `Routine "${routine.name}" · step ${String(next)} of ${String(routine.steps.length)}${handedTo(peer.self.name, handedFrom?.name, checks(routine, next))}.`)
    },

    running() {
      return [...active.values()]
    },

    async tick(now) {
      // An end callback can fail on a transient disk error. Retry its durable
      // reconciliation too, rather than leaving this session stuck in RAM.
      for (const progress of [...active.values()]) {
        const phase = await options.phaseOf(progress.missionId).catch(() => undefined)
        // Same rule as reconcile: `interrupted` is also what a run that has
        // not written its terminal event yet looks like, so a live mission is
        // not one that ended.
        if (options.isLive?.(progress.missionId) === true) continue
        if (phase === 'completed' || phase === 'failed' || phase === 'cancelled' || phase === 'interrupted') await runner.onRunEnded({ missionId: progress.missionId })
      }
      await reconcile()
      const started: string[] = []
      const all = await options.routines.list().catch(() => [] as readonly PublicRoutine[])
      for (const routine of all) {
        if (routine.execution !== undefined && routine.execution.status !== 'abandoned') continue
        if (routine.schedule === undefined) continue
        if (!isDue(routine.schedule, routine.lastRunAt ?? routine.createdAt, now)) continue
        // M15: on its own, only in the folder it was made in. A routine made
        // for project A replayed its steps, in its write mode, in project B.
        const home = await (options.homeOf ?? (async (entry: PublicRoutine) => entry.workspaceId))(routine).catch(() => undefined)
        if (home !== undefined && home !== options.workspaceId) continue
        const until = heldOff.get(routine.routineId)
        if (until !== undefined && until > now.getTime()) continue
        heldOff.delete(routine.routineId)
        // Busy is a wait, not a failure: tried again next tick, no hold-off.
        const first = ownerOf(routine, 1)
        if ([...active.values()].some((progress) => progress.teammateId === first)) continue
        if (options.teammateBusy !== undefined && (await options.teammateBusy(first).catch(() => true))) continue
        const response = await this.run(routine.routineId)
        if (response.ok) {
          started.push(routine.routineId)
        } else if (isAtCapacity(response.error.message)) {
          /*
           * The workspace being full is a WAIT, exactly like the teammate
           * being busy two lines above -- and busy gets no hold-off.
           *
           * It used to fall to the branch below and wait an hour: the same
           * hold-off as a signed-out CLI, for a slot that may free in a
           * minute. And because `heldOff` is in memory, restarting cleared it
           * and retried at once -- so staying open was punished and quitting
           * was rewarded, which is the wrong way round (verified 2026-09-08
           * from a report by a Cursor teammate reading this source).
           *
           * Not announced either. Nobody needs telling that four missions are
           * running; they can see them.
           */
          continue
        } else {
          const latest = await options.routines.get(routine.routineId)
          if (latest?.execution !== undefined && latest.execution.status !== 'abandoned') continue
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
  // One transition at a time: duplicate end events, Run, recovery decisions
  // and timer ticks cannot dispatch the same step twice. Store writes also
  // compare attempt ids so stale decisions cannot acknowledge a newer run.
  let queue: Promise<unknown> = Promise.resolve()
  const serial = <T>(action: () => Promise<T>): Promise<T> => {
    const result = queue.then(action, action)
    queue = result.catch(() => undefined)
    return result
  }
  return {
    running: () => runner.running(),
    reconcile: () => serial(() => runner.reconcile()),
    run: (id) => serial(() => runner.run(id)),
    recover: (request) => serial(() => runner.recover(request)),
    onRunEnded: (mission) => serial(() => runner.onRunEnded(mission)),
    tick: (now) => serial(() => runner.tick(now))
  }
}
