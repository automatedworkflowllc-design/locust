import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createRoomStore, MAX_ROOM_POSTS, MAX_ROOM_TEAMMATES, parsedFile, validPostText, validRoomName } from './room-store.js'

const NOW = '2026-09-05T05:00:00.000Z'
let root: string

afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true })
})

async function store() {
  root = await mkdtemp(join(tmpdir(), 'locust-rooms-'))
  let ids = 0
  return createRoomStore({ rootDirectory: root, now: () => new Date(NOW), createId: () => `id${String(++ids)}` })
}

describe('a room', () => {
  it('is a named set of teammates, kept on disk, with no posts to begin with', async () => {
    const rooms = await store()
    const room = await rooms.create({ name: '  Release  ', teammateIds: ['tm_wren', 'tm_booty'] })
    expect(room).toEqual({ roomId: 'room_id1', name: 'Release', teammateIds: ['tm_wren', 'tm_booty'], createdAt: NOW, posts: [], tasks: [] })
    expect(await rooms.list()).toEqual([room])
    expect(JSON.parse(await readFile(join(root, 'rooms.json'), 'utf8'))).toMatchObject({ schemaVersion: 1, rooms: [room] })
    // A second store over the same folder reads it back.
    expect(await createRoomStore({ rootDirectory: root }).get('room_id1')).toEqual(room)
  })

  it('refuses a bad name, no teammates, a repeated teammate, or too many', async () => {
    const rooms = await store()
    await expect(rooms.create({ name: '', teammateIds: ['tm_wren'] })).rejects.toThrow(/name/)
    await expect(rooms.create({ name: 'x'.repeat(61), teammateIds: ['tm_wren'] })).rejects.toThrow(/name/)
    await expect(rooms.create({ name: 'Release', teammateIds: [] })).rejects.toThrow(/between 1 and/)
    await expect(rooms.create({ name: 'Release', teammateIds: ['tm_wren', 'tm_wren'] })).rejects.toThrow(/between 1 and/)
    await expect(
      rooms.create({ name: 'Release', teammateIds: Array.from({ length: MAX_ROOM_TEAMMATES + 1 }, (_, i) => `tm_${String(i)}`) })
    ).rejects.toThrow(/between 1 and/)
    expect(validRoomName('ok')).toBe(true)
    expect(validRoomName('bad' + String.fromCharCode(0))).toBe(false)
  })

  it('records a post with the missions it started, newest last, and keeps the last two hundred', async () => {
    const rooms = await store()
    const room = await rooms.create({ name: 'Release', teammateIds: ['tm_wren', 'tm_booty'] })
    const post = await rooms.addPost(room.roomId, { text: 'Which files mention the release date?', missions: { tm_wren: 'mission_w', tm_booty: 'mission_b' } })
    expect(post).toEqual({ postId: 'post_id2', text: 'Which files mention the release date?', at: NOW, missions: { tm_wren: 'mission_w', tm_booty: 'mission_b' } })
    await rooms.addPost(room.roomId, { text: 'And the version?', missions: { tm_wren: 'mission_w2' } })
    const read = await rooms.get(room.roomId)
    expect(read?.posts.map((entry) => entry.text)).toEqual(['Which files mention the release date?', 'And the version?'])
    // A teammate whose run could not start is simply absent from the post.
    expect(read?.posts[1]?.missions).toEqual({ tm_wren: 'mission_w2' })

    // The file is filled to the cap in one write (two hundred separate
    // write-and-rename cycles time out on a busy disk), then one more is added.
    const path = join(root, 'rooms.json')
    const file = JSON.parse(await readFile(path, 'utf8')) as { rooms: { posts: unknown[] }[] }
    for (let index = 0; index < MAX_ROOM_POSTS - 2; index += 1) {
      file.rooms[0]?.posts.push({ postId: `post_seed${String(index)}`, text: `post ${String(index)}`, at: NOW, missions: {} })
    }
    await writeFile(path, JSON.stringify(file))
    const reopened = createRoomStore({ rootDirectory: root, now: () => new Date(NOW), createId: () => 'last' })
    expect((await reopened.get(room.roomId))?.posts).toHaveLength(MAX_ROOM_POSTS)
    await reopened.addPost(room.roomId, { text: 'post 198', missions: {} })
    const full = await reopened.get(room.roomId)
    expect(full?.posts).toHaveLength(MAX_ROOM_POSTS)
    // 201 posts were made; the oldest fell off, so the first kept is the second made.
    expect(full?.posts[0]?.text).toBe('And the version?')
    expect(full?.posts[MAX_ROOM_POSTS - 1]?.text).toBe('post 198')
  })

  it('refuses an empty post, a post to a room that is gone, and malformed mission ids', async () => {
    const rooms = await store()
    const room = await rooms.create({ name: 'Release', teammateIds: ['tm_wren'] })
    await expect(rooms.addPost(room.roomId, { text: '   ', missions: {} })).rejects.toThrow(/Write something/)
    await expect(rooms.addPost('room_nope', { text: 'hi', missions: {} })).rejects.toThrow(/no longer exists/)
    const post = await rooms.addPost(room.roomId, { text: 'hi', missions: { 'bad id': 'mission_x', tm_wren: 'mission_ok' } })
    expect(post.missions).toEqual({ tm_wren: 'mission_ok' })
    expect(validPostText('x'.repeat(8_001))).toBe(false)
  })

  it('drops a teammate who is gone from every room, and removes a room left empty', async () => {
    const rooms = await store()
    await rooms.create({ name: 'Pair', teammateIds: ['tm_wren', 'tm_booty'] })
    await rooms.create({ name: 'Solo', teammateIds: ['tm_booty'] })
    await rooms.removeTeammate('tm_booty')
    const left = await rooms.list()
    expect(left.map((room) => [room.name, room.teammateIds])).toEqual([['Pair', ['tm_wren']]])
  })

  it('removes a room by id and ignores an unknown one', async () => {
    const rooms = await store()
    const room = await rooms.create({ name: 'Release', teammateIds: ['tm_wren'] })
    await rooms.remove('room_nope')
    expect(await rooms.list()).toHaveLength(1)
    await rooms.remove(room.roomId)
    expect(await rooms.list()).toHaveLength(0)
  })

  it('treats a file that does not parse as unreadable, refuses to write over it, and skips a bad room but keeps the good ones', async () => {
    // A torn file used to read as empty -- and since every write reads first,
    // the next save would have replaced it with an empty one. Same ruling as
    // the groups store took on 2026-09-16; the directory case below it has
    // said "could not be read" since Grok's finding of the 14th.
    const rooms = await store()
    const torn = '{not json'
    await writeFile(join(root, 'rooms.json'), torn, 'utf8')
    await expect(rooms.list()).rejects.toThrow('could not be read')
    await expect(rooms.create({ name: 'A', teammateIds: ['tm_wren'] })).rejects.toThrow('could not be read')
    expect(await readFile(join(root, 'rooms.json'), 'utf8')).toBe(torn)
    const good = { roomId: 'room_a', name: 'A', teammateIds: ['tm_wren'], createdAt: NOW, posts: [], tasks: [] }
    const bad = { roomId: 'room_b', name: '', teammateIds: [], createdAt: NOW, posts: [] }
    expect(parsedFile(JSON.stringify({ schemaVersion: 1, rooms: [bad, good, good] })).rooms).toEqual([good])
  })
})

