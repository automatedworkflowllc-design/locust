import { randomUUID } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

import type { PublicGroup } from '../shared/ipc.js'
import { isTeammateRoute } from './teammate-store.js'

/**
 * Groups: named sets of conversations, per folder.
 *
 * Colin ruled the model on 2026-09-15 — *"just grouped and ungrouped, and
 * ungrouped will have most recent as first"* — and then took the stronger
 * version of the design agent's flag: a group is not only a folder. It
 * carries **standing instructions** and a **default route**, so filing a
 * conversation into one buys something rather than costing a tidy-up. A
 * folder that only sorts is a tax people stop paying in week two.
 *
 * `instructions` and `route` are read and written from the start even though
 * nothing sets them yet. They are part of what a group IS, and a store that
 * learned about them later would have to migrate a file that people already
 * had.
 *
 * MEMBERSHIP LIVES HERE, not on the mission. The ledger is an append-only
 * record of what was asked and what happened; which folder someone later
 * dropped a conversation into is neither — the same reason a renamed title
 * lives beside ownership rather than in the record.
 */

/** Past this the file is treated as unreadable rather than parsed. */
const MAX_FILE_BYTES = 4 * 1024 * 1024
/** Enough to organise by, few enough that the sidebar stays a list. */
export const MAX_GROUPS = 64
export const MAX_GROUP_NAME_LENGTH = 60
/** Bounded on read and on write, because the file has a size cliff. */
export const MAX_GROUP_MEMBERS = 5_000
export const MAX_GROUP_INSTRUCTIONS_LENGTH = 4_000

/** What a caller sees when the file cannot be read at all. */
export const GROUPS_UNREADABLE = 'GROUPS_UNREADABLE'

interface StoredFile {
  readonly schemaVersion: 1
  readonly groups: readonly PublicGroup[]
  /**
   * Which group each conversation is in, and WHEN it joined.
   *
   * The time is not bookkeeping. Instructions brief from the moment of
   * joining onward and never retroactively, so the thread has to say where
   * that boundary is -- "the turns above this genuinely were not briefed".
   * A line at the top of a thread would claim they were.
   *
   * A bare string is the shape this file had before joining was timed, and
   * is read as a membership whose moment is unknown.
   */
  readonly members: Readonly<Record<string, GroupMembership>>
  /**
   * Memberships that ENDED, by conversation, oldest first.
   *
   * Recorded when a conversation leaves a group, is moved to another, or
   * its group is removed. The thread draws the mirror of the join line at
   * that moment -- "<Group>'s instructions no longer apply from here" --
   * and the turns after it genuinely were not briefed. The group's name and
   * words are copied in, so the line stays true after the group changes or
   * is gone. Absent in files from before 0.171.0, read as empty.
   */
  readonly left: Readonly<Record<string, readonly LeftMembership[]>>
}

export interface LeftMembership {
  readonly groupId: string
  readonly name: string
  readonly instructions: string
  readonly at?: string
  readonly until: string
}

/** Leaves kept per conversation; older ones fall off the front. */
export const MAX_LEFT_PER_CONVERSATION = 8

export interface GroupMembership {
  readonly groupId: string
  /** ISO, or absent for a membership recorded before this was kept. */
  readonly at?: string
}

const EMPTY: StoredFile = { schemaVersion: 1, groups: [], members: {}, left: {} }

const safeId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)

const cleanName = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  // One line. A name with a newline in it is a name that breaks a row.
  const single = value.replace(/\s+/g, ' ').trim().slice(0, MAX_GROUP_NAME_LENGTH)
  return single.length === 0 ? undefined : single
}

/**
 * Read as untrusted, like every other file in this profile.
 *
 * A RECORD that does not parse is DROPPED rather than taken, and never
 * raised: one bad group must not cost someone the rest of them.
 *
 * A FILE that does not parse is a different fact, and it is UNREADABLE, not
 * empty. Astra, 2026-09-16, with the file cut off mid-array: the store read
 * it as no groups, the sidebar drew no groups, and the next write would have
 * saved that emptiness over whatever the file used to hold. That is the
 * "subsequent saves silently replace unreadable state" she asked us not to
 * allow, and it was exactly one `return EMPTY` away.
 */
