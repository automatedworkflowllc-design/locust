import { createHash, randomUUID } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

import type { MemoryScope, PublicForgottenMemory, PublicMemory } from '../shared/ipc.js'
import { boundedMemoryText, forgetMatch, memoryKey, memoryName } from '../shared/memory.js'
import { MAX_MERGED } from '../shared/memory-tidy.js'
import type { TidySuggestion } from '../shared/memory-tidy.js'
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
/** How long a forgotten memory can be put back (A1.8), and how many are held. */
export const FORGOTTEN_DAYS = 7
export const MAX_FORGOTTEN = 400

type Actor = { readonly teammateId?: string; readonly name: string }
const YOU: Actor = { name: 'you' }

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
  }): Promise<{
    readonly memory: PublicMemory
    readonly created: boolean
    readonly rewritten?: boolean
    /** A named rewrite in ask mode: proposed beside the kept memory, not applied. */
    readonly proposedChange?: boolean
  }>
  /** Edit the text, switch it on or off, or keep a proposed one. */
  update(input: { readonly memoryId: unknown; readonly text?: unknown; readonly enabled?: unknown; readonly keep?: unknown }): Promise<PublicMemory>
  /** A person's Remove, or `by` whoever else removed it. A kept memory goes to Recently forgotten. */
  remove(memoryId: unknown, by?: Actor): Promise<void>
  /**
   * Forget by quote, in this folder and everywhere.
   *
   * Says what HAPPENED rather than how many rows moved. A quote that matches
   * nothing, or matches several, removes nothing and is reported as such --
   * see `forgetMatch`. It used to return 0 for both, indistinguishable from
   * "there was nothing to do", and the caller only reported successes.
   */
  forget(
    text: string,
    workspaceId: string,
    context?: {
      readonly by: Actor
      readonly missionId?: string
      /** "Ask me first": propose the forget rather than apply it (0.315). */
      readonly ask?: boolean
    }
  ): Promise<ForgetResult>
  /** Everything for one folder, or everything. */
  clear(input: { readonly workspaceId?: string }): Promise<number>
  /** What the Memory screen shows, from ONE read: the memories, and Recently forgotten, newest first. */
  snapshot(): Promise<{ readonly memories: readonly PublicMemory[]; readonly forgotten: readonly PublicForgottenMemory[] }>
  /** Put a recently forgotten memory back, as it was (A1.8). */
  restore(memoryId: unknown): Promise<PublicMemory>
  /**
   * A tidy pass's suggestions (A1.2), each made a proposal for the person.
   * One that names a memory this folder does not keep is refused, with why.
   */
  proposeTidy(input: {
    readonly workspaceId: string
    readonly by: Actor
    readonly missionId?: string
    readonly suggestions: readonly TidySuggestion[]
  }): Promise<{ readonly proposed: number; readonly refused: readonly string[] }>
}

/** Keeping a suggestion whose memories changed after it was made. */
export const SUGGESTION_OUT_OF_DATE = 'What this suggestion would change has changed since it was made, so it was dropped. Everything is as it was.'

export interface ForgetResult {
  /** The memories actually removed, in the store's own words. */
  readonly removed: readonly string[]
  /**
   * Why nothing was removed. `ambiguous` carries the memories it could have
   * meant, so the teammate can quote one of them properly next time.
   */
  readonly refusal: 'nothing-matched' | 'ambiguous' | undefined
  readonly candidates: readonly string[]
  /** In ask mode: the kept memories now waiting for the person to agree they go. */
  readonly proposed?: readonly string[]
}

interface StoredFile {
  readonly schemaVersion: typeof SCHEMA_VERSION
  readonly memories: readonly PublicMemory[]
  /**
   * Kept memories that were forgotten, oldest first, for a Restore (A1.8).
   * Optional, so a file from before 0.316 reads as having none; an older
   * build that writes the file drops them, which loses only the undo.
   */
  readonly forgotten?: readonly PublicForgottenMemory[]
}

