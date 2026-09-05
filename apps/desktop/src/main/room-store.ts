import { randomUUID } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

import type { PublicRoom, RoomPost } from '../shared/ipc.js'
import { safeId } from './teammate-store.js'

/**
 * Rooms: a named set of teammates and the posts a person made to all of
 * them at once.
 *
 * A surface, not a new engine (docs/FEATURES-FROM-VISION-2026-09-05.md, #2).
 * A post starts one ordinary mission per teammate, on that teammate's own
 * route, owned by them; the room only remembers which missions a post
 * started, so the thread a person watches is read from the same records as
 * everything else. Nothing here reaches the ledger, and nothing in the
 * ledger changes shape for it.
 */

const SCHEMA_VERSION = 1 as const
const MAX_FILE_BYTES = 4 * 1024 * 1024
export const MAX_ROOMS = 32
export const MAX_ROOM_TEAMMATES = 8
export const MAX_ROOM_POSTS = 200
export const MAX_ROOM_NAME_LENGTH = 60
export const MAX_POST_LENGTH = 8_000

export interface RoomStore {
  list(): Promise<readonly PublicRoom[]>
  get(roomId: unknown): Promise<PublicRoom | undefined>
  create(input: { readonly name: unknown; readonly teammateIds: unknown }): Promise<PublicRoom>
  remove(roomId: unknown): Promise<void>
  /** Record a post and the missions it started. The newest post is last. */
  addPost(roomId: unknown, post: { readonly text: string; readonly missions: Readonly<Record<string, string>> }): Promise<RoomPost>
  /** A teammate who is gone leaves every room; a room left empty is removed. */
  removeTeammate(teammateId: unknown): Promise<void>
}

interface StoredFile {
  readonly schemaVersion: typeof SCHEMA_VERSION
  readonly rooms: readonly PublicRoom[]
}

const EMPTY: StoredFile = { schemaVersion: SCHEMA_VERSION, rooms: [] }

export function validRoomName(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > MAX_ROOM_NAME_LENGTH) return false
  // eslint-disable-next-line no-control-regex
  return !/[\u0000-\u001f\u007f]/.test(trimmed)
}

export function validTeammateIds(value: unknown): value is readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_ROOM_TEAMMATES) return false
  const seen = new Set<string>()
  for (const id of value) {
    if (!safeId(id) || seen.has(id)) return false
    seen.add(id)
  }
  return true
}

export function validPostText(value: unknown): value is string {
  return typeof value === 'string'
    && value.trim().length > 0
    && value.length <= MAX_POST_LENGTH
    // eslint-disable-next-line no-control-regex
    && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
}

function parsedPost(value: unknown): RoomPost | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  if (!safeId(record.postId) || !validPostText(record.text)) return undefined
  if (typeof record.at !== 'string' || Number.isNaN(Date.parse(record.at))) return undefined
  if (typeof record.missions !== 'object' || record.missions === null) return undefined
  const missions: Record<string, string> = {}
  for (const [teammateId, missionId] of Object.entries(record.missions as Record<string, unknown>)) {
    if (!safeId(teammateId) || !safeId(missionId)) return undefined
    missions[teammateId] = missionId
  }
  return { postId: record.postId, text: record.text, at: record.at, missions }
}

export function parsedRoom(value: unknown): PublicRoom | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  if (!safeId(record.roomId) || !validRoomName(record.name) || !validTeammateIds(record.teammateIds)) return undefined
  if (typeof record.createdAt !== 'string' || Number.isNaN(Date.parse(record.createdAt))) return undefined
  if (!Array.isArray(record.posts)) return undefined
  const posts: RoomPost[] = []
  for (const entry of record.posts) {
    const post = parsedPost(entry)
    if (post === undefined) return undefined
    posts.push(post)
    if (posts.length >= MAX_ROOM_POSTS) break
  }
  return {
    roomId: record.roomId,
    name: record.name.trim(),
    teammateIds: [...record.teammateIds],
    createdAt: record.createdAt,
    posts
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
  if (record.schemaVersion !== SCHEMA_VERSION || !Array.isArray(record.rooms)) return EMPTY
  const rooms: PublicRoom[] = []
  const seen = new Set<string>()
  for (const entry of record.rooms) {
    const room = parsedRoom(entry)
    if (room === undefined || seen.has(room.roomId)) continue
    seen.add(room.roomId)
    rooms.push(room)
    if (rooms.length >= MAX_ROOMS) break
  }
  return { schemaVersion: SCHEMA_VERSION, rooms }
}