function parsedFile(text: string): StoredFile {
  let record: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null) throw new Error(GROUPS_UNREADABLE)
    record = parsed as Record<string, unknown>
  } catch {
    throw new Error(GROUPS_UNREADABLE)
  }

  const groups: PublicGroup[] = []
  const rawGroups = Array.isArray(record.groups) ? record.groups : []
  for (const entry of rawGroups) {
    if (groups.length >= MAX_GROUPS) break
    if (typeof entry !== 'object' || entry === null) continue
    const group = entry as Record<string, unknown>
    const name = cleanName(group.name)
    if (!safeId(group.groupId) || name === undefined) continue
    if (groups.some((held) => held.groupId === group.groupId)) continue
    groups.push({
      groupId: group.groupId,
      name,
      createdAt: typeof group.createdAt === 'string' ? group.createdAt : new Date(0).toISOString(),
      instructions:
        typeof group.instructions === 'string'
          ? group.instructions.slice(0, MAX_GROUP_INSTRUCTIONS_LENGTH)
          : '',
      // A route is a whole object elsewhere; here it is carried opaquely and
      // validated where routes are validated, so this file never becomes a
      // second opinion on what a route may be.
      ...(typeof group.route === 'object' && group.route !== null
        ? { route: group.route as PublicGroup['route'] }
        : {})
    })
  }

  const members: Record<string, GroupMembership> = {}
  if (typeof record.members === 'object' && record.members !== null) {
    for (const [missionId, held] of Object.entries(record.members as Record<string, unknown>)) {
      if (Object.keys(members).length >= MAX_GROUP_MEMBERS) break
      // A bare string is the pre-0.152.0 shape: a membership with no moment.
      const groupId = typeof held === 'string'
        ? held
        : typeof held === 'object' && held !== null
          ? (held as Record<string, unknown>).groupId
          : undefined
      const at = typeof held === 'object' && held !== null && typeof (held as Record<string, unknown>).at === 'string'
        ? ((held as Record<string, unknown>).at as string)
        : undefined
      if (!safeId(missionId) || !safeId(groupId)) continue
      // A membership pointing at a group that is gone is not a membership.
      // Dropping it here is what makes removing a group safe: the file does
      // not have to be swept, and nothing later reads a dangling id.
      if (!groups.some((group) => group.groupId === groupId)) continue
      members[missionId] = at === undefined ? { groupId } : { groupId, at }
    }
  }

  const left: Record<string, readonly LeftMembership[]> = {}
  if (typeof record.left === 'object' && record.left !== null) {
    for (const [missionId, held] of Object.entries(record.left as Record<string, unknown>)) {
      if (Object.keys(left).length >= MAX_GROUP_MEMBERS) break
      if (!safeId(missionId) || !Array.isArray(held)) continue
      const entries: LeftMembership[] = []
      for (const entry of held) {
        if (typeof entry !== 'object' || entry === null) continue
        const raw = entry as Record<string, unknown>
        const name = cleanName(raw.name)
        if (!safeId(raw.groupId) || name === undefined || typeof raw.until !== 'string') continue
        entries.push({
          groupId: raw.groupId,
          name,
          instructions: typeof raw.instructions === 'string' ? raw.instructions.slice(0, MAX_GROUP_INSTRUCTIONS_LENGTH) : '',
          ...(typeof raw.at === 'string' ? { at: raw.at } : {}),
          until: raw.until
        })
      }
      if (entries.length > 0) left[missionId] = entries.slice(-MAX_LEFT_PER_CONVERSATION)
    }
  }

  return { schemaVersion: 1, groups, members, left }
}

/**
 * The file with one conversation's current membership recorded as ended.
 * Nothing changes when it is in no group, or the group is unknown.
 */