describe('the board', () => {
  const ROSTER = [
    { teammateId: 'tm_wren', name: 'Wren' },
    { teammateId: 'tm_booty', name: 'Booty' },
    { teammateId: 'tm_atlas', name: 'Atlas' }
  ]
  const WREN = { teammateId: 'tm_wren', name: 'Wren', missionId: 'mission_w' }

  it('moves as a teammate’s block says: claim creates or takes, done finishes, handoff gives, new adds', async () => {
    const rooms = await store()
    const room = await rooms.create({ name: 'Release', teammateIds: ['tm_wren', 'tm_booty'] })
    const first = await rooms.applyTaskOps(
      room.roomId,
      [
        { kind: 'claim', text: 'Write the release notes' },
        { kind: 'new', text: 'Verify the installer signs' },
        { kind: 'handoff', text: 'Check the version string', to: 'booty' }
      ],
      WREN,
      ROSTER
    )
    expect(first.refused).toEqual([])
    expect(first.changed).toEqual([
      'Wren took on "Write the release notes".',
      'Wren added "Verify the installer signs".',
      'Wren handed "Check the version string" to Booty.'
    ])
    let board = (await rooms.get(room.roomId))!.tasks
    expect(board.map((task) => [task.text, task.ownerId, task.state, task.missionId])).toEqual([
      ['Write the release notes', 'tm_wren', 'in-hand', 'mission_w'],
      ['Verify the installer signs', undefined, 'open', 'mission_w'],
      ['Check the version string', 'tm_booty', 'open', 'mission_w']
    ])

    // Matching is blind to case and punctuation, so quoting the board loosely still hits it.
    const second = await rooms.applyTaskOps(room.roomId, [{ kind: 'done', text: 'write the RELEASE notes!' }], WREN, ROSTER)
    expect(second.changed).toEqual(['Wren finished "Write the release notes".'])
    board = (await rooms.get(room.roomId))!.tasks
    expect(board[0]).toMatchObject({ state: 'done', ownerId: 'tm_wren' })
  })

  it('refuses what it cannot honour, by name, without dropping the rest', async () => {
    const rooms = await store()
    const room = await rooms.create({ name: 'Release', teammateIds: ['tm_wren', 'tm_booty'] })
    await rooms.applyTaskOps(room.roomId, [{ kind: 'new', text: 'Ship it' }], WREN, ROSTER)
    const result = await rooms.applyTaskOps(
      room.roomId,
      [
        { kind: 'new', text: 'Ship it' },
        { kind: 'done', text: 'Not on the board' },
        // Atlas is on the roster but not in this room.
        { kind: 'handoff', text: 'Ship it', to: 'Atlas' },
        { kind: 'claim', text: 'Ship it' }
      ],
      WREN,
      ROSTER
    )
    expect(result.refused).toEqual([
      'Wren: "Ship it" is already on the board.',
      'Wren marked "Not on the board" done, but it is not on the board.',
      'Wren handed "Ship it" to "Atlas", who is not in this room.'
    ])
    expect(result.changed).toEqual(['Wren took on "Ship it".'])
    // A done task cannot be claimed back by a block; a person reopens it.
    await rooms.applyTaskOps(room.roomId, [{ kind: 'done', text: 'Ship it' }], WREN, ROSTER)
    const again = await rooms.applyTaskOps(room.roomId, [{ kind: 'claim', text: 'Ship it' }], WREN, ROSTER)
    expect(again.refused).toEqual(['Wren tried to claim "Ship it", which is done.'])
  })

  it('lets a person add, assign, finish, reopen and remove', async () => {
    const rooms = await store()
    const room = await rooms.create({ name: 'Release', teammateIds: ['tm_wren', 'tm_booty'] })
    let next = await rooms.updateTask({ roomId: room.roomId, op: 'add', text: 'Write the notes', ownerId: 'tm_booty' })
    const task = next.tasks[0]!
    expect(task).toMatchObject({ text: 'Write the notes', ownerId: 'tm_booty', state: 'in-hand', missionId: undefined })
    next = await rooms.updateTask({ roomId: room.roomId, op: 'assign', taskId: task.taskId, ownerId: undefined })
    expect(next.tasks[0]).toMatchObject({ ownerId: undefined, state: 'open' })
    next = await rooms.updateTask({ roomId: room.roomId, op: 'done', taskId: task.taskId })
    expect(next.tasks[0]).toMatchObject({ state: 'done' })
    next = await rooms.updateTask({ roomId: room.roomId, op: 'reopen', taskId: task.taskId })
    expect(next.tasks[0]).toMatchObject({ state: 'open' })
    await expect(rooms.updateTask({ roomId: room.roomId, op: 'add', text: 'write the notes' })).rejects.toThrow(/already on the board/)
    await expect(rooms.updateTask({ roomId: room.roomId, op: 'assign', taskId: task.taskId, ownerId: 'tm_atlas' })).rejects.toThrow(/in the room/)
    next = await rooms.updateTask({ roomId: room.roomId, op: 'remove', taskId: task.taskId })
    expect(next.tasks).toEqual([])
    await expect(rooms.updateTask({ roomId: room.roomId, op: 'done', taskId: task.taskId })).rejects.toThrow(/no longer on the board/)
  })

  it('reads tasks back from disk, and an older file without them as a room with none', async () => {
    const rooms = await store()
    const room = await rooms.create({ name: 'Release', teammateIds: ['tm_wren'] })
    await rooms.updateTask({ roomId: room.roomId, op: 'add', text: 'Persist me' })
    expect((await createRoomStore({ rootDirectory: root }).get(room.roomId))?.tasks.map((task) => task.text)).toEqual(['Persist me'])
    const old = { roomId: 'room_old', name: 'Old', teammateIds: ['tm_wren'], createdAt: NOW, posts: [] }
    expect(parsedFile(JSON.stringify({ schemaVersion: 1, rooms: [old] })).rooms[0]?.tasks).toEqual([])
  })
})
