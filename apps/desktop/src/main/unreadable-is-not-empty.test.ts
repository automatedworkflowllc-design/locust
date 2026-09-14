import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createRoomStore } from './room-store.js'

/**
 * An empty store and an unreadable one are different facts.
 *
 * Grok's beta drive, 2026-09-14, finding 1. With `rooms.json` replaced by a
 * directory, renaming a room that was ON SCREEN -- name, tasks and all --
 * answered **"That room does not exist."**
 *
 * The store read zero rooms, because its read swallowed every failure and
 * returned empty, and then concluded the room was not among them. The reading
 * anyone takes from "does not exist" is that it is gone. It was never read.
 *
 * This is why the careful second clause added to the renderer's catch in
 * 0.109.0 never appeared: the store had already produced a confident wrong
 * answer for the renderer to print. A rewritten sentence cannot save a layer
 * that is lying underneath it.
 */

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 5 })))
})

async function root(): Promise<string> {
  const made = await mkdtemp(join(tmpdir(), 'locust-rooms-'))
  roots.push(made)
  return made
}

describe('a rooms file that cannot be read', () => {
  it('never reports that a room does not exist', async () => {
    const dir = await root()
    // The exact shape Grok used: the file replaced by a directory.
    await mkdir(join(dir, 'rooms.json'), { recursive: true })
    const store = createRoomStore({ rootDirectory: dir })
    await expect(store.rename('room_abc', 'Release-renamed')).rejects.toThrow(/could not be read/i)
    await expect(store.rename('room_abc', 'Release-renamed')).rejects.not.toThrow(/does not exist/i)
  })

  it('says every room is as it was, because nothing was established', async () => {
    const dir = await root()
    await mkdir(join(dir, 'rooms.json'), { recursive: true })
    const store = createRoomStore({ rootDirectory: dir })
    await store.rename('room_abc', 'x').catch((error: Error) => {
      expect(error.message).toContain('nothing was changed')
      expect(error.message).toContain('as it was')
    })
  })

  it('still treats a file that is simply not there as empty', async () => {
    // A fresh profile has no rooms file and genuinely has no rooms. That must
    // keep working, or first launch becomes an error.
    const store = createRoomStore({ rootDirectory: await root() })
    expect(await store.list()).toEqual([])
  })

  it('still reports a genuinely missing room as missing', async () => {
    const dir = await root()
    await writeFile(join(dir, 'rooms.json'), JSON.stringify({ schemaVersion: 1, rooms: [] }), 'utf8')
    const store = createRoomStore({ rootDirectory: dir })
    // The file read fine and the room is not in it. THAT is "does not exist".
    await expect(store.rename('room_gone', 'x')).rejects.toThrow(/does not exist/i)
  })
})