function withLeave(file: StoredFile, missionId: string, until: string): StoredFile {
  const held = file.members[missionId]
  if (held === undefined) return file
  const group = file.groups.find((entry) => entry.groupId === held.groupId)
  if (group === undefined) return file
  const entry: LeftMembership = {
    groupId: group.groupId,
    name: group.name,
    instructions: group.instructions,
    ...(held.at === undefined ? {} : { at: held.at }),
    until
  }
  const before = file.left[missionId] ?? []
  // Bounded on write as on read; a conversation nobody has recorded a leave
  // for yet does not get one past the map's own bound.
  if (before.length === 0 && Object.keys(file.left).length >= MAX_GROUP_MEMBERS) return file
  return { ...file, left: { ...file.left, [missionId]: [...before, entry].slice(-MAX_LEFT_PER_CONVERSATION) } }
}

export interface GroupStore {
  list(): Promise<{
    readonly groups: readonly PublicGroup[]
    readonly members: Readonly<Record<string, GroupMembership>>
    readonly left: Readonly<Record<string, readonly LeftMembership[]>>
  }>
  create(name: unknown): Promise<PublicGroup>
  rename(groupId: unknown, name: unknown): Promise<PublicGroup>
  /** Removing a group never removes a conversation; they become Ungrouped. */
  remove(groupId: unknown): Promise<void>
  /** `undefined` takes a conversation out of whatever group it is in. */
  assign(missionId: unknown, groupId: unknown): Promise<void>
  /** What every conversation in this group is briefed with. Empty clears it. */
  setInstructions(groupId: unknown, instructions: unknown): Promise<void>
  /** What a conversation filed here begins on. `undefined` clears it. */
  setRoute(groupId: unknown, route: unknown): Promise<void>
}

