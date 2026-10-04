import type { PublicRecoveredMission, PublicRoutine } from '../../shared/ipc.js'
import type { MissionRuntimeId } from '@teammate/runtime-adapters'
import { splitAttachments } from '../../shared/attachments.js'
import { nextRunAfter, scheduleLabel } from '../../shared/routine-schedule.js'
import { conversationTurns, typedPrompt } from './missionView.js'
import { routeModelName } from './routeName.js'
import { runtimeDisplayName } from '../../shared/runtimes.js'

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
    // Host-written turns carry a briefing, not a person's words. A turn typed
    // in the runtime's own terminal (0.391) is the person's, but it can be a
    // terminal command ("/review") that a replay here would not run the same
    // way, so it is not offered as a step either.
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
    // Named by what the person typed, not by the host's attachment line (L17).
    name: draftName(splitAttachments(first.prompt).text),
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
 * Who does a hand-off chain's steps, in order (0.435): "Wren → Atlas → Sable
 * (checks)". Consecutive steps of one teammate read once; a checker always
 * reads, marked. Undefined for a routine one teammate runs throughout, whose
 * card names that teammate as it always has.
 */
export function routineChain(
  routine: Pick<PublicRoutine, 'teammateId' | 'handOffs' | 'steps'>,
  team: readonly { readonly teammateId: string; readonly name: string; readonly route?: { readonly runtime: string; readonly model: string } }[],
  /**
   * Each teammate with the model their steps run on (0.493): a step runs on
   * its teammate's route at the time, and Grok's 0.489 pass could not tell
   * which model a routine would use from its card.
   */
  withModels = false
): string | undefined {
  const handOffs = routine.handOffs
  if (handOffs === undefined || !handOffs.some((entry) => entry.teammateId !== undefined || entry.check === true)) {
    if (!withModels) return undefined
    return routineRunner(routine.teammateId, team)
  }
  const nameOf = (id: string): string => (withModels ? routineRunner(id, team) : team.find((teammate) => teammate.teammateId === id)?.name ?? 'someone removed')
  const links: string[] = []
  let last: string | undefined
  routine.steps.forEach((_, index) => {
    const entry = handOffs[index] ?? {}
    const owner = entry.teammateId ?? routine.teammateId
    if (owner === last && entry.check !== true) return
    links.push(entry.check === true ? `${nameOf(owner)} (checks)` : nameOf(owner))
    last = owner
  })
  return links.join(' → ')
}

/** A teammate and the model their routine steps run on now: "Wren (Grok 4.7)". */
export function routineRunner(
  teammateId: string,
  team: readonly { readonly teammateId: string; readonly name: string; readonly route?: { readonly runtime: string; readonly model: string } }[]
): string {
  const teammate = team.find((entry) => entry.teammateId === teammateId)
  if (teammate === undefined) return 'someone removed'
  const route = teammate.route
  return route === undefined ? teammate.name : `${teammate.name} (${route.model === 'account-default' ? `${runtimeDisplayName(route.runtime as MissionRuntimeId)} default` : routeModelName(route.runtime, route.model)})`
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

/**
 * A scheduled routine on a teammate in Approve each (0.591, the PRD's U4):
 * fired while nobody is at the window, its run stops on the first card and
 * waits there. Said on the row, where the schedule is set, instead of being
 * found the next morning under "waiting on you". Undefined for every other
 * mode, and for a routine that only runs when pressed (someone is there).
 */
export function routineWaitsForYou(routine: Pick<PublicRoutine, 'route' | 'schedule'>): string | undefined {
  if (routine.schedule === undefined || routine.route.mode !== 'approve-each') return undefined
  return 'Runs in Approve each: fired while you are away, it waits for you on its first card. Ask or Accept edits runs through.'
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
/** "Missed, 08:00 today" — the slot that passed while Locust was closed. */
export function missedLine(missedAt: string, now: Date): string | undefined {
  const at = new Date(missedAt)
  if (Number.isNaN(at.getTime())) return undefined
  const when = clock(at)
  if (sameDay(at, now)) return `Missed, ${when} today`
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  if (sameDay(at, yesterday)) return `Missed, ${when} yesterday`
  return `Missed, ${WEEKDAYS[at.getDay()] ?? ''} ${when}`
}

export function routineScheduleSummary(
  routine: Pick<PublicRoutine, 'schedule' | 'lastRunAt' | 'createdAt' | 'execution' | 'missedAt'>,
  now: Date
): string | undefined {
  if (routine.schedule === undefined) return undefined
  if (routine.execution !== undefined && routine.execution.status !== 'abandoned') return `${scheduleLabel(routine.schedule)} · ${routine.execution.status === 'running' ? 'in progress' : 'held for review; no automatic retry'}`
  if (routine.missedAt !== undefined) {
    const missed = missedLine(routine.missedAt, now)
    if (missed !== undefined) return missed
  }
  const next = nextRunAfter(routine.schedule, routine.lastRunAt ?? routine.createdAt, now)
  // A watcher has no next time: it is waiting for a file (0.522).
  if (routine.schedule.kind === 'files') return `${scheduleLabel(routine.schedule)} · watching`
  // A once that has run: said, so the card does not promise a run that will not come.
  if (next === undefined) return `${scheduleLabel(routine.schedule)} · done`
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
