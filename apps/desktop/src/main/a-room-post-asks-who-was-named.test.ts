import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { roomHistorySection } from '../shared/room-history.js'
import { createRoomStore, recipientsOf } from './room-store.js'

/**
 * ASK ONE TEAMMATE IN A ROOM (0.371).
 *
 * A post asked everyone, so "Wren, say more about your second point" ran
 * every member. Now a post can be put to the members the person names; the
 * rest are not run, the post records who it was put to, and the room's
 * history tells the others it was not theirs.
 */
const ROOM = ['tm_wren', 'tm_pip', 'tm_booty']

describe('who a post asks', () => {
  it('is everyone when nobody is named', () => {
    expect(recipientsOf(ROOM, undefined)).toEqual({ ok: true, asked: ROOM })
    expect(recipientsOf(ROOM, [])).toEqual({ ok: true, asked: ROOM })
    expect(recipientsOf(ROOM, 'tm_wren')).toEqual({ ok: true, asked: ROOM })
  })

  it('is only who was named, once each, in the room’s order', () => {
    expect(recipientsOf(ROOM, ['tm_wren'])).toEqual({ ok: true, asked: ['tm_wren'], to: ['tm_wren'] })
    expect(recipientsOf(ROOM, ['tm_booty', 'tm_wren', 'tm_booty'])).toEqual({ ok: true, asked: ['tm_wren', 'tm_booty'], to: ['tm_wren', 'tm_booty'] })
  })

  it('leaves out what is not a member, and is everyone when everyone was named', () => {
    expect(recipientsOf(ROOM, ['tm_wren', 'tm_stranger', 7, '../x'])).toEqual({ ok: true, asked: ['tm_wren'], to: ['tm_wren'] })
    expect(recipientsOf(ROOM, ['tm_pip', 'tm_booty', 'tm_wren'])).toEqual({ ok: true, asked: ROOM })
  })

  it('is refused, never widened to everyone, when nobody named is in the room', () => {
    const refused = recipientsOf(ROOM, ['tm_stranger'])
    expect(refused.ok).toBe(false)
    expect(refused.ok ? '' : refused.message).toMatch(/nothing was posted/)
  })
})

let root: string
afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true })
})

describe('a post put to someone, on disk', () => {
  it('keeps who it was put to -- members only -- and reads it back', async () => {
    root = await mkdtemp(join(tmpdir(), 'locust-rooms-to-'))
    let ids = 0
    const rooms = createRoomStore({ rootDirectory: root, now: () => new Date('2026-09-26T12:00:00.000Z'), createId: () => `id${String(++ids)}` })
    const room = await rooms.create({ name: 'Release', teammateIds: ['tm_wren', 'tm_pip'] })
    const post = await rooms.addPost(room.roomId, { text: 'Say more.', missions: {}, queued: ['tm_wren'], to: ['tm_wren', 'tm_stranger', 'tm_wren'] })
    expect(post.to).toEqual(['tm_wren'])
    const everyone = await rooms.addPost(room.roomId, { text: 'All of you.', missions: {} })
    expect(everyone.to).toBeUndefined()
    const again = createRoomStore({ rootDirectory: root })
    expect((await again.get(room.roomId))?.posts.map((entry) => entry.to)).toEqual([['tm_wren'], undefined])
  })

  it('reads a malformed list as everyone, and keeps the post', async () => {
    root = await mkdtemp(join(tmpdir(), 'locust-rooms-to-'))
    const rooms = createRoomStore({ rootDirectory: root, now: () => new Date('2026-09-26T12:00:00.000Z'), createId: () => 'x1' })
    const room = await rooms.create({ name: 'Release', teammateIds: ['tm_wren', 'tm_pip'] })
    await rooms.addPost(room.roomId, { text: 'Say more.', missions: { tm_wren: 'mission_w' }, to: ['tm_wren'] })
    const file = join(root, 'rooms.json')
    const stored = JSON.parse(await readFile(file, 'utf8')) as { rooms: { posts: { to?: unknown }[] }[] }
    const written = stored.rooms[0]?.posts[0]
    expect(written?.to).toEqual(['tm_wren'])
    if (written !== undefined) written.to = 'tm_wren'
    await writeFile(file, JSON.stringify(stored))
    const read = await createRoomStore({ rootDirectory: root }).get(room.roomId)
    expect(read?.posts).toHaveLength(1)
    expect(read?.posts[0]?.to).toBeUndefined()
    expect(read?.posts[0]?.missions).toEqual({ tm_wren: 'mission_w' })
  })
})

describe('the room’s history, after a post put to someone', () => {
  const history = {
    roomName: 'Release',
    posts: [
      { text: 'Say more.', to: [{ teammateId: 'tm_wren', name: 'Wren' }], answers: [{ teammateId: 'tm_wren', name: 'Wren', text: 'More.' }] },
      { text: 'You two?', to: [{ teammateId: 'tm_wren', name: 'Wren' }, { teammateId: 'tm_pip', name: 'Pip' }], answers: [] },
      { text: 'Everyone.', answers: [] }
    ]
  }

  it('says who it was put to, from the reader’s side', () => {
    const toPip = roomHistorySection(history, 'tm_pip') ?? ''
    expect(toPip).toContain('The person wrote to Wren: Say more.')
    expect(toPip).toContain('The person wrote to Wren and you: You two?')
    expect(toPip).toContain('The person wrote: Everyone.')
    const toWren = roomHistorySection(history, 'tm_wren') ?? ''
    expect(toWren).toContain('The person wrote to you: Say more.')
    expect(toWren).toContain('You answered: More.')
  })
})
