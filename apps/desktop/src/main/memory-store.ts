import { randomUUID } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

import type { MemoryScope, PublicMemory } from '../shared/ipc.js'
import { boundedMemoryText, forgetMatch, memoryKey, memoryName } from '../shared/memory.js'
import { safeId } from './teammate-store.js'

/**
 * Team memory on disk: one file for every folder, in the app's own data
 * directory, so a memory written in one project is there when the app is
 * opened in another (a "global" one) or in the same one again.
 *
 * Every memory names who wrote it, which folder, and which conversation --
 * the Memory screen shows exactly that, and a person can edit, switch off,
 * or delete any one. A memory can be `proposed` (waiting for the person,
 * the Cursor way) or `kept` (the Claude Code way); Settings decides which
 * a teammate's memory starts as. Only kept, enabled memories are briefed.
 */

const SCHEMA_VERSION = 1 as const
const MAX_FILE_BYTES = 2 * 1024 * 1024
export const MAX_MEMORIES = 400
export const MAX_WORKSPACE_NAME_LENGTH = 120

export interface MemoryStore {
  list(): Promise<readonly PublicMemory[]>
  /** What a mission in this folder is briefed with: kept, enabled, this folder's and everyone's. */
  briefed(workspaceId: string): Promise<readonly PublicMemory[]>
  /**
   * Remember one thing. A memory with the same text in the same place is
   * not written twice: the existing one is returned unchanged (and a
   * proposed one is not silently promoted).
   */
  add(input: {
    readonly text: unknown
    readonly scope: unknown
    /**
     * File it under this slug. Remembering the same name in the same place
     * REWRITES that memory rather than adding a near-copy beside it -- which
     * is the whole fix for a teammate that re-states the same fact after
     * every run. Absent matches by text, exactly as before.
     */
    readonly name?: unknown
    readonly workspaceId: string
    readonly workspaceName: string
    readonly by: { readonly teammateId?: string; readonly name: string }
    readonly missionId?: string
    readonly status: 'kept' | 'proposed'
  }): Promise<{ readonly memory: PublicMemory; readonly created: boolean; readonly rewritten?: boolean }>
  /** Edit the text, switch it on or off, or keep a proposed one. */
  update(input: { readonly memoryId: unknown; readonly text?: unknown; readonly enabled?: unknown; readonly keep?: unknown }): Promise<PublicMemory>
  remove(memoryId: unknown): Promise<void>
  /**
   * Forget by quote, in this folder and everywhere.
   *
   * Says what HAPPENED rather than how many rows moved. A quote that matches
   * nothing, or matches several, removes nothing and is reported as such --
   * see `forgetMatch`. It used to return 0 for both, indistinguishable from
   * "there was nothing to do", and the caller only reported successes.
   */
  forget(text: string, workspaceId: string): Promise<ForgetResult>
  /** Everything for one folder, or everything. */
  clear(input: { readonly workspaceId?: string }): Promise<number>
}

export interface ForgetResult {
  /** The memories actually removed, in the store's own words. */
  readonly removed: readonly string[]
  /**
   * Why nothing was removed. `ambiguous` carries the memories it could have
   * meant, so the teammate can quote one of them properly next time.
   */
  readonly refusal: 'nothing-matched' | 'ambiguous' | undefined
  readonly candidates: readonly string[]
}

interface StoredFile {
  readonly schemaVersion: typeof SCHEMA_VERSION
  readonly memories: readonly PublicMemory[]
}

const EMPTY: StoredFile = { schemaVersion: SCHEMA_VERSION, memories: [] }

export function validMemoryText(value: unknown): value is string {
  return typeof value === 'string' && boundedMemoryText(value).length > 0
}

export function validScope(value: unknown): value is MemoryScope {
  return value === 'workspace' || value === 'global'
}

