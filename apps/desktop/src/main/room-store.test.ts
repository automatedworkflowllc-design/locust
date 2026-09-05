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
    expect(room).toEqual({ roomId: 'room_id1', name: 'Release', teammateIds: ['tm_wren', 'tm_booty'], createdAt: NOW, posts: [] })
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

    for (let index = 0; index < MAX_ROOM_POSTS; index += 1) {
      await rooms.addPost(room.roomId, { text: `post ${String(index)}`, missions: {} })
    }
    const full = await rooms.get(room.roomId)
    expect(full?.posts).toHaveLength(MAX_ROOM_POSTS)
    // 202 posts were made; the oldest two fell off, so the first kept is the third made.
    expect(full?.posts[0]?.text).toBe('post 0')
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

  it('reads a damaged file as empty rather than crashing, and skips a bad room but keeps the good ones', async () => {
    const rooms = await store()
    await writeFile(join(root, 'rooms.json'), '{not json', 'utf8')
    expect(await rooms.list()).toEqual([])
    const good = { roomId: 'room_a', name: 'A', teammateIds: ['tm_wren'], createdAt: NOW, posts: [] }
    const bad = { roomId: 'room_b', name: '', teammateIds: [], createdAt: NOW, posts: [] }
    expect(parsedFile(JSON.stringify({ schemaVersion: 1, rooms: [bad, good, good] })).rooms).toEqual([good])
  })
})
