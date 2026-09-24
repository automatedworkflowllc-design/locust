import type { PublicRecoveredMission, PublicRoutine } from '../../shared/ipc.js'
import { nextRunAfter, scheduleLabel } from '../../shared/routine-schedule.js'
import { conversationTurns, typedPrompt } from './missionView.js'

/**
 * Turning a finished conversation into a routine a teammate can replay.
 *
 * A teammate cannot watch a person work outside this app -- Locust sees what a
 * runtime reports inside a mission, not an editor or a terminal. What it CAN
 * learn from is work it did WITH the person, and every conversation is already
 * a durable record of that. So a routine is the words a PERSON typed on each
 * turn, in order.
 *
 * Which is why host-written turns are dropped rather than saved: a relayed
 * reply, a resume, and a routine step all carry a briefing the host wrote for
 * a runtime, not something anyone typed. Replaying those would replay the
 * app's own words back at itself.
 */

export const MAX_ROUTINE_STEPS = 12

export interface RoutineDraft {
  readonly name: string
  readonly steps: readonly string[]
  readonly learnedFrom: readonly string[]
  /** True when the conversation had more turns than a routine may hold, and the draft was cut. */
  readonly truncated: boolean
}

/** A name from the first step: enough to recognise, short enough to sit in a list. */
export function draftName(step: string): string {
  const said = step.replace(/\s+/gu, ' ').trim()
  if (said.length <= 60) return said
  const cut = said.slice(0, 60)
  const space = cut.lastIndexOf(' ')
  return `${(space > 24 ? cut.slice(0, space) : cut).trimEnd()}...`
}

/**
 * The draft for one conversation, or undefined when there is nothing a person
 * typed in it -- an exchange made entirely of relayed turns is a real thing to
 * read and not a routine to replay.
 */
export function routineDraft(
  mission: PublicRecoveredMission,
  byId: ReadonlyMap<string, PublicRecoveredMission>
): RoutineDraft | undefined {
  const turns = conversationTurns(mission, byId)
  const said: { readonly missionId: string; readonly prompt: string; readonly phase: string | undefined }[] = []
  for (const turn of turns) {
    const held = byId.get(turn.missionId)
    // Host-written turns carry a briefing, not a person's words.
    if (held?.startedBy !== undefined) continue
    // A turn on another runtime was STARTED with the host's briefing; the
    // person's words are the part of it they typed (`typedPrompt`). Read raw,
    // the briefing itself was offered as a routine step.
    const prompt = (held === undefined ? turn.prompt : typedPrompt(held, byId)).trim()
    if (prompt.length === 0) continue
    said.push({ missionId: turn.missionId, prompt, phase: held?.phase })
  }
  /*
   * The turns that WORKED, where there are any.
   *
   * A routine replays what a conversation did, and a turn the person stopped
   * or that never finished is not something it did: the 0.271 recheck found
   * "Save as routine" proposing a cancelled prompt as a step. Completed turns
   * first; failing those, anything not cancelled, so a conversation whose
   * every turn failed on a quota can still be saved and replayed later.
   */
  const completed = said.filter((turn) => turn.phase === 'completed')
  const typed = completed.length > 0 ? completed : said.filter((turn) => turn.phase !== 'cancelled')
  const first = typed[0]
  if (first === undefined) return undefined
  const kept = typed.slice(0, MAX_ROUTINE_STEPS)
  return {
    name: draftName(first.prompt),
    steps: kept.map((turn) => turn.prompt),
    learnedFrom: kept.map((turn) => turn.missionId),
    truncated: typed.length > kept.length
  }
}

/** What the sidebar says under a teammate replaying a routine. */
export function routineStepLabel(progress: { readonly step: number; readonly of: number }): string {
  return `routine · step ${String(progress.step)} of ${String(progress.of)}`
}

/**
 * A running routine step, where the conversation it runs in is named: its
 * header says "routine Morning check, step 2 of 3" in place of "running".
 *
 * Only the compact sidebar said which step a routine was on; the conversation
 * the routine was running in said "running" like any other. Colin, asked
 * where the progress belongs: "maybe put in convo hub for teammate".
 * Undefined for a run no routine started.
 */
export function routineStepPhrase(
  startedBy: { readonly kind: string; readonly routineId?: string; readonly step?: number } | undefined,
  routines: readonly { readonly routineId: string; readonly name: string; readonly steps: readonly string[] }[]
): string | undefined {
  if (startedBy?.kind !== 'routine' || startedBy.routineId === undefined || startedBy.step === undefined) return undefined
  const routine = routines.find((entry) => entry.routineId === startedBy.routineId)
  return routine === undefined
    ? `routine, step ${String(startedBy.step)}`
    : `routine ${routine.name}, step ${String(startedBy.step)} of ${String(routine.steps.length)}`
}

/**
 * What a routine's card says about its last run. Never "never run" dressed up
 * as a time: a routine that has not run says so.
 */
export function routineRunSummary(routine: Pick<PublicRoutine, 'runs' | 'steps' | 'execution'>): string {
  const steps = `${String(routine.steps.length)} step${routine.steps.length === 1 ? '' : 's'}`
  if (routine.execution !== undefined) return `${steps} · ${routine.execution.status === 'abandoned' ? 'last attempt abandoned' : routine.execution.status === 'running' ? 'in progress' : 'waiting for review'} · ${String(routine.runs)} completed runs`
  if (routine.runs === 0) return `${steps} · not run yet`
  return `${steps} · run ${String(routine.runs)} time${routine.runs === 1 ? '' : 's'}`
}

const pad = (value: number): string => String(value).padStart(2, '0')
const clock = (at: Date): string => `${pad(at.getHours())}:${pad(at.getMinutes())}`
const sameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

/**
 * What a routine's card says about its schedule: the rule and the next run,
 * in the person's own clock. Undefined for a routine that only runs when
 * pressed, so the card says nothing rather than "never".
 */
export function routineScheduleSummary(
  routine: Pick<PublicRoutine, 'schedule' | 'lastRunAt' | 'createdAt' | 'execution'>,
  now: Date
): string | undefined {
  if (routine.schedule === undefined) return undefined
  if (routine.execution !== undefined && routine.execution.status !== 'abandoned') return `${scheduleLabel(routine.schedule)} · ${routine.execution.status === 'running' ? 'in progress' : 'held for review; no automatic retry'}`
  const next = nextRunAfter(routine.schedule, routine.lastRunAt ?? routine.createdAt, now)
  const when =
    next.getTime() <= now.getTime()
      ? 'due now'
      : sameDay(next, now)
        ? `next ${clock(next)}`
        : sameDay(next, new Date(now.getTime() + 24 * 3_600_000))
          ? `next tomorrow ${clock(next)}`
          : `next ${WEEKDAYS[next.getDay()] ?? ''} ${clock(next)}`
  return `${scheduleLabel(routine.schedule)} · ${when}`
}