export function parsedMemory(value: unknown): PublicMemory | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  if (!safeId(record.memoryId) || !validMemoryText(record.text) || !validScope(record.scope)) return undefined
  if (typeof record.workspaceId !== 'string' || record.workspaceId.length === 0 || record.workspaceId.length > 80) return undefined
  if (typeof record.workspaceName !== 'string' || record.workspaceName.length > MAX_WORKSPACE_NAME_LENGTH) return undefined
  if (typeof record.by !== 'object' || record.by === null) return undefined
  const by = record.by as Record<string, unknown>
  if (typeof by.name !== 'string' || by.name.trim().length === 0 || by.name.length > 80) return undefined
  if (by.teammateId !== undefined && !safeId(by.teammateId)) return undefined
  if (record.missionId !== undefined && !safeId(record.missionId)) return undefined
  if (typeof record.createdAt !== 'string' || Number.isNaN(Date.parse(record.createdAt))) return undefined
  if (record.status !== 'kept' && record.status !== 'proposed') return undefined
  if (typeof record.enabled !== 'boolean') return undefined
  return {
    memoryId: record.memoryId,
    text: boundedMemoryText(record.text),
    scope: record.scope,
    workspaceId: record.workspaceId,
    workspaceName: record.workspaceName,
    by: { name: by.name, ...(by.teammateId === undefined ? {} : { teammateId: by.teammateId }) },
    ...(record.missionId === undefined ? {} : { missionId: record.missionId }),
    createdAt: record.createdAt,
    status: record.status,
    enabled: record.enabled,
    // Untrusted like everything else here: a name that is not a slug is
    // dropped, which turns the memory back into an ordinary unnamed one
    // rather than filing it under something unmatchable.
    ...(typeof record.name === 'string' && memoryName(record.name) !== undefined ? { name: memoryName(record.name) } : {}),
    ...(typeof record.updatedAt === 'string' && !Number.isNaN(Date.parse(record.updatedAt)) ? { updatedAt: record.updatedAt } : {}),
    ...(validMemoryText(record.previousText) ? { previousText: boundedMemoryText(record.previousText) } : {})
  }
}

export function parsedFile(text: string): StoredFile {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return EMPTY
  }
  if (typeof value !== 'object' || value === null) return EMPTY
  const record = value as Record<string, unknown>
  if (record.schemaVersion !== SCHEMA_VERSION || !Array.isArray(record.memories)) return EMPTY
  const memories: PublicMemory[] = []
  const seen = new Set<string>()
  for (const entry of record.memories) {
    const memory = parsedMemory(entry)
    if (memory === undefined || seen.has(memory.memoryId)) continue
    seen.add(memory.memoryId)
    memories.push(memory)
    if (memories.length >= MAX_MEMORIES) break
  }
  return { schemaVersion: SCHEMA_VERSION, memories }
}

/** The place a memory lives, for matching: a global one is everywhere, a folder one is its folder. */
const placeOf = (memory: Pick<PublicMemory, 'scope' | 'workspaceId'>): string =>
  memory.scope === 'global' ? 'global' : `ws:${memory.workspaceId}`

