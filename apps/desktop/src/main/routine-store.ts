import { randomUUID } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

import type { PublicRoutine, TeammateRoute } from '../shared/ipc.js'
import { validSchedule } from '../shared/routine-schedule.js'
import { isTeammateRoute, safeId } from './teammate-store.js'
import type { RoutineExecution } from '../shared/routine-recovery.js'

/**
 * Routines: conversations a person saved as steps a teammate can replay.
 *
 * Kept beside the roster in the profile (`routines.json`), written the way
 * the roster is -- validate everything, write-and-rename, one writer at a
 * time -- because a routine is a person's own words and will be sent to a
 * runtime again later, unread. Anything that would not round-trip cleanly is
 * refused at the door rather than repaired: a step silently rewritten is a
 * step the person did not ask for.
 */

const SCHEMA_VERSION = 1 as const
const MAX_FILE_BYTES = 4 * 1024 * 1024
/** The file exists and cannot be read. Not "no routines": nothing is written over it. */
export const ROUTINES_UNREADABLE = 'ROUTINES_UNREADABLE'
export const MAX_ROUTINES = 64
export const MAX_STEPS = 12
export const MAX_STEP_LENGTH = 20_000
export const MAX_ROUTINE_NAME_LENGTH = 80
export const MAX_LEARNED_FROM = 64

export interface RoutineStore {
  list(): Promise<readonly PublicRoutine[]>
  get(routineId: unknown): Promise<PublicRoutine | undefined>
  create(input: {
    readonly name: unknown
    readonly teammateId: unknown
    readonly route: unknown
    readonly steps: unknown
    readonly learnedFrom: unknown
    readonly schedule?: unknown
  }): Promise<PublicRoutine>
  /** Corrections: the name, the steps, and the schedule (`null` clears it). The teammate, route and provenance stay. */
  update(input: { readonly routineId: unknown; readonly name: unknown; readonly steps: unknown; readonly schedule?: unknown }): Promise<PublicRoutine>
  remove(routineId: unknown): Promise<void>
  /** Count reconciled final completion and clear its matching progress in one write. */
  recordRun(routineId: unknown, attemptId: string): Promise<void>
  saveProgress(routineId: string, progress: RoutineExecution, expectedAttemptId: string | null): Promise<void>
  abandon(routineId: string, attemptId: string): Promise<void>
  clearProgress(routineId: string, attemptId: string): Promise<void>
  /** Drop every routine of a teammate who is gone; their steps had nobody to run them. */
  removeForTeammate(teammateId: unknown): Promise<void>
}

interface StoredFile {
  readonly schemaVersion: typeof SCHEMA_VERSION
  readonly routines: readonly PublicRoutine[]
}

const EMPTY: StoredFile = { schemaVersion: SCHEMA_VERSION, routines: [] }

/** A name the UI can show back: one line, no control characters, bounded. */
export function validRoutineName(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > MAX_ROUTINE_NAME_LENGTH) return false
  // eslint-disable-next-line no-control-regex
  return !/[\u0000-\u001f\u007f]/.test(trimmed)
}

/**
 * Steps are what a person typed: any printable text, newlines included, each
 * bounded, at least one and not more than a person could reasonably review.
 * An empty step is refused: it would start a run with nothing to do.
 */
export function validSteps(value: unknown): value is readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_STEPS) return false
  return value.every(
    (step) =>
      typeof step === 'string'
      && step.trim().length > 0
      && step.length <= MAX_STEP_LENGTH
      // eslint-disable-next-line no-control-regex
      && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(step)
  )
}

function validLearnedFrom(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.length <= MAX_LEARNED_FROM && value.every((id) => safeId(id))
}