const EMPTY: StoredFile = { schemaVersion: SCHEMA_VERSION, memories: [] }

/**
 * What a write says when the file it would change cannot be read.
 *
 * An unreadable memory file (torn, a schema this build does not know, over
 * the size cap, locked for a moment) was read as EMPTY -- and since every
 * change here reads first, the next memory kept was written over it: every
 * memory gone, for one new one. The rooms and groups stores were fixed for
 * exactly this on 2026-09-16 and memories never were (harness review,
 * 2026-09-24). Now it fails closed, as they do.
 */
export const MEMORY_UNREADABLE = 'The memory file could not be read, so nothing was changed. Every memory is as it was.'

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
    ...(validMemoryText(record.previousText) ? { previousText: boundedMemoryText(record.previousText) } : {}),
    ...(parsedActor(record.updatedBy) === undefined ? {} : { updatedBy: parsedActor(record.updatedBy)! }),
    // A change waiting for the person. Only a proposal carries one.
    ...(record.status === 'proposed' && safeId(record.replaces) ? { replaces: record.replaces } : {}),
    ...(record.status === 'proposed' && safeId(record.forgets) ? { forgets: record.forgets } : {}),
    ...(record.status === 'proposed' && validMerges(record.merges) ? { merges: [...record.merges] } : {}),
    ...(record.status === 'proposed' && validMemoryText(record.reason) ? { reason: boundedMemoryText(record.reason) } : {}),
    ...(record.status === 'proposed' && typeof record.basis === 'string' && /^[0-9a-f]{16}$/.test(record.basis) ? { basis: record.basis } : {})
  }
}

function validMerges(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.length >= 2 && value.length <= MAX_MERGED && value.every((id) => safeId(id)) && new Set(value).size === value.length
}

/** A proposal that CHANGES a kept memory, rather than adding one. */
const isChange = (memory: PublicMemory): boolean =>
  memory.replaces !== undefined || memory.forgets !== undefined || memory.merges !== undefined

/**
 * The words of what a proposal would change, as a short fingerprint: the
 * hash gate (A1.2). Exact text, not the matching key -- a suggestion made
 * about one wording is not kept over a person's correction of it.
 */
const fingerprint = (memories: readonly PublicMemory[]): string =>
  createHash('sha256').update(memories.map((memory) => memory.text).join('\n'), 'utf8').digest('hex').slice(0, 16)

function parsedActor(value: unknown): Actor | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  if (typeof record.name !== 'string' || record.name.trim().length === 0 || record.name.length > 80) return undefined
  if (record.teammateId !== undefined && !safeId(record.teammateId)) return undefined
  return { name: record.name, ...(record.teammateId === undefined ? {} : { teammateId: record.teammateId }) }
}

/** One Recently-forgotten entry, as untrusted as any memory. Only a kept memory is ever held. */
export function parsedForgotten(value: unknown): PublicForgottenMemory | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  const memory = parsedMemory(record.memory)
  if (memory === undefined || memory.status !== 'kept') return undefined
  if (typeof record.forgottenAt !== 'string' || Number.isNaN(Date.parse(record.forgottenAt))) return undefined
  const by = parsedActor(record.forgottenBy)
  if (by === undefined) return undefined
  return { memory, forgottenAt: record.forgottenAt, forgottenBy: by }
}

/**
 * A MEMORY that does not parse is dropped; a FILE that does not parse is
 * unreadable, and says so (MEMORY_UNREADABLE) rather than passing for empty.
 */