export function createGroupStore(options: {
  readonly rootDirectory: string
  readonly createId?: () => string
  readonly now?: () => Date
}): GroupStore {
  const rootDirectory = options.rootDirectory
  if (!isAbsolute(rootDirectory)) throw new Error('Group store directory is invalid')
  const path = join(rootDirectory, 'groups.json')
  const createId = options.createId ?? (() => `grp_${randomUUID().replace(/-/g, '').slice(0, 20)}`)
  const now = options.now ?? (() => new Date())

  let queue: Promise<unknown> = Promise.resolve()
  const serialize = <T>(task: () => Promise<T>): Promise<T> => {
    const next = queue.then(task, task)
    queue = next.then(
      () => undefined,
      () => undefined
    )
    return next
  }

  /**
   * An empty store and an UNREADABLE one are different facts.
   *
   * Grok's audit of 2026-09-14 found what conflating them costs: with
   * `rooms.json` replaced by a directory, a rename read zero rooms and told
   * the person "That room does not exist" — under a window that was showing
   * the room at that moment. It was never read, not gone. Same ruling here,
   * at the same layer, before the sentence above it can be wrong.
   */
  const read = async (): Promise<StoredFile> => {
    let text: string
    try {
      text = await readFile(path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return EMPTY
      throw new Error(GROUPS_UNREADABLE)
    }
    if (Buffer.byteLength(text, 'utf8') > MAX_FILE_BYTES) throw new Error(GROUPS_UNREADABLE)
    return parsedFile(text)
  }

  const write = async (file: StoredFile): Promise<void> => {
    await mkdir(rootDirectory, { recursive: true, mode: 0o700 })
    // Written whole to a temporary file and renamed over, so a crash mid-write
    // leaves the old file rather than half of a new one.
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
    list() {
      return serialize(async () => {
        const file = await read()
        return { groups: file.groups, members: file.members, left: file.left }
      })
    },

    create(name): Promise<PublicGroup> {
      return serialize(async () => {
        const clean = cleanName(name)
        if (clean === undefined) throw new Error('A group needs a name')
        const file = await read()
        if (file.groups.length >= MAX_GROUPS) throw new Error('Too many groups')
        const group: PublicGroup = {
          groupId: createId(),
          name: clean,
          createdAt: now().toISOString(),
          instructions: ''
        }
        await write({ ...file, groups: [...file.groups, group] })
        return group
      })
    },

    rename(groupId, name): Promise<PublicGroup> {
      return serialize(async () => {
        const clean = cleanName(name)
        if (clean === undefined) throw new Error('A group needs a name')
        const file = await read()
        const held = file.groups.find((group) => group.groupId === groupId)
        if (held === undefined) throw new Error('That group does not exist')
        const renamed: PublicGroup = { ...held, name: clean }
        await write({
          ...file,
          groups: file.groups.map((group) => (group.groupId === held.groupId ? renamed : group))
        })
        return renamed
      })
    },

    remove(groupId): Promise<void> {
      return serialize(async () => {
        const file = await read()
        if (!file.groups.some((group) => group.groupId === groupId)) return
        const groups = file.groups.filter((group) => group.groupId !== groupId)
        /*
         * The conversations stay and become Ungrouped.
         *
         * Removing a container must never remove its contents -- a person
         * tidying their sidebar is not asking to delete their work, and
         * there is exactly one place in this app where records are destroyed
         * and it asks twice first.
         */
        // Every conversation in it LEAVES it, and the thread says so from
        // the next turn on: the words stop briefing the moment the group
        // is gone, and the line has to say where.
        const until = now().toISOString()
        let next = file
        for (const [missionId, held] of Object.entries(file.members)) {
          if (held.groupId === groupId) next = withLeave(next, missionId, until)
        }
        const members = Object.fromEntries(
          Object.entries(next.members).filter(([, held]) => held.groupId !== groupId)
        )
        await write({ ...next, groups, members })
      })
    },

    assign(missionId, groupId): Promise<void> {
      return serialize(async () => {
        if (!safeId(missionId)) throw new Error('Conversation id is invalid')
        const file = await read()
        if (groupId === undefined || groupId === null) {
          if (!(missionId in file.members)) return
          const next = withLeave(file, missionId, now().toISOString())
          const { [missionId]: _gone, ...members } = next.members
          await write({ ...next, members })
          return
        }
        if (!safeId(groupId)) throw new Error('Group id is invalid')
        if (!file.groups.some((group) => group.groupId === groupId)) {
          throw new Error('That group does not exist')
        }
        // Bounded on write as well as on read: unbounded growth crosses the
        // size cliff, and past it the file reads as empty and the next write
        // saves that emptiness over everything.
        if (file.members[missionId] === undefined && Object.keys(file.members).length >= MAX_GROUP_MEMBERS) {
          throw new Error('Too many conversations in groups')
        }
        const at = now().toISOString()
        // Moving between groups is a leave and a join at the same moment;
        // re-assigning to the group it is already in is neither.
        const next = file.members[missionId]?.groupId === groupId ? file : withLeave(file, missionId, at)
        await write({
          ...next,
          members: { ...next.members, [missionId]: { groupId, at } }
        })
      })
    },

    setRoute(groupId, route): Promise<void> {
      return serialize(async () => {
        // Validated where routes are validated, and refused rather than
        // trimmed: a route with an absurd field is written into a command
        // line later, and this file must never be the thing that let it in.
        if (route !== undefined && !isTeammateRoute(route)) throw new Error('That route is not one a mission can start on')
        const file = await read()
        const held = file.groups.find((group) => group.groupId === groupId)
        if (held === undefined) throw new Error('That group does not exist')
        const { route: _gone, ...bare } = held
        await write({
          ...file,
          groups: file.groups.map((group) =>
            group.groupId === held.groupId ? (route === undefined ? bare : { ...bare, route }) : group
          )
        })
      })
    },

    setInstructions(groupId, instructions): Promise<void> {
      return serialize(async () => {
        if (typeof instructions !== 'string') throw new Error('Instructions must be text')
        const file = await read()
        const held = file.groups.find((group) => group.groupId === groupId)
        if (held === undefined) throw new Error('That group does not exist')
        /*
         * Bounded, and trimmed rather than refused when empty: clearing the
         * instructions is how a group stops briefing, and that has to be as
         * easy as setting them. A group with no instructions is an ordinary
         * folder again, which is a real thing to want.
         */
        const text = instructions.trim().slice(0, MAX_GROUP_INSTRUCTIONS_LENGTH)
        await write({
          ...file,
          groups: file.groups.map((group) =>
            group.groupId === held.groupId ? { ...group, instructions: text } : group
          )
        })
      })
    }
  }
}
