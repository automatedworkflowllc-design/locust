import { randomUUID } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

import type { PublicRoom, RoomPost, RoomTask, RoomTaskRequest } from '../shared/ipc.js'
import { boundedTaskText, taskKey } from '../shared/room-task.js'
import type { TaskOp } from '../shared/room-task.js'
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
export const MAX_ROOM_TASKS = 100

export interface RoomStore {
  list(): Promise<readonly PublicRoom[]>
  get(roomId: unknown): Promise<PublicRoom | undefined>
  create(input: { readonly name: unknown; readonly teammateIds: unknown }): Promise<PublicRoom>
  remove(roomId: unknown): Promise<void>
  /** Record a post and the missions it started. The newest post is last. */
  addPost(roomId: unknown, post: { readonly text: string; readonly missions: Readonly<Record<string, string>> }): Promise<RoomPost>
  /** A teammate who is gone leaves every room; a room left empty is removed. */
  removeTeammate(teammateId: unknown): Promise<void>
  /**
   * A teammate's reply moved the board. Ops are matched to tasks by text;
   * `claim` and `new` create a task that does not exist; `handoff` needs a
   * name that is in the room. Returns what changed and what was refused,
   * in words, so the room can say so.
   */
  applyTaskOps(
    roomId: unknown,
    ops: readonly TaskOp[],
    actor: { readonly teammateId: string; readonly name: string; readonly missionId: string },
    roster: readonly { readonly teammateId: string; readonly name: string }[]
  ): Promise<{ readonly changed: readonly string[]; readonly refused: readonly string[] }>
  /** A person moving the board from the room screen. */
  updateTask(request: RoomTaskRequest): Promise<PublicRoom>
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

function parsedTask(value: unknown): RoomTask | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  if (!safeId(record.taskId)) return undefined
  if (typeof record.text !== 'string' || boundedTaskText(record.text).length === 0) return undefined
  if (record.state !== 'open' && record.state !== 'in-hand' && record.state !== 'done') return undefined
  if (record.ownerId !== undefined && !safeId(record.ownerId)) return undefined
  if (record.missionId !== undefined && !safeId(record.missionId)) return undefined
  if (typeof record.at !== 'string' || Number.isNaN(Date.parse(record.at))) return undefined
  return {
    taskId: record.taskId,
    text: boundedTaskText(record.text),
    ownerId: record.ownerId,
    state: record.state,
    missionId: record.missionId,
    at: record.at
  }
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
  // Tasks arrived after rooms did; a file without them is a room with none.
  const tasks: RoomTask[] = []
  if (record.tasks !== undefined) {
    if (!Array.isArray(record.tasks)) return undefined
    for (const entry of record.tasks) {
      const task = parsedTask(entry)
      if (task === undefined) return undefined
      tasks.push(task)
      if (tasks.length >= MAX_ROOM_TASKS) break
    }
  }
  return {
    roomId: record.roomId,
    name: record.name.trim(),
    teammateIds: [...record.teammateIds],
    createdAt: record.createdAt,
    posts,
    tasks
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
          posts: [],
          tasks: []
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

    applyTaskOps(roomId, ops, actor, roster): Promise<{ readonly changed: readonly string[]; readonly refused: readonly string[] }> {
      return serialize(async () => {
        const file = await read()
        const room = file.rooms.find((entry) => entry.roomId === roomId)
        if (room === undefined) return { changed: [], refused: ['That room no longer exists.'] }
        const changed: string[] = []
        const refused: string[] = []
        let tasks = [...room.tasks]
        const at = now().toISOString()
        const find = (text: string): number => tasks.findIndex((task) => taskKey(task.text) === taskKey(text))
        for (const op of ops) {
          const index = find(op.text)
          if (op.kind === 'new') {
            if (index >= 0) {
              refused.push(`${actor.name}: "${op.text}" is already on the board.`)
              continue
            }
            if (tasks.length >= MAX_ROOM_TASKS) {
              refused.push(`The board is full (${String(MAX_ROOM_TASKS)} tasks).`)
              continue
            }
            tasks.push({ taskId: `task_${createId()}`, text: op.text, ownerId: undefined, state: 'open', missionId: actor.missionId, at })
            changed.push(`${actor.name} added "${op.text}".`)
            continue
          }
          if (op.kind === 'claim') {
            if (index < 0) {
              if (tasks.length >= MAX_ROOM_TASKS) {
                refused.push(`The board is full (${String(MAX_ROOM_TASKS)} tasks).`)
                continue
              }
              tasks.push({ taskId: `task_${createId()}`, text: op.text, ownerId: actor.teammateId, state: 'in-hand', missionId: actor.missionId, at })
              changed.push(`${actor.name} took on "${op.text}".`)
              continue
            }
            const task = tasks[index]!
            if (task.state === 'done') {
              refused.push(`${actor.name} tried to claim "${task.text}", which is done.`)
              continue
            }
            tasks[index] = { ...task, ownerId: actor.teammateId, state: 'in-hand', missionId: actor.missionId, at }
            changed.push(`${actor.name} took on "${task.text}".`)
            continue
          }
          if (op.kind === 'done') {
            if (index < 0) {
              refused.push(`${actor.name} marked "${op.text}" done, but it is not on the board.`)
              continue
            }
            const task = tasks[index]!
            tasks[index] = { ...task, ownerId: task.ownerId ?? actor.teammateId, state: 'done', missionId: actor.missionId, at }
            changed.push(`${actor.name} finished "${task.text}".`)
            continue
          }
          // handoff
          const target = roster.find(
            (entry) => room.teammateIds.includes(entry.teammateId) && entry.name.toLowerCase() === op.to.toLowerCase()
          )
          if (target === undefined) {
            refused.push(`${actor.name} handed "${op.text}" to "${op.to}", who is not in this room.`)
            continue
          }
          if (index < 0) {
            if (tasks.length >= MAX_ROOM_TASKS) {
              refused.push(`The board is full (${String(MAX_ROOM_TASKS)} tasks).`)
              continue
            }
            tasks.push({ taskId: `task_${createId()}`, text: op.text, ownerId: target.teammateId, state: 'open', missionId: actor.missionId, at })
          } else {
            const task = tasks[index]!
            tasks[index] = { ...task, ownerId: target.teammateId, state: 'open', missionId: actor.missionId, at }
          }
          changed.push(`${actor.name} handed "${op.text}" to ${target.name}.`)
        }
        if (changed.length > 0) {
          await write({ ...file, rooms: file.rooms.map((entry) => (entry.roomId === roomId ? { ...entry, tasks } : entry)) })
        }
        return { changed, refused }
      })
    },

    updateTask(request): Promise<PublicRoom> {
      return serialize(async () => {
        const file = await read()
        const room = file.rooms.find((entry) => entry.roomId === request.roomId)
        if (room === undefined) throw new Error('That room no longer exists.')
        const at = now().toISOString()
        let tasks = [...room.tasks]
        if (request.op === 'add') {
          const text = boundedTaskText(typeof request.text === 'string' ? request.text : '')
          if (text.length === 0) throw new Error('Write the task first.')
          if (tasks.some((task) => taskKey(task.text) === taskKey(text))) throw new Error('That task is already on the board.')
          if (tasks.length >= MAX_ROOM_TASKS) throw new Error(`The board is full (${String(MAX_ROOM_TASKS)} tasks).`)
          const ownerId = typeof request.ownerId === 'string' && room.teammateIds.includes(request.ownerId) ? request.ownerId : undefined
          tasks.push({ taskId: `task_${createId()}`, text, ownerId, state: ownerId === undefined ? 'open' : 'in-hand', missionId: undefined, at })
        } else {
          const index = tasks.findIndex((task) => task.taskId === request.taskId)
          if (index < 0) throw new Error('That task is no longer on the board.')
          const task = tasks[index]!
          if (request.op === 'assign') {
            const ownerId = typeof request.ownerId === 'string' ? request.ownerId : undefined
            if (ownerId !== undefined && !room.teammateIds.includes(ownerId)) throw new Error('Only a teammate in the room can own its task.')
            tasks[index] = { ...task, ownerId, state: task.state === 'done' ? 'done' : ownerId === undefined ? 'open' : 'in-hand', at }
          } else if (request.op === 'done') {
            tasks[index] = { ...task, state: 'done', at }
          } else if (request.op === 'reopen') {
            tasks[index] = { ...task, state: task.ownerId === undefined ? 'open' : 'in-hand', at }
          } else if (request.op === 'remove') {
            tasks = tasks.filter((entry) => entry.taskId !== request.taskId)
          } else {
            throw new Error('That is not a way to move a task.')
          }
        }
        const next = { ...room, tasks }
        await write({ ...file, rooms: file.rooms.map((entry) => (entry.roomId === request.roomId ? next : entry)) })
        return next
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