export function parsedFile(text: string): StoredFile {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error(MEMORY_UNREADABLE)
  }
  if (typeof value !== 'object' || value === null) throw new Error(MEMORY_UNREADABLE)
  const record = value as Record<string, unknown>
  if (record.schemaVersion !== SCHEMA_VERSION || !Array.isArray(record.memories)) throw new Error(MEMORY_UNREADABLE)
  const memories: PublicMemory[] = []
  const seen = new Set<string>()
  for (const entry of record.memories) {
    const memory = parsedMemory(entry)
    if (memory === undefined || seen.has(memory.memoryId)) continue
    seen.add(memory.memoryId)
    memories.push(memory)
    if (memories.length >= MAX_MEMORIES) break
  }
  // Recently forgotten is optional; present but not a list is a file this
  // build does not understand, and says so like any other.
  if (record.forgotten !== undefined && !Array.isArray(record.forgotten)) throw new Error(MEMORY_UNREADABLE)
  const forgotten: PublicForgottenMemory[] = []
  for (const entry of Array.isArray(record.forgotten) ? (record.forgotten as unknown[]) : []) {
    const held = parsedForgotten(entry)
    if (held !== undefined) forgotten.push(held)
  }
  return { schemaVersion: SCHEMA_VERSION, memories, ...(forgotten.length === 0 ? {} : { forgotten: forgotten.slice(-MAX_FORGOTTEN) }) }
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
    let text: string
    try {
      text = await readFile(path, 'utf8')
    } catch (error) {
      // No file yet is the empty store; anything else is a file that could
      // not be read, and must not be written over as if it were empty.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return EMPTY
      throw new Error(MEMORY_UNREADABLE)
    }
    if (Buffer.byteLength(text, 'utf8') > MAX_FILE_BYTES) throw new Error(MEMORY_UNREADABLE)
    return parsedFile(text)
  }

  /*
   * A proposed change whose memory is gone goes with it (0.315). A proposal
   * to change or to forget something nobody keeps any more is moot, and it
   * would sit on the Memory screen asking about nothing. Settled here, on
   * the one way into the file, so no path that removes a memory -- a
   * person's Remove, a forget, a kept forget, a clear -- can leave one.
   */
  const settled = (memories: readonly PublicMemory[]): readonly PublicMemory[] => {
    const ids = new Set(memories.map((memory) => memory.memoryId))
    return memories.filter((memory) =>
      memory.merges !== undefined ? memory.merges.every((id) => ids.has(id)) : !isChange(memory) || ids.has(memory.forgets ?? memory.replaces ?? '')
    )
  }

  /*
   * RECENTLY FORGOTTEN (A1.8): a kept memory that leaves the store -- a
   * person's Remove, a teammate's forget, a forget the person agreed to,
   * Forget everything -- is held FORGOTTEN_DAYS for a Restore, then gone.
   * A forget used to be final the moment it landed, including a teammate's
   * in "Keep and tell me", where nobody is asked; the harness review found
   * the undo missing (Rakazo keeps every revision; we keep one step back and
   * this). A proposal nobody kept is not held: it was never the person's.
   */
  const recentlyForgotten = (entries: readonly PublicForgottenMemory[] | undefined): readonly PublicForgottenMemory[] => {
    const since = now().getTime() - FORGOTTEN_DAYS * 24 * 60 * 60 * 1000
    return (entries ?? []).filter((entry) => Date.parse(entry.forgottenAt) >= since).slice(-MAX_FORGOTTEN)
  }
  const bin = (file: StoredFile, gone: readonly PublicMemory[], by: Actor): readonly PublicForgottenMemory[] => [
    ...(file.forgotten ?? []),
    ...gone
      .filter((memory) => memory.status === 'kept')
      .map((memory) => ({
        memory,
        forgottenAt: now().toISOString(),
        forgottenBy: { name: by.name, ...(by.teammateId === undefined ? {} : { teammateId: by.teammateId }) }
      }))
  ]

  const write = async (file: StoredFile): Promise<void> => {
    await mkdir(rootDirectory, { recursive: true, mode: 0o700 })
    const temporary = `${path}.${randomUUID()}.tmp`
    const handle = await open(temporary, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL, 0o600)
    const settledFile: StoredFile = { ...file, memories: settled(file.memories), forgotten: recentlyForgotten(file.forgotten) }
    try {
      await handle.writeFile(`${JSON.stringify(settledFile, null, 2)}\n`, 'utf8')
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

    add(input): Promise<{ readonly memory: PublicMemory; readonly created: boolean; readonly rewritten?: boolean; readonly proposedChange?: boolean }> {
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
            /*
             * "ASK ME FIRST" COVERS A REWRITE (0.315). A kept memory stays as
             * it is, and briefed; the new wording waits beside it as a
             * proposal that REPLACES it once the person keeps it. In ask mode
             * a named rewrite used to change a kept memory at once -- the one
             * promise of that mode it did not keep (harness review,
             * 2026-09-24, reported #3). A later rewrite before the person
             * answers updates the same proposal.
             */
            if (held.status === 'kept' && input.status === 'proposed') {
              const pending = file.memories.find((memory) => memory.status === 'proposed' && memory.replaces === held.memoryId)
              if (pending !== undefined) {
                if (memoryKey(pending.text) === memoryKey(text)) return { memory: pending, created: false }
                const again: PublicMemory = {
                  ...pending,
                  text,
                  basis: fingerprint([held]),
                  updatedAt: now().toISOString(),
                  ...(input.missionId === undefined ? {} : { missionId: input.missionId })
                }
                await write({ ...file, memories: file.memories.map((memory) => (memory.memoryId === pending.memoryId ? again : memory)) })
                return { memory: again, created: false, proposedChange: true }
              }
              if (file.memories.length >= MAX_MEMORIES) {
                throw new Error(`Locust keeps at most ${String(MAX_MEMORIES)} memories. Forget some first.`)
              }
              const proposal: PublicMemory = {
                memoryId: `mem_${createId()}`,
                text,
                scope: held.scope,
                workspaceId: held.workspaceId,
                workspaceName: held.workspaceName,
                by: { name: input.by.name, ...(input.by.teammateId === undefined ? {} : { teammateId: input.by.teammateId }) },
                ...(input.missionId === undefined ? {} : { missionId: input.missionId }),
                createdAt: now().toISOString(),
                status: 'proposed',
                enabled: true,
                replaces: held.memoryId,
                basis: fingerprint([held])
              }
              await write({ ...file, memories: [...file.memories, proposal] })
              return { memory: proposal, created: true, proposedChange: true }
            }
            const rewritten: PublicMemory = {
              ...held,
              text,
              previousText: held.text,
              updatedAt: now().toISOString(),
              // Credit where the words came from (A1.6); `by` stays who first kept it.
              updatedBy: { name: input.by.name, ...(input.by.teammateId === undefined ? {} : { teammateId: input.by.teammateId }) },
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
        /*
         * KEEPING A PROPOSED CHANGE APPLIES IT (0.315): a rewrite replaces
         * the kept memory's wording (one step back kept, as always), a
         * forget removes it. Either way the proposal itself goes.
         */
        if (input.keep === true && held.status === 'proposed' && isChange(held)) {
          const others = file.memories.filter((memory) => memory.memoryId !== held.memoryId)
          const sources = (held.merges ?? [held.forgets ?? held.replaces ?? '']).map((id) => file.memories.find((memory) => memory.memoryId === id))
          /*
           * THE HASH GATE (A1.2). A suggestion is about the words it saw.
           * Kept after they changed -- the person edited one, a teammate
           * rewrote it, it was forgotten -- it would overwrite or remove
           * something it never read. Refused, and the suggestion goes.
           * A proposal made before 0.317 has no basis and is not gated.
           */
          const present = sources.filter((source): source is PublicMemory => source !== undefined)
          const stale = held.basis !== undefined && (present.length !== sources.length || fingerprint(present) !== held.basis)
          if (stale || (held.merges !== undefined && present.length < 2)) {
            await write({ ...file, memories: others })
            throw new Error(SUGGESTION_OUT_OF_DATE)
          }
          if (held.merges !== undefined) {
            // The first keeps its place, its name and its one step back;
            // the rest go to Recently forgotten, by whoever suggested it.
            const [first, ...rest] = present as [PublicMemory, ...PublicMemory[]]
            const merged: PublicMemory = {
              ...first,
              text: held.text,
              previousText: first.text,
              updatedAt: now().toISOString(),
              updatedBy: held.by,
              ...(held.missionId === undefined ? {} : { missionId: held.missionId })
            }
            const going = new Set(rest.map((memory) => memory.memoryId))
            await write({
              ...file,
              memories: others.filter((memory) => !going.has(memory.memoryId)).map((memory) => (memory.memoryId === first.memoryId ? merged : memory)),
              forgotten: bin(file, rest, held.by)
            })
            return merged
          }
          if (held.forgets !== undefined) {
            const gone = file.memories.find((memory) => memory.memoryId === held.forgets)
            await write({
              ...file,
              memories: others.filter((memory) => memory.memoryId !== held.forgets),
              forgotten: bin(file, gone === undefined ? [] : [gone], held.by)
            })
            return gone ?? held
          }
          const target = file.memories.find((memory) => memory.memoryId === held.replaces)
          if (target === undefined) {
            // What it would have replaced is gone: it becomes a memory of its own.
            const own: { -readonly [K in keyof PublicMemory]: PublicMemory[K] } = { ...held, status: 'kept' }
            delete own.replaces
            await write({ ...file, memories: file.memories.map((memory) => (memory.memoryId === held.memoryId ? own : memory)) })
            return own
          }
          const changed: PublicMemory = {
            ...target,
            text: held.text,
            previousText: target.text,
            updatedAt: now().toISOString(),
            updatedBy: held.by,
            ...(held.missionId === undefined ? {} : { missionId: held.missionId })
          }
          await write({ ...file, memories: others.map((memory) => (memory.memoryId === target.memoryId ? changed : memory)) })
          return changed
        }
        const text = input.text === undefined ? held.text : boundedMemoryText(input.text)
        const next: PublicMemory = {
          ...held,
          text,
          enabled: input.enabled === undefined ? held.enabled : input.enabled,
          status: input.keep === true ? 'kept' : held.status,
          /*
           * A person's edit keeps one step back too, as a teammate's rewrite
           * does. It did not, so "Put it back" on the Memory screen would
           * have thrown the teammate's version away for good; now it is a
           * swap, and pressing it again undoes it (harness review,
           * 2026-09-24 -- Rakazo keeps every revision; one step is ours).
           */
          ...(text === held.text ? {} : { previousText: held.text, updatedAt: now().toISOString(), updatedBy: YOU })
        }
        await write({ ...file, memories: file.memories.map((memory) => (memory.memoryId === next.memoryId ? next : memory)) })
        return next
      })
    },

    remove(memoryId, by): Promise<void> {
      return serialize(async () => {
        if (!safeId(memoryId)) return
        const file = await read()
        const gone = file.memories.filter((memory) => memory.memoryId === memoryId)
        if (gone.length === 0) return
        await write({ ...file, memories: file.memories.filter((memory) => memory.memoryId !== memoryId), forgotten: bin(file, gone, by ?? YOU) })
      })
    },

    forget(text, workspaceId, context): Promise<ForgetResult> {
      return serialize(async () => {
        const file = await read()
        // Only what this mission could be talking about: this folder's and
        // everywhere's. A memory in another project is not a candidate and
        // must not make a quote look ambiguous. Nor is a proposed CHANGE:
        // it carries the words of the memory it points at, and is not one.
        const reachable = file.memories.filter(
          (memory) => (memory.scope === 'global' || memory.workspaceId === workspaceId) && !isChange(memory)
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
          (memory.scope === 'global' || memory.workspaceId === workspaceId) && !isChange(memory) && hit.has(memoryKey(memory.text))
        /*
         * "ASK ME FIRST" COVERS A FORGET (0.315): a kept memory stays, and
         * briefed, with a proposal beside it to remove it. It used to go at
         * once in ask mode too (reported #3). A memory still only proposed
         * -- nobody kept it -- can simply go.
         */
        if (context?.ask === true) {
          const ask = context
          const targets = file.memories.filter(goes)
          const dropped = new Set(targets.filter((target) => target.status === 'proposed').map((target) => target.memoryId))
          const proposals: PublicMemory[] = targets
            .filter((target) => target.status === 'kept' && !file.memories.some((memory) => memory.forgets === target.memoryId))
            .map((target) => ({
              memoryId: `mem_${createId()}`,
              text: target.text,
              scope: target.scope,
              workspaceId: target.workspaceId,
              workspaceName: target.workspaceName,
              by: { name: ask.by.name, ...(ask.by.teammateId === undefined ? {} : { teammateId: ask.by.teammateId }) },
              ...(ask.missionId === undefined ? {} : { missionId: ask.missionId }),
              createdAt: now().toISOString(),
              status: 'proposed' as const,
              enabled: true,
              forgets: target.memoryId,
              basis: fingerprint([target])
            }))
          if (proposals.length > 0 || dropped.size > 0) {
            await write({ ...file, memories: [...file.memories.filter((memory) => !dropped.has(memory.memoryId)), ...proposals] })
          }
          return {
            removed: targets.filter((target) => dropped.has(target.memoryId)).map((target) => target.text),
            refusal: undefined,
            candidates: [],
            proposed: targets.filter((target) => target.status === 'kept').map((target) => target.text)
          }
        }
        const gone = file.memories.filter(goes)
        const removed = gone.map((memory) => memory.text)
        if (removed.length > 0) {
          await write({ ...file, memories: file.memories.filter((memory) => !goes(memory)), forgotten: bin(file, gone, context?.by ?? { name: 'a teammate' }) })
        }
        return { removed, refusal: undefined, candidates: [] }
      })
    },

    clear(input): Promise<number> {
      return serialize(async () => {
        const file = await read()
        const kept = input.workspaceId === undefined ? [] : file.memories.filter((memory) => memory.scope === 'global' || memory.workspaceId !== input.workspaceId)
        const removed = file.memories.length - kept.length
        if (removed > 0) {
          const staying = new Set(kept)
          await write({ ...file, memories: kept, forgotten: bin(file, file.memories.filter((memory) => !staying.has(memory)), YOU) })
        }
        return removed
      })
    },

    snapshot() {
      return serialize(async () => {
        const file = await read()
        return { memories: file.memories, forgotten: [...recentlyForgotten(file.forgotten)].reverse() }
      })
    },

    restore(memoryId): Promise<PublicMemory> {
      return serialize(async () => {
        const file = await read()
        const entry = safeId(memoryId) ? recentlyForgotten(file.forgotten).find((one) => one.memory.memoryId === memoryId) : undefined
        if (entry === undefined) throw new Error('That memory is no longer in Recently forgotten.')
        const rest = (file.forgotten ?? []).filter((one) => one !== entry)
        const place = placeOf(entry.memory)
        // Already remembered in the same words, in the same place: nothing to
        // put back, and a second copy would be briefed twice.
        const same = file.memories.find((memory) => placeOf(memory) === place && memoryKey(memory.text) === memoryKey(entry.memory.text))
        if (same !== undefined) {
          await write({ ...file, forgotten: rest })
          return same
        }
        if (file.memories.length >= MAX_MEMORIES) {
          throw new Error(`Locust keeps at most ${String(MAX_MEMORIES)} memories. Forget some first.`)
        }
        const back: { -readonly [K in keyof PublicMemory]: PublicMemory[K] } = { ...entry.memory, status: 'kept' }
        // Its name was given to a newer memory meanwhile: it comes back
        // without one, rather than as a second memory under the same name.
        if (back.name !== undefined && file.memories.some((memory) => placeOf(memory) === place && memory.name === back.name)) delete back.name
        if (file.memories.some((memory) => memory.memoryId === back.memoryId)) back.memoryId = `mem_${createId()}`
        await write({ ...file, memories: [...file.memories, back], forgotten: rest })
        return back
      })
    },

    proposeTidy(input) {
      return serialize(async () => {
        const file = await read()
        const reachable = (id: string): PublicMemory | undefined =>
          file.memories.find(
            (memory) => memory.memoryId === id && memory.status === 'kept' && (memory.scope === 'global' || memory.workspaceId === input.workspaceId)
          )
        const added: PublicMemory[] = []
        const rewritten = new Map<string, PublicMemory>()
        const refused: string[] = []
        const pending = (test: (memory: PublicMemory) => boolean): PublicMemory | undefined =>
          [...file.memories, ...added].find((memory) => memory.status === 'proposed' && test(memory))
        const proposal = (sources: readonly PublicMemory[], text: string, what: Partial<PublicMemory>): PublicMemory => ({
          memoryId: `mem_${createId()}`,
          text,
          scope: sources[0]!.scope,
          workspaceId: sources[0]!.workspaceId,
          workspaceName: sources[0]!.workspaceName,
          by: { name: input.by.name, ...(input.by.teammateId === undefined ? {} : { teammateId: input.by.teammateId }) },
          ...(input.missionId === undefined ? {} : { missionId: input.missionId }),
          createdAt: now().toISOString(),
          status: 'proposed',
          enabled: true,
          basis: fingerprint(sources),
          ...what
        })
        for (const suggestion of input.suggestions) {
          if (file.memories.length + added.length >= MAX_MEMORIES) {
            refused.push(`Locust keeps at most ${String(MAX_MEMORIES)} memories, so the rest were not kept. Forget some first.`)
            break
          }
          if (suggestion.kind === 'merge') {
            const found = suggestion.ids.map(reachable)
            if (found.some((memory) => memory === undefined)) {
              refused.push('A suggested merge named a memory this folder does not keep.')
              continue
            }
            const sources = found as PublicMemory[]
            if (new Set(sources.map(placeOf)).size > 1) {
              refused.push('A suggested merge joined memories kept in different places -- this folder and everywhere.')
              continue
            }
            const same = new Set(suggestion.ids)
            if (pending((memory) => memory.merges !== undefined && memory.merges.length === same.size && memory.merges.every((id) => same.has(id)))) continue
            added.push(proposal(sources, suggestion.text, { merges: [...suggestion.ids] }))
            continue
          }
          const target = reachable(suggestion.id)
          if (target === undefined) {
            refused.push(`A suggestion to ${suggestion.kind === 'retire' ? 'forget' : 'change'} a memory named one this folder does not keep.`)
            continue
          }
          if (suggestion.kind === 'retire') {
            if (pending((memory) => memory.forgets === target.memoryId)) continue
            added.push(proposal([target], target.text, { forgets: target.memoryId, reason: suggestion.reason }))
            continue
          }
          if (suggestion.text === target.text) continue
          const waiting = pending((memory) => memory.replaces === target.memoryId)
          if (waiting !== undefined) {
            // Its own earlier rewrite, still unanswered: the newer words win.
            if (!added.includes(waiting)) {
              rewritten.set(waiting.memoryId, {
                ...waiting,
                text: suggestion.text,
                basis: fingerprint([target]),
                updatedAt: now().toISOString(),
                ...(input.missionId === undefined ? {} : { missionId: input.missionId })
              })
            }
            continue
          }
          added.push(proposal([target], suggestion.text, { replaces: target.memoryId }))
        }
        if (added.length > 0 || rewritten.size > 0) {
          await write({ ...file, memories: [...file.memories.map((memory) => rewritten.get(memory.memoryId) ?? memory), ...added] })
        }
        return { proposed: added.length + rewritten.size, refused }
      })
    }
  }
}
