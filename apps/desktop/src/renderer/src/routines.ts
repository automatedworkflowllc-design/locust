import type { PublicRecoveredMission, PublicRoutine } from '../../shared/ipc.js'
import { nextRunAfter, scheduleLabel } from '../../shared/routine-schedule.js'
import { conversationTurns } from './missionView.js'

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
  const typed: { readonly missionId: string; readonly prompt: string }[] = []
  for (const turn of turns) {
    const held = byId.get(turn.missionId)
    // Host-written turns carry a briefing, not a person's words.
    if (held?.startedBy !== undefined) continue
    const prompt = (held?.prompt ?? turn.prompt).trim()
    if (prompt.length === 0) continue
    typed.push({ missionId: turn.missionId, prompt })
  }
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
 * What a routine's card says about its last run. Never "never run" dressed up
 * as a time: a routine that has not run says so.
 */
export function routineRunSummary(routine: Pick<PublicRoutine, 'runs' | 'steps'>): string {
  const steps = `${String(routine.steps.length)} step${routine.steps.length === 1 ? '' : 's'}`
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
  routine: Pick<PublicRoutine, 'schedule' | 'lastRunAt' | 'createdAt'>,
  now: Date
): string | undefined {
  if (routine.schedule === undefined) return undefined
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
