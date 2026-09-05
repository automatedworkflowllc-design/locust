import { randomUUID } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

import type { PublicRoutine, TeammateRoute } from '../shared/ipc.js'
import { validSchedule } from '../shared/routine-schedule.js'
import { isTeammateRoute, safeId } from './teammate-store.js'

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
  /** Count a run, and when. Unknown routine: nothing changes. */
  recordRun(routineId: unknown): Promise<void>
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
  const route: TeammateRoute = { runtime: record.route.runtime, model: record.route.model, mode: record.route.mode }
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
    ...(schedule === undefined ? {} : { schedule })
  }
}

/**
 * A file that does not parse is treated as empty rather than repaired: the
 * roster store made the same call, and a routine silently altered by a
 * reader is worse than one that is missing and says so on the next save.
 */
export function parsedFile(text: string): StoredFile {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return EMPTY
  }
  if (typeof value !== 'object' || value === null) return EMPTY
  const record = value as Record<string, unknown>
  if (record.schemaVersion !== SCHEMA_VERSION || !Array.isArray(record.routines)) return EMPTY
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
    try {
      const text = await readFile(path, 'utf8')
      if (Buffer.byteLength(text, 'utf8') > MAX_FILE_BYTES) return EMPTY
      return parsedFile(text)
    } catch {
      return EMPTY
    }
  }

  const write = async (file: StoredFile): Promise<void> => {
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
          route: { runtime: input.route.runtime, model: input.route.model, mode: input.route.mode },
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

    recordRun(routineId): Promise<void> {
      return serialize(async () => {
        if (!safeId(routineId)) return
        const file = await read()
        const held = file.routines.find((routine) => routine.routineId === routineId)
        if (held === undefined) return
        const next: PublicRoutine = { ...held, runs: held.runs + 1, lastRunAt: new Date().toISOString() }
        await write({
          ...file,
          routines: file.routines.map((routine) => (routine.routineId === next.routineId ? next : routine))
        })
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