export function parsedRoutine(value: unknown): PublicRoutine | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  if (!safeId(record.routineId) || !safeId(record.teammateId)) return undefined
  if (!validRoutineName(record.name) || !validSteps(record.steps) || !isTeammateRoute(record.route)) return undefined
  if (!validLearnedFrom(record.learnedFrom)) return undefined
  if (typeof record.createdAt !== 'string' || Number.isNaN(Date.parse(record.createdAt))) return undefined
  if (typeof record.runs !== 'number' || !Number.isSafeInteger(record.runs) || record.runs < 0) return undefined
  if (record.lastRunAt !== undefined && (typeof record.lastRunAt !== 'string' || Number.isNaN(Date.parse(record.lastRunAt)))) {
    return undefined
  }
  // A schedule that does not read is dropped, not the routine: the steps
  // are the person's words and outrank a malformed timer.
  const schedule = validSchedule(record.schedule) ? record.schedule : undefined
  const route: TeammateRoute = {
    runtime: record.route.runtime,
    model: record.route.model,
    mode: record.route.mode,
    // Carried explicitly. This object is rebuilt field by field, so anything
    // added to TeammateRoute and not named here is dropped in silence -- the
    // shape that once lost a row's effort levels and drew a control with none
    // under a detail line promising five.
    ...(record.route.effort === undefined ? {} : { effort: record.route.effort })
  }
  return {
    routineId: record.routineId,
    name: record.name.trim(),
    teammateId: record.teammateId,
    route,
    steps: [...record.steps],
    learnedFrom: [...record.learnedFrom],
    createdAt: record.createdAt,
    runs: record.runs,
    ...(record.lastRunAt === undefined ? {} : { lastRunAt: record.lastRunAt }),
    ...(schedule === undefined ? {} : { schedule }),
    ...(record.execution === undefined ? {} : { execution: parsedExecution(record.execution, record.steps, route) })
  }
}

function parsedExecution(value: unknown, steps: readonly string[], route: TeammateRoute): RoutineExecution {
  const item = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  if (safeId(item.attemptId) && ['dispatching', 'running', 'held', 'abandoned'].includes(String(item.status))
    && Number.isInteger(item.step) && Number(item.step) >= 1 && validSteps(item.steps)
    && item.of === item.steps.length && Number(item.step) <= Number(item.of) && isTeammateRoute(item.route) && safeId(item.workspaceId)
    && typeof item.startedAt === 'string' && !Number.isNaN(Date.parse(item.startedAt))
    && typeof item.updatedAt === 'string' && !Number.isNaN(Date.parse(item.updatedAt))
    && [item.missionId, item.runId, item.followUpOf].every((id) => id === undefined || safeId(id))
    && (item.reason === undefined || (typeof item.reason === 'string' && item.reason.length <= 4000))
    && (item.canContinue === undefined || typeof item.canContinue === 'boolean')
    && (item.recovered === undefined || typeof item.recovered === 'boolean')
    && (item.settledAtDispatch === undefined || typeof item.settledAtDispatch === 'boolean')) {
    return item as unknown as RoutineExecution
  }
  // Losing an invalid receipt must never turn uncertain side effects into a
  // routine eligible for automatic replay. Keep a visible, non-resumable hold.
  return { attemptId: 'invalid_receipt', status: 'held', step: 1, of: steps.length,
    startedAt: '1970-01-01T00:00:00.000Z', updatedAt: '1970-01-01T00:00:00.000Z', steps, route,
    workspaceId: 'unknown', reason: 'The saved execution receipt is invalid. Review external work before abandoning this attempt.', canContinue: false }
}

/**
 * A ROUTINE that does not parse is dropped rather than repaired. A FILE that
 * does not parse is unreadable -- it used to read as empty, "the same call
 * the roster store made", and the roster store's call was the bug: every
 * write reads first, so empty-on-failure is overwrite-on-failure.
 */
export function parsedFile(text: string): StoredFile {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error(ROUTINES_UNREADABLE)
  }
  if (typeof value !== 'object' || value === null) throw new Error(ROUTINES_UNREADABLE)
  const record = value as Record<string, unknown>
  if (record.schemaVersion !== SCHEMA_VERSION || !Array.isArray(record.routines)) throw new Error(ROUTINES_UNREADABLE)
  const routines: PublicRoutine[] = []
  const seen = new Set<string>()
  for (const entry of record.routines) {
    const routine = parsedRoutine(entry)
    if (routine === undefined || seen.has(routine.routineId)) continue
    seen.add(routine.routineId)
    routines.push(routine)
    if (routines.length >= MAX_ROUTINES) break
  }
  return { schemaVersion: SCHEMA_VERSION, routines }
}