export function createRoomStore(options: {
  readonly rootDirectory: string
  readonly now?: () => Date
  readonly createId?: () => string
}): RoomStore {
  const rootDirectory = options.rootDirectory
  if (!isAbsolute(rootDirectory)) throw new Error('Room store directory is invalid')
  const path = join(rootDirectory, 'rooms.json')
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
    list(): Promise<readonly PublicRoom[]> {
      return serialize(async () => (await read()).rooms)
    },

    get(roomId): Promise<PublicRoom | undefined> {
      return serialize(async () => (await read()).rooms.find((room) => room.roomId === roomId))
    },

    create(input): Promise<PublicRoom> {
      return serialize(async () => {
        if (!validRoomName(input.name)) throw new Error('Give the room a name of up to 60 characters.')
        if (!validTeammateIds(input.teammateIds)) {
          throw new Error(`A room needs between 1 and ${String(MAX_ROOM_TEAMMATES)} teammates.`)
        }
        const file = await read()
        if (file.rooms.length >= MAX_ROOMS) throw new Error(`Locust keeps at most ${String(MAX_ROOMS)} rooms.`)
        const room: PublicRoom = {
          roomId: `room_${createId()}`,
          name: input.name.trim(),
          teammateIds: [...input.teammateIds],
          createdAt: now().toISOString(),
          posts: []
        }
        await write({ ...file, rooms: [...file.rooms, room] })
        return room
      })
    },

    remove(roomId): Promise<void> {
      return serialize(async () => {
        const file = await read()
        const rooms = file.rooms.filter((room) => room.roomId !== roomId)
        if (rooms.length !== file.rooms.length) await write({ ...file, rooms })
      })
    },

    addPost(roomId, post): Promise<RoomPost> {
      return serialize(async () => {
        if (!validPostText(post.text)) throw new Error('Write something to post.')
        const file = await read()
        const room = file.rooms.find((entry) => entry.roomId === roomId)
        if (room === undefined) throw new Error('That room no longer exists.')
        const missions: Record<string, string> = {}
        for (const [teammateId, missionId] of Object.entries(post.missions)) {
          if (safeId(teammateId) && safeId(missionId)) missions[teammateId] = missionId
        }
        const added: RoomPost = { postId: `post_${createId()}`, text: post.text, at: now().toISOString(), missions }
        // The newest MAX_ROOM_POSTS posts; the missions themselves are the
        // durable record, so an old post dropping off the room loses nothing.
        const posts = [...room.posts, added].slice(-MAX_ROOM_POSTS)
        await write({
          ...file,
          rooms: file.rooms.map((entry) => (entry.roomId === roomId ? { ...entry, posts } : entry))
        })
        return added
      })
    },

    removeTeammate(teammateId): Promise<void> {
      return serialize(async () => {
        const file = await read()
        let changed = false
        const rooms: PublicRoom[] = []
        for (const room of file.rooms) {
          if (!room.teammateIds.includes(teammateId as string)) {
            rooms.push(room)
            continue
          }
          changed = true
          const teammateIds = room.teammateIds.filter((id) => id !== teammateId)
          if (teammateIds.length > 0) rooms.push({ ...room, teammateIds })
        }
        if (changed) await write({ ...file, rooms })
      })
    }
  }
}
