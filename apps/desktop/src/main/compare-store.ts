import { randomUUID } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

import { COMPARE_SLOTS, MAX_COMPARE_SLOTS, MIN_COMPARE_SLOTS } from '../shared/compare.js'
import type { CompareRoute, CompareSlotId, PublicCompare, PublicCompareSlot } from '../shared/compare.js'

/**
 * COMPARISONS, remembered (0.441, shared/compare.ts).
 *
 * `userData/compares.json`, kept the way rooms.json is: writes serialized, a
 * temporary file synced and renamed into place, and a file that cannot be
 * read is UNREADABLE rather than empty -- every write reads first, so
 * "empty" would be written back over whatever the file held (the groups
 * store, 2026-09-16; the rooms store, 2026-09-14). A missing file is empty.
 */
const SCHEMA_VERSION = 1 as const
const MAX_FILE_BYTES = 4 * 1024 * 1024
export const MAX_COMPARES = 200
const MAX_PROMPT = 8_000
const MAX_TURNS_PER_SLOT = 200
/** Tries-again a column remembers, so their missions stay folded into it. */
const MAX_RETRIED_PER_SLOT = 50
/** Files a kept column's changes named; the rest are still in the folder, just not listed. */
const MAX_BROUGHT = 200
const UNREADABLE = 'The saved comparisons could not be read. Nothing was changed.'

interface StoredFile {
  readonly schemaVersion: typeof SCHEMA_VERSION
  readonly compares: readonly PublicCompare[]
}
const EMPTY: StoredFile = { schemaVersion: SCHEMA_VERSION, compares: [] }

export interface CompareStore {
  list(): Promise<readonly PublicCompare[]>
  get(compareId: unknown): Promise<PublicCompare | undefined>
  /** A new comparison, its columns named in order; the oldest past `MAX_COMPARES` is forgotten. */
  create(input: { readonly teammateId?: string; readonly prompt: string; readonly routes: readonly CompareRoute[]; readonly changes?: boolean; readonly changesIn?: 'copy' }): Promise<PublicCompare>
  /** A column's next turn started. */
  addTurn(compareId: string, slot: CompareSlotId, missionId: string): Promise<PublicCompare>
  /**
   * A column's newest answer tried again (0.444): the new mission takes its
   * place, and the one it replaces is kept as the comparison's, undrawn. A
   * column that could not start takes its first turn and loses its refusal.
   */
  retry(compareId: string, slot: CompareSlotId, missionId: string): Promise<PublicCompare>
  /** A column could not start, and why. */
  refuse(compareId: string, slot: CompareSlotId, why: string): Promise<PublicCompare>
  keep(compareId: string, slot: CompareSlotId, brought?: readonly string[]): Promise<PublicCompare>
  remove(compareId: unknown): Promise<void>
}

const isSlot = (value: unknown): value is CompareSlotId => typeof value === 'string' && (COMPARE_SLOTS as readonly string[]).includes(value)
const text = (value: unknown, max: number): string | undefined => (typeof value === 'string' && value.length > 0 && value.length <= max ? value : undefined)

function parsedSlot(value: unknown): PublicCompareSlot | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  const route = (typeof record.route === 'object' && record.route !== null ? record.route : {}) as Record<string, unknown>
  const runtime = text(route.runtime, 40)
  const model = text(route.model, 200)
  if (!isSlot(record.slot) || runtime === undefined || model === undefined) return undefined
  const effort = text(route.effort, 40)
  const label = text(route.label, 120)
  const missionIds = Array.isArray(record.missionIds) ? record.missionIds.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 200).slice(-MAX_TURNS_PER_SLOT) : []
  const refused = text(record.refused, 1_000)
  const retried = Array.isArray(record.retried) ? record.retried.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 200).slice(-MAX_RETRIED_PER_SLOT) : []
  return {
    slot: record.slot,
    route: { runtime, model, ...(effort === undefined ? {} : { effort }), ...(label === undefined ? {} : { label }) },
    missionIds,
    ...(refused === undefined ? {} : { refused }),
    ...(retried.length === 0 ? {} : { retried })
  }
}

function parsedCompare(value: unknown): PublicCompare | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  const compareId = text(record.compareId, 80)
  const teammateId = text(record.teammateId, 200)
  const prompt = text(record.prompt, MAX_PROMPT)
  const createdAt = text(record.createdAt, 40)
  if (compareId === undefined || (record.teammateId !== undefined && teammateId === undefined) || prompt === undefined || createdAt === undefined || !Array.isArray(record.slots)) return undefined
  const slots = record.slots.map(parsedSlot).filter((slot): slot is PublicCompareSlot => slot !== undefined)
  if (slots.length < MIN_COMPARE_SLOTS || slots.length > MAX_COMPARE_SLOTS || new Set(slots.map((slot) => slot.slot)).size !== slots.length) return undefined
  const kept = typeof record.kept === 'object' && record.kept !== null ? (record.kept as Record<string, unknown>) : undefined
  const keptAt = text(kept?.at, 40)
  const brought = Array.isArray(kept?.brought) ? kept.brought.filter((file): file is string => typeof file === 'string' && file.length > 0 && file.length <= 500).slice(0, MAX_BROUGHT) : undefined
  const keptSlot = kept !== undefined && isSlot(kept.slot) && keptAt !== undefined && slots.some((slot) => slot.slot === kept.slot)
    ? { slot: kept.slot, at: keptAt, ...(brought === undefined ? {} : { brought }) }
    : undefined
  return {
    compareId,
    ...(teammateId === undefined ? {} : { teammateId }),
    prompt,
    createdAt,
    slots,
    ...(record.changes === true ? { changes: true as const } : {}),
    ...(record.changes === true && record.changesIn === 'copy' ? { changesIn: 'copy' as const } : {}),
    ...(keptSlot === undefined ? {} : { kept: keptSlot })
  }
}