export function createRoutineStore(options: { readonly rootDirectory: string }): RoutineStore {
  const rootDirectory = options.rootDirectory
  if (!isAbsolute(rootDirectory)) throw new Error('Routine store directory is invalid')
  const path = join(rootDirectory, 'routines.json')

  let queue: Promise<unknown> = Promise.resolve()
  const serialize = <T>(task: () => Promise<T>): Promise<T> => {
    const next = queue.then(task, task)
    queue = next.then(
      () => undefined,
      () => undefined
    )
    return next
  }

  const read = async (): Promise<StoredFile> => {
    let text: string
    try {
      text = await readFile(path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return EMPTY
      throw new Error(ROUTINES_UNREADABLE)
    }
    if (Buffer.byteLength(text, 'utf8') > MAX_FILE_BYTES) throw new Error(ROUTINES_UNREADABLE)
    return parsedFile(text)
  }

  const write = async (file: StoredFile): Promise<void> => {
    // Progress includes a saved definition. Refuse growth before committing a
    // file our bounded reader would subsequently treat as empty.
    if (Buffer.byteLength(JSON.stringify(file, null, 2) + '\n', 'utf8') > MAX_FILE_BYTES) throw new Error('Routine store is full; reduce saved routines before starting more work.')
    await mkdir(rootDirectory, { recursive: true, mode: 0o700 })
    const temporary = `${path}.${randomUUID()}.tmp`
    const handle = await open(temporary, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL, 0o600)
    try {
      await handle.writeFile(`${JSON.stringify(file, null, 2)}\n`, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    try {
      await rename(temporary, path)
    } catch (error) {
      await unlink(temporary).catch(() => undefined)
      throw error
    }
  }

  return {
    list(): Promise<readonly PublicRoutine[]> {
      return serialize(async () => (await read()).routines)
    },

    get(routineId): Promise<PublicRoutine | undefined> {
      return serialize(async () => {
        if (!safeId(routineId)) return undefined
        return (await read()).routines.find((routine) => routine.routineId === routineId)
      })
    },

    create(input): Promise<PublicRoutine> {
      return serialize(async () => {
        if (!validRoutineName(input.name)) throw new Error('Routine name is invalid')
        if (!safeId(input.teammateId)) throw new Error('Teammate id is invalid')
        if (!isTeammateRoute(input.route)) throw new Error('Routine route is invalid')
        if (!validSteps(input.steps)) throw new Error(`Routine steps are invalid: 1 to ${String(MAX_STEPS)} non-empty steps`)
        if (!validLearnedFrom(input.learnedFrom)) throw new Error('Routine provenance is invalid')
        if (input.schedule !== undefined && !validSchedule(input.schedule)) {
          throw new Error('The schedule is not one Locust can keep: every 1 to 168 hours, or daily at HH:MM.')
        }
        const file = await read()
        if (file.routines.length >= MAX_ROUTINES) throw new Error('Too many routines')
        const routine: PublicRoutine = {
          routineId: `rt_${randomUUID().replace(/-/g, '').slice(0, 24)}`,
          name: input.name.trim(),
          teammateId: input.teammateId,
          route: {
            runtime: input.route.runtime,
            model: input.route.model,
            mode: input.route.mode,
            ...(input.route.effort === undefined ? {} : { effort: input.route.effort })
          },
          steps: [...input.steps],
          learnedFrom: [...input.learnedFrom],
          createdAt: new Date().toISOString(),
          runs: 0,
          ...(input.schedule === undefined ? {} : { schedule: input.schedule })
        }
        await write({ ...file, routines: [...file.routines, routine] })
        return routine
      })
    },

    update(input): Promise<PublicRoutine> {
      return serialize(async () => {
        if (!safeId(input.routineId)) throw new Error('Routine id is invalid')
        if (!validRoutineName(input.name)) throw new Error('Routine name is invalid')
        if (!validSteps(input.steps)) throw new Error(`Routine steps are invalid: 1 to ${String(MAX_STEPS)} non-empty steps`)
        const file = await read()
        const held = file.routines.find((routine) => routine.routineId === input.routineId)
        if (held === undefined) throw new Error('Routine not found')
        if (input.schedule !== undefined && input.schedule !== null && !validSchedule(input.schedule)) {
          throw new Error('The schedule is not one Locust can keep: every 1 to 168 hours, or daily at HH:MM.')
        }
        const { schedule: _held, ...rest } = held
        const next: PublicRoutine = {
          ...rest,
          name: input.name.trim(),
          steps: [...input.steps],
          ...(input.schedule === null
            ? {}
            : input.schedule === undefined
              ? (held.schedule === undefined ? {} : { schedule: held.schedule })
              : { schedule: input.schedule })
        }
        await write({
          ...file,
          routines: file.routines.map((routine) => (routine.routineId === next.routineId ? next : routine))
        })
        return next
      })
    },

    remove(routineId): Promise<void> {
      return serialize(async () => {
        if (!safeId(routineId)) throw new Error('Routine id is invalid')
        const file = await read()
        if (!file.routines.some((routine) => routine.routineId === routineId)) return
        await write({ ...file, routines: file.routines.filter((routine) => routine.routineId !== routineId) })
      })
    },

    recordRun(routineId, attemptId): Promise<void> {
      return serialize(async () => {
        if (!safeId(routineId)) return
        const file = await read()
        const held = file.routines.find((routine) => routine.routineId === routineId)
        if (held === undefined) return
        if (held.execution?.attemptId !== attemptId || held.execution.step !== held.execution.of
          || held.execution.missionId === undefined || !['running', 'held'].includes(held.execution.status)) {
          throw new Error('Routine completion receipt changed; reload before continuing.')
        }
        // Counting and clearing share ONE rename: a crash cannot count twice,
        // nor leave a completed routine looking like it only started step 1.
        const { execution: _execution, ...rest } = held
        const next: PublicRoutine = { ...rest, runs: held.runs + 1, lastRunAt: new Date().toISOString() }
        await write({
          ...file,
          routines: file.routines.map((routine) => (routine.routineId === next.routineId ? next : routine))
        })
      })
    },

    saveProgress(routineId, progress, expectedAttemptId) {
      return serialize(async () => {
        const file = await read()
        const held = file.routines.find((routine) => routine.routineId === routineId)
        const current = held?.execution
        if (held === undefined || (expectedAttemptId === null
          ? current !== undefined && current.status !== 'abandoned'
          : current?.attemptId !== expectedAttemptId)) throw new Error('Routine execution changed; reload before continuing.')
        if (parsedExecution(progress, held.steps, held.route).attemptId !== progress.attemptId) throw new Error('Invalid routine progress')
        await write({ ...file, routines: file.routines.map((routine) => routine.routineId === routineId ? { ...held, execution: progress } : routine) })
      })
    },

    clearProgress(routineId, attemptId) {
      return serialize(async () => {
        const file = await read()
        const held = file.routines.find((routine) => routine.routineId === routineId)
        if (held?.execution?.attemptId !== attemptId) throw new Error('Routine execution changed.')
        const { execution: _execution, ...rest } = held
        await write({ ...file, routines: file.routines.map((routine) => routine.routineId === routineId ? rest : routine) })
      })
    },

    abandon(routineId, attemptId) {
      return serialize(async () => {
        const file = await read()
        const held = file.routines.find((routine) => routine.routineId === routineId)
        if (held?.execution?.attemptId !== attemptId || held.execution.status !== 'held') throw new Error('Routine execution changed; reload before continuing.')
        // Acknowledgement is not permission for the due scheduler to replay
        // step 1 a minute later. Pause the existing schedule in the same write.
        const { schedule: _schedule, ...rest } = held
        const next: PublicRoutine = { ...rest, execution: { ...held.execution, status: 'abandoned', canContinue: false,
          updatedAt: new Date().toISOString(), reason: 'Abandoned by you; schedule removed. This does not stop an external runtime or undo its work.' } }
        await write({ ...file, routines: file.routines.map((routine) => routine.routineId === routineId ? next : routine) })
      })
    },

    removeForTeammate(teammateId): Promise<void> {
      return serialize(async () => {
        if (!safeId(teammateId)) return
        const file = await read()
        if (!file.routines.some((routine) => routine.teammateId === teammateId)) return
        await write({ ...file, routines: file.routines.filter((routine) => routine.teammateId !== teammateId) })
      })
    }
  }
}