export function createMemoryStore(options: {
  readonly rootDirectory: string
  readonly now?: () => Date
  readonly createId?: () => string
}): MemoryStore {
  const rootDirectory = options.rootDirectory
  if (!isAbsolute(rootDirectory)) throw new Error('Memory store directory is invalid')
  const path = join(rootDirectory, 'memories.json')
  const now = options.now ?? (() => new Date())
  const createId = options.createId ?? (() => randomUUID().replace(/-/g, '').slice(0, 20))

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
    list(): Promise<readonly PublicMemory[]> {
      return serialize(async () => (await read()).memories)
    },

    briefed(workspaceId): Promise<readonly PublicMemory[]> {
      return serialize(async () =>
        (await read()).memories.filter(
          (memory) => memory.status === 'kept' && memory.enabled && (memory.scope === 'global' || memory.workspaceId === workspaceId)
        )
      )
    },

    add(input): Promise<{ readonly memory: PublicMemory; readonly created: boolean; readonly rewritten?: boolean }> {
      return serialize(async () => {
        if (!validMemoryText(input.text)) throw new Error('A memory is one line of text, up to 300 characters.')
        if (!validScope(input.scope)) throw new Error('A memory is for this folder or for everywhere.')
        const text = boundedMemoryText(input.text)
        const file = await read()
        const place = placeOf({ scope: input.scope, workspaceId: input.workspaceId })
        const named = typeof input.name === 'string' ? memoryName(input.name) : undefined
        /*
         * A NAME REPLACES; text only ever de-duplicates.
         *
         * Same name, same place: this is the current value of a fact the
         * teammate is restating, so the row is rewritten in place and keeps
         * its id, its author and its birthday. That is what stops a store
         * accumulating eight copies of "orb round N" (measured on Colin's
         * store, 2026-09-21: 26 of 89 memories were in a near-duplicate
         * pair, most of them that shape).
         *
         * Rewritten IN PLACE rather than superseded into a second row,
         * because the point is that the store stops growing. One step of the
         * old text rides along so a person can see what moved.
         */
        if (named !== undefined) {
          const held = file.memories.find((memory) => placeOf(memory) === place && memory.name === named)
          if (held !== undefined) {
            // Nothing actually changed: do not churn the file or lose the
            // real `updatedAt` by writing the same words again.
            if (memoryKey(held.text) === memoryKey(text)) return { memory: held, created: false }
            const rewritten: PublicMemory = {
              ...held,
              text,
              previousText: held.text,
              updatedAt: now().toISOString(),
              // The turn that CHANGED it, not the turn that first wrote it.
              // The thread draws a memory card under the turn it belongs to,
              // and as this memory now reads, it belongs to this one.
              ...(input.missionId === undefined ? {} : { missionId: input.missionId }),
              // A rewrite of a kept memory stays kept; one the person has
              // not seen yet stays proposed. The name does not smuggle a
              // proposed memory past the person.
              status: held.status
            }
            await write({
              ...file,
              memories: file.memories.map((memory) => (memory.memoryId === held.memoryId ? rewritten : memory))
            })
            // Not created, but not nothing either: a rewrite is the event the
            // person most wants to see, and reporting it as "already knew
            // that" is how a memory silently changes under them.
            return { memory: rewritten, created: false, rewritten: true }
          }
        }
        const key = memoryKey(text)
        const existing = file.memories.find((memory) => placeOf(memory) === place && memoryKey(memory.text) === key)
        if (existing !== undefined) return { memory: existing, created: false }
        if (file.memories.length >= MAX_MEMORIES) {
          throw new Error(`Locust keeps at most ${String(MAX_MEMORIES)} memories. Forget some first.`)
        }
        const memory: PublicMemory = {
          memoryId: `mem_${createId()}`,
          text,
          scope: input.scope,
          workspaceId: input.workspaceId,
          workspaceName: input.workspaceName.slice(0, MAX_WORKSPACE_NAME_LENGTH),
          by: { name: input.by.name, ...(input.by.teammateId === undefined ? {} : { teammateId: input.by.teammateId }) },
          ...(input.missionId === undefined ? {} : { missionId: input.missionId }),
          createdAt: now().toISOString(),
          status: input.status,
          enabled: true,
          ...(named === undefined ? {} : { name: named })
        }
        await write({ ...file, memories: [...file.memories, memory] })
        return { memory, created: true }
      })
    },

    update(input): Promise<PublicMemory> {
      return serialize(async () => {
        if (!safeId(input.memoryId)) throw new Error('That memory no longer exists.')
        const file = await read()
        const held = file.memories.find((memory) => memory.memoryId === input.memoryId)
        if (held === undefined) throw new Error('That memory no longer exists.')
        if (input.text !== undefined && !validMemoryText(input.text)) {
          throw new Error('A memory is one line of text, up to 300 characters.')
        }
        if (input.enabled !== undefined && typeof input.enabled !== 'boolean') throw new Error('That change could not be read.')
        const next: PublicMemory = {
          ...held,
          text: input.text === undefined ? held.text : boundedMemoryText(input.text),
          enabled: input.enabled === undefined ? held.enabled : input.enabled,
          status: input.keep === true ? 'kept' : held.status
        }
        await write({ ...file, memories: file.memories.map((memory) => (memory.memoryId === next.memoryId ? next : memory)) })
        return next
      })
    },

    remove(memoryId): Promise<void> {
      return serialize(async () => {
        if (!safeId(memoryId)) return
        const file = await read()
        await write({ ...file, memories: file.memories.filter((memory) => memory.memoryId !== memoryId) })
      })
    },

    forget(text, workspaceId): Promise<ForgetResult> {
      return serialize(async () => {
        const file = await read()
        // Only what this mission could be talking about: this folder's and
        // everywhere's. A memory in another project is not a candidate and
        // must not make a quote look ambiguous.
        const reachable = file.memories.filter(
          (memory) => memory.scope === 'global' || memory.workspaceId === workspaceId
        )
        const match = forgetMatch(text, reachable.map((memory) => memoryKey(memory.text)))
        if (match.refusal !== undefined) {
          return {
            removed: [],
            refusal: match.refusal,
            // Named, not counted: a teammate told "that was ambiguous" and
            // nothing else cannot write a better quote. These are what it
            // could have meant.
            candidates:
              match.refusal === 'ambiguous'
                ? reachable
                    .filter((memory) => forgetMatch(text, [memoryKey(memory.text)]).matched.length > 0)
                    .map((memory) => memory.text)
                : []
          }
        }
        const hit = new Set(match.matched)
        const goes = (memory: PublicMemory): boolean =>
          (memory.scope === 'global' || memory.workspaceId === workspaceId) && hit.has(memoryKey(memory.text))
        const removed = file.memories.filter(goes).map((memory) => memory.text)
        if (removed.length > 0) await write({ ...file, memories: file.memories.filter((memory) => !goes(memory)) })
        return { removed, refusal: undefined, candidates: [] }
      })
    },

    clear(input): Promise<number> {
      return serialize(async () => {
        const file = await read()
        const kept = input.workspaceId === undefined ? [] : file.memories.filter((memory) => memory.scope === 'global' || memory.workspaceId !== input.workspaceId)
        const removed = file.memories.length - kept.length
        if (removed > 0) await write({ ...file, memories: kept })
        return removed
      })
    }
  }
}