export function parsedCompareFile(raw: string): StoredFile {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new Error(UNREADABLE)
  }
  if (typeof value !== 'object' || value === null) throw new Error(UNREADABLE)
  const record = value as Record<string, unknown>
  if (record.schemaVersion !== SCHEMA_VERSION || !Array.isArray(record.compares)) throw new Error(UNREADABLE)
  const compares: PublicCompare[] = []
  const seen = new Set<string>()
  for (const entry of record.compares) {
    const compare = parsedCompare(entry)
    if (compare === undefined || seen.has(compare.compareId)) continue
    seen.add(compare.compareId)
    compares.push(compare)
  }
  return { schemaVersion: SCHEMA_VERSION, compares: compares.slice(-MAX_COMPARES) }
}

export function createCompareStore(options: {
  readonly rootDirectory: string
  readonly now?: () => Date
  readonly createId?: () => string
}): CompareStore {
  const rootDirectory = options.rootDirectory
  if (!isAbsolute(rootDirectory)) throw new Error('Compare store directory is invalid')
  const path = join(rootDirectory, 'compares.json')
  const now = options.now ?? (() => new Date())
  const createId = options.createId ?? (() => `cmp_${randomUUID().replace(/-/g, '').slice(0, 16)}`)

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
    let raw: string
    try {
      raw = await readFile(path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return EMPTY
      throw new Error(UNREADABLE)
    }
    if (Buffer.byteLength(raw, 'utf8') > MAX_FILE_BYTES) throw new Error(UNREADABLE)
    return parsedCompareFile(raw)
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

  /** Change one comparison, or say it is gone. */
  const change = (compareId: string, edit: (compare: PublicCompare) => PublicCompare): Promise<PublicCompare> =>
    serialize(async () => {
      const file = await read()
      const found = file.compares.find((compare) => compare.compareId === compareId)
      if (found === undefined) throw new Error('That comparison is no longer here.')
      const changed = edit(found)
      await write({ schemaVersion: SCHEMA_VERSION, compares: file.compares.map((compare) => (compare.compareId === compareId ? changed : compare)) })
      return changed
    })

  const inSlot = (compare: PublicCompare, slot: CompareSlotId, edit: (column: PublicCompareSlot) => PublicCompareSlot): PublicCompare => {
    if (!compare.slots.some((column) => column.slot === slot)) throw new Error('That comparison has no such column.')
    return { ...compare, slots: compare.slots.map((column) => (column.slot === slot ? edit(column) : column)) }
  }

  return {
    list: () => serialize(async () => (await read()).compares),

    get: (compareId) => serialize(async () => (await read()).compares.find((compare) => compare.compareId === compareId)),

    create: (input) =>
      serialize(async () => {
        const prompt = input.prompt.trim()
        if (prompt.length === 0 || prompt.length > MAX_PROMPT) throw new Error('There is nothing to compare.')
        if (input.routes.length < MIN_COMPARE_SLOTS || input.routes.length > MAX_COMPARE_SLOTS) {
          throw new Error(`A comparison is ${String(MIN_COMPARE_SLOTS)} or ${String(MAX_COMPARE_SLOTS)} models.`)
        }
        const file = await read()
        const compare: PublicCompare = {
          compareId: createId(),
          ...(input.teammateId === undefined ? {} : { teammateId: input.teammateId }),
          prompt,
          createdAt: now().toISOString(),
          ...(input.changes === true ? { changes: true as const } : {}),
          ...(input.changes === true && input.changesIn === 'copy' ? { changesIn: 'copy' as const } : {}),
          slots: input.routes.map((route, index) => ({
            slot: COMPARE_SLOTS[index]!,
            route: {
              runtime: route.runtime,
              model: route.model,
              ...(route.effort === undefined ? {} : { effort: route.effort }),
              ...(route.label === undefined ? {} : { label: route.label.slice(0, 120) })
            },
            missionIds: []
          }))
        }
        await write({ schemaVersion: SCHEMA_VERSION, compares: [...file.compares, compare].slice(-MAX_COMPARES) })
        return compare
      }),

    addTurn: (compareId, slot, missionId) =>
      change(compareId, (compare) =>
        inSlot(compare, slot, (column) => ({ ...column, missionIds: [...column.missionIds, missionId].slice(-MAX_TURNS_PER_SLOT) }))
      ),

    retry: (compareId, slot, missionId) =>
      change(compareId, (compare) =>
        inSlot(compare, slot, (column) => {
          const replaced = column.missionIds.at(-1)
          const { refused: _refused, ...rest } = column
          void _refused
          return replaced === undefined
            ? { ...rest, missionIds: [missionId] }
            : { ...rest, missionIds: [...column.missionIds.slice(0, -1), missionId], retried: [...(column.retried ?? []), replaced].slice(-MAX_RETRIED_PER_SLOT) }
        })
      ),

    refuse: (compareId, slot, why) => change(compareId, (compare) => inSlot(compare, slot, (column) => ({ ...column, refused: why.slice(0, 1_000) }))),

    keep: (compareId, slot, brought) =>
      change(compareId, (compare) => {
        const column = compare.slots.find((one) => one.slot === slot)
        if (column === undefined || column.missionIds.length === 0) throw new Error('That column has nothing to keep yet.')
        return { ...compare, kept: { slot, at: now().toISOString(), ...(brought === undefined ? {} : { brought: brought.slice(0, MAX_BROUGHT) }) } }
      }),

    remove: (compareId) =>
      serialize(async () => {
        const file = await read()
        await write({ schemaVersion: SCHEMA_VERSION, compares: file.compares.filter((compare) => compare.compareId !== compareId) })
      })
  }
}
