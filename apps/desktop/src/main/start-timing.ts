import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

import type { StartPhase } from '../shared/ipc.js'

/**
 * WHERE THE SECONDS BEFORE "STARTED" WENT (0.602).
 *
 * The ledger recorded when a mission was created and when the runtime said it
 * had started, and nothing in between: a median 4.5 to 10.5 s per runtime
 * (10/04, 183 missions) that nobody could split between Locust's own start
 * path and the CLI's boot. The start path now marks when each of its phases
 * began, the stream marks the first event, and the run's end writes one host
 * note with the durations -- shown under Details, kept in the saved record,
 * and the first thing to read when a start feels slow.
 */
export interface StartTiming {
  /** When the person's send reached the service. */
  readonly sentAt: number
  /** When each phase began (a phase that did not run is absent: a read-only run reads no folder). */
  readonly phaseAt: Partial<Record<StartPhase, number>>
  /** When the runtime's first event was persisted; set by the stream, once. */
  firstEventAt?: number
}

const ORDER: readonly StartPhase[] = ['looking', 'briefing', 'reading-folder', 'starting-runtime']

const seconds = (ms: number): string => `${(Math.max(0, ms) / 1000).toFixed(1)} s`

/** The sentence, or undefined before the runtime has said anything (then there is nothing to date). */
export function startTimingSentence(timing: StartTiming, runtimeName: string): string | undefined {
  if (timing.firstEventAt === undefined) return undefined
  const marks = ORDER.filter((phase) => timing.phaseAt[phase] !== undefined)
  const parts: string[] = []
  marks.forEach((phase, index) => {
    const from = timing.phaseAt[phase]!
    const next = marks[index + 1]
    const to = next === undefined ? timing.firstEventAt! : timing.phaseAt[next]!
    const took = seconds(to - from)
    if (phase === 'looking') parts.push(`looked for ${runtimeName} ${took}`)
    else if (phase === 'briefing') parts.push(`briefed ${took}`)
    else if (phase === 'reading-folder') parts.push(`read the folder ${took}`)
  })
  const spawnAt = timing.phaseAt['starting-runtime']
  const boot = spawnAt === undefined ? undefined : `${runtimeName} took ${seconds(timing.firstEventAt - spawnAt)} to say it had started`
  const total = `Started in ${seconds(timing.firstEventAt - timing.sentAt)}`
  if (parts.length === 0 && boot === undefined) return `${total}.`
  if (parts.length === 0) return `${total}: ${boot!}.`
  return `${total}: ${parts.join(', ')}${boot === undefined ? '' : `; ${boot}`}.`
}

/**
 * The host note for the record: an info-level diagnostic after the run's own
 * events (the ledger wants host notes before the first or after the last).
 */
export function startTimingNote(input: {
  readonly runId: string
  readonly missionId: string
  readonly sourceAdapter: NormalizedRuntimeEvent['sourceAdapter']
  readonly nextSequence: number
  readonly at: string
  readonly runtimeName: string
  readonly timing: StartTiming
}): NormalizedRuntimeEvent | undefined {
  const message = startTimingSentence(input.timing, input.runtimeName)
  if (message === undefined) return undefined
  return {
    runId: input.runId,
    missionId: input.missionId,
    occurredAt: input.at,
    sourceAdapter: input.sourceAdapter,
    id: `${input.runId}:host:start-timing:${String(input.nextSequence)}`,
    sequence: input.nextSequence,
    type: 'adapter.diagnostic',
    payload: {
      level: 'info',
      code: 'host.start-timing',
      message,
      terminal: false,
      evidence: { redacted: true as const }
    }
  } as NormalizedRuntimeEvent
}
