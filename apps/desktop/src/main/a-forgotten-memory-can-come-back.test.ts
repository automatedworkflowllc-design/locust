import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { FORGOTTEN_DAYS, MAX_MEMORIES, MEMORY_UNREADABLE, createMemoryStore } from './memory-store.js'

/*
 * A FORGOTTEN MEMORY CAN COME BACK (A1.8).
 *
 * A forget -- the person's Remove, a teammate's forget in "Keep and tell me",
 * a forget the person agreed to, Forget everything -- was final the moment it
 * landed. Now every KEPT memory that leaves is held in Recently forgotten for
 * 7 days, with Restore. A proposal nobody kept is not held: it was never the
 * person's.
 */

const T0 = Date.parse('2026-09-24T12:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000
let root: string | undefined
let clock = T0

afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
  clock = T0
})

async function store() {
  root = await mkdtemp(join(tmpdir(), 'locust-forgotten-'))
  let ids = 0
  return createMemoryStore({ rootDirectory: root, now: () => new Date(clock), createId: () => `id${String(++ids)}` })
}

const YURT = { teammateId: 'tm_yurt', name: 'Yurt' }
const SHOP = { workspaceId: 'ws_shop', workspaceName: 'shop' }
const keep = (text: string, extra: Record<string, unknown> = {}) => ({ text, scope: 'workspace' as const, ...SHOP, by: YURT, status: 'kept' as const, ...extra })

describe('what goes to Recently forgotten', () => {
  it('a person’s Remove: held, by you -- and Restore puts it back exactly as it was, briefed again', async () => {
    const memories = await store()
    const { memory } = await memories.add(keep('Deploys go out on Fridays.', { name: 'deploy-day', missionId: 'mission_1' }))
    await memories.update({ memoryId: memory.memoryId, enabled: false })
    const before = (await memories.list())[0]!
    await memories.remove(memory.memoryId, { name: 'you' })

    const held = await memories.snapshot()
    expect(held.memories).toEqual([])
    expect(held.forgotten).toEqual([{ memory: before, forgottenAt: new Date(T0).toISOString(), forgottenBy: { name: 'you' } }])

    const back = await memories.restore(memory.memoryId)
    expect(back).toEqual(before)
    const after = await memories.snapshot()
    expect(after.memories).toEqual([before])
    expect(after.forgotten).toEqual([])
  })

  it('a teammate’s forget in "Keep and tell me": held, by that teammate', async () => {
    const memories = await store()
    await memories.add(keep('The API is on port 3000.'))
    const result = await memories.forget('The API is on port 3000', 'ws_shop', { by: { teammateId: 'tm_booty', name: 'Booty' } })
    expect(result.removed).toEqual(['The API is on port 3000.'])
    const held = await memories.snapshot()
    expect(held.forgotten.map((entry) => [entry.memory.text, entry.forgottenBy.name])).toEqual([['The API is on port 3000.', 'Booty']])
  })

  it('a forget the person agreed to ("Forget it"): held, by the teammate who asked', async () => {
    const memories = await store()
    await memories.add(keep('The API is on port 3000.'))
    await memories.forget('The API is on port 3000', 'ws_shop', { by: { teammateId: 'tm_booty', name: 'Booty' }, ask: true })
    const proposal = (await memories.list()).find((memory) => memory.status === 'proposed')!
    await memories.update({ memoryId: proposal.memoryId, keep: true })
    const held = await memories.snapshot()
    expect(held.memories).toEqual([])
    expect(held.forgotten.map((entry) => [entry.memory.text, entry.forgottenBy.name])).toEqual([['The API is on port 3000.', 'Booty']])
  })

  it('Forget everything for a folder: every kept one held, by you; the proposals are not', async () => {
    const memories = await store()
    await memories.add(keep('One.'))
    await memories.add(keep('Two.'))
    await memories.add({ ...keep('Three, only proposed.'), status: 'proposed' })
    await memories.add({ ...keep('Everywhere.'), scope: 'global' })
    expect(await memories.clear({ workspaceId: 'ws_shop' })).toBe(3)
    const held = await memories.snapshot()
    expect(held.memories.map((memory) => memory.text)).toEqual(['Everywhere.'])
    // Newest first; both at the same moment, so in the order they were kept.
    expect(held.forgotten.map((entry) => entry.memory.text).sort()).toEqual(['One.', 'Two.'])
    expect(held.forgotten.every((entry) => entry.forgottenBy.name === 'you')).toBe(true)
  })

  it('a proposal dropped -- Keep the old one, or a new one forgotten -- holds nothing', async () => {
    const memories = await store()
    const { memory } = await memories.add({ ...keep('Only proposed.'), status: 'proposed' })
    await memories.remove(memory.memoryId, { name: 'you' })
    expect((await memories.snapshot()).forgotten).toEqual([])
  })
})

describe('how long, and coming back', () => {
  it(`is held ${String(FORGOTTEN_DAYS)} days, then shown no more and dropped at the next write`, async () => {
    const memories = await store()
    const { memory } = await memories.add(keep('Old news.'))
    await memories.remove(memory.memoryId)
    clock = T0 + FORGOTTEN_DAYS * DAY - 1000
    expect((await memories.snapshot()).forgotten).toHaveLength(1)
    clock = T0 + FORGOTTEN_DAYS * DAY + 1000
    expect((await memories.snapshot()).forgotten).toEqual([])
    await expect(memories.restore(memory.memoryId)).rejects.toThrow('no longer in Recently forgotten')
    await memories.add(keep('Something new.'))
    const file = JSON.parse(await readFile(join(root!, 'memories.json'), 'utf8')) as { forgotten: unknown[] }
    expect(file.forgotten).toEqual([])
  })

  it('does not come back twice: the same words remembered again mean nothing to put back', async () => {
    const memories = await store()
    const { memory } = await memories.add(keep('Tests run with pnpm test.'))
    await memories.remove(memory.memoryId)
    await memories.add(keep('Tests run with pnpm test.'))
    await memories.restore(memory.memoryId)
    const held = await memories.snapshot()
    expect(held.memories.map((one) => one.text)).toEqual(['Tests run with pnpm test.'])
    expect(held.forgotten).toEqual([])
  })

  it('comes back without its name when a newer memory has taken it', async () => {
    const memories = await store()
    const { memory } = await memories.add(keep('Deploys go out on Fridays.', { name: 'deploy-day' }))
    await memories.remove(memory.memoryId)
    await memories.add(keep('Deploys go out on Thursdays.', { name: 'deploy-day' }))
    const back = await memories.restore(memory.memoryId)
    expect(back.name).toBeUndefined()
    expect((await memories.list()).filter((one) => one.name === 'deploy-day').map((one) => one.text)).toEqual(['Deploys go out on Thursdays.'])
  })

  it('is refused, and stays held, when memory is full', async () => {
    const memories = await store()
    const { memory } = await memories.add(keep('The one to restore.'))
    await memories.remove(memory.memoryId)
    // Filled in one write: four hundred adds, each its own write, is a
    // five-second test on a loaded machine.
    const file = JSON.parse(await readFile(join(root!, 'memories.json'), 'utf8')) as { memories: unknown[] }
    file.memories = Array.from({ length: MAX_MEMORIES }, (_, index) => ({
      memoryId: `mem_filler${String(index)}`,
      text: `Filler number ${String(index)}.`,
      scope: 'workspace',
      ...SHOP,
      by: { name: 'you' },
      createdAt: new Date(T0).toISOString(),
      status: 'kept',
      enabled: true
    }))
    await writeFile(join(root!, 'memories.json'), JSON.stringify(file), 'utf8')
    await expect(memories.restore(memory.memoryId)).rejects.toThrow(`at most ${String(MAX_MEMORIES)}`)
    expect((await memories.snapshot()).forgotten).toHaveLength(1)
  })
})

describe('the file', () => {
  it('from before 0.316 reads as nothing forgotten; a torn entry is dropped; one holding a proposal is dropped', async () => {
    const memories = await store()
    const memory = { memoryId: 'mem_a', text: 'Kept.', scope: 'workspace', ...SHOP, by: { name: 'you' }, createdAt: new Date(T0).toISOString(), status: 'kept', enabled: true }
    await writeFile(join(root!, 'memories.json'), JSON.stringify({ schemaVersion: 1, memories: [memory] }), 'utf8')
    expect((await memories.snapshot()).forgotten).toEqual([])
    await writeFile(
      join(root!, 'memories.json'),
      JSON.stringify({
        schemaVersion: 1,
        memories: [],
        forgotten: [
          { memory, forgottenAt: new Date(T0).toISOString(), forgottenBy: { name: 'you' } },
          { memory: { ...memory, memoryId: 'mem_b', status: 'proposed' }, forgottenAt: new Date(T0).toISOString(), forgottenBy: { name: 'you' } },
          { memory: { ...memory, memoryId: 'mem_c' }, forgottenAt: 'not a date', forgottenBy: { name: 'you' } },
          'torn'
        ]
      }),
      'utf8'
    )
    expect((await memories.snapshot()).forgotten.map((entry) => entry.memory.memoryId)).toEqual(['mem_a'])
  })

  it('with Recently forgotten that is not a list is unreadable, and nothing is written over it', async () => {
    const memories = await store()
    const text = JSON.stringify({ schemaVersion: 1, memories: [], forgotten: 'everything' })
    await writeFile(join(root!, 'memories.json'), text, 'utf8')
    await expect(memories.snapshot()).rejects.toThrow(MEMORY_UNREADABLE)
    await expect(memories.add(keep('New.'))).rejects.toThrow(MEMORY_UNREADABLE)
    expect(await readFile(join(root!, 'memories.json'), 'utf8')).toBe(text)
  })
})
