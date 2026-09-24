import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { MAX_MEMORIES, MEMORY_UNREADABLE, createMemoryStore, parsedFile } from './memory-store.js'

const NOW = '2026-09-05T12:00:00.000Z'
let root: string

afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true })
})

async function store() {
  root = await mkdtemp(join(tmpdir(), 'locust-memory-'))
  let ids = 0
  return createMemoryStore({ rootDirectory: root, now: () => new Date(NOW), createId: () => `id${String(++ids)}` })
}

const WREN = { teammateId: 'tm_wren', name: 'Wren' }
const SHOP = { workspaceId: 'ws_shop', workspaceName: 'shop' }
const LEDGER = { workspaceId: 'ws_ledger', workspaceName: 'ledger' }

describe('a memory file it cannot read', () => {
  /*
   * Read as EMPTY, the next memory kept was written over it: every memory
   * gone for one new one. The rooms and groups stores were fixed for exactly
   * this on 2026-09-16; memories were not (harness review, 2026-09-24).
   */
  it('is refused, not written over, when it is torn', async () => {
    const memories = await store()
    const torn = '{"schemaVersion":1,"memories":[{"memoryId":"mem_a","text":"Tests run'
    await writeFile(join(root, 'memories.json'), torn, 'utf8')
    await expect(memories.list()).rejects.toThrow(MEMORY_UNREADABLE)
    await expect(memories.add({ text: 'A new one.', scope: 'workspace', ...SHOP, by: WREN, status: 'kept' })).rejects.toThrow(MEMORY_UNREADABLE)
    expect(await readFile(join(root, 'memories.json'), 'utf8')).toBe(torn)
  })

  it('is refused when it is a schema this build does not know, which a later build may have written', async () => {
    const memories = await store()
    const newer = JSON.stringify({ schemaVersion: 99, memories: [{ memoryId: 'mem_a', text: 'kept by a newer build' }] })
    await writeFile(join(root, 'memories.json'), newer, 'utf8')
    await expect(memories.add({ text: 'A new one.', scope: 'workspace', ...SHOP, by: WREN, status: 'kept' })).rejects.toThrow(MEMORY_UNREADABLE)
    expect(await readFile(join(root, 'memories.json'), 'utf8')).toBe(newer)
  })

  it('is genuinely empty when there is simply no file yet', async () => {
    const memories = await store()
    expect(await memories.list()).toEqual([])
    const { created } = await memories.add({ text: 'The first one.', scope: 'workspace', ...SHOP, by: WREN, status: 'kept' })
    expect(created).toBe(true)
  })
})

describe('what the team remembers', () => {
  it('keeps a memory with who wrote it, where, and from which conversation, on disk', async () => {
    const memories = await store()
    const { memory, created } = await memories.add({ text: '  Tests run with pnpm test.  ', scope: 'workspace', ...SHOP, by: WREN, missionId: 'mission_1', status: 'kept' })
    expect(created).toBe(true)
    expect(memory).toEqual({
      memoryId: 'mem_id1',
      text: 'Tests run with pnpm test.',
      scope: 'workspace',
      workspaceId: 'ws_shop',
      workspaceName: 'shop',
      by: WREN,
      missionId: 'mission_1',
      createdAt: NOW,
      status: 'kept',
      enabled: true
    })
    expect(JSON.parse(await readFile(join(root, 'memories.json'), 'utf8'))).toMatchObject({ schemaVersion: 1, memories: [memory] })
    expect(await createMemoryStore({ rootDirectory: root }).list()).toEqual([memory])
  })

  it('does not write the same memory twice in the same place, and a proposed one stays proposed', async () => {
    const memories = await store()
    const first = await memories.add({ text: 'Colin wants diffs, not prose.', scope: 'global', ...SHOP, by: WREN, status: 'proposed' })
    const again = await memories.add({ text: 'colin wants DIFFS not prose', scope: 'global', ...LEDGER, by: { name: 'Juno' }, status: 'kept' })
    expect(again.created).toBe(false)
    expect(again.memory).toEqual(first.memory)
    expect((await memories.list())).toHaveLength(1)
    // The same text in another FOLDER is another memory.
    const elsewhere = await memories.add({ text: 'Colin wants diffs, not prose.', scope: 'workspace', ...LEDGER, by: WREN, status: 'kept' })
    expect(elsewhere.created).toBe(true)
  })

  it("briefs a folder's mission with that folder's kept memories and everyone's, never a proposed or switched-off one", async () => {
    const memories = await store()
    const shopKept = (await memories.add({ text: 'shop kept', scope: 'workspace', ...SHOP, by: WREN, status: 'kept' })).memory
    const everywhere = (await memories.add({ text: 'everywhere', scope: 'global', ...LEDGER, by: WREN, status: 'kept' })).memory
    await memories.add({ text: 'ledger kept', scope: 'workspace', ...LEDGER, by: WREN, status: 'kept' })
    await memories.add({ text: 'shop proposed', scope: 'workspace', ...SHOP, by: WREN, status: 'proposed' })
    const off = (await memories.add({ text: 'shop off', scope: 'workspace', ...SHOP, by: WREN, status: 'kept' })).memory
    await memories.update({ memoryId: off.memoryId, enabled: false })
    expect((await memories.briefed('ws_shop')).map((m) => m.text)).toEqual([shopKept.text, everywhere.text])
    expect((await memories.briefed('ws_other')).map((m) => m.text)).toEqual([everywhere.text])
  })

  it('a person edits the text, switches one off and on, keeps a proposed one, and removes one', async () => {
    const memories = await store()
    const proposed = (await memories.add({ text: 'Port is 3000', scope: 'workspace', ...SHOP, by: WREN, status: 'proposed' })).memory
    const edited = await memories.update({ memoryId: proposed.memoryId, text: 'Port is 3001', keep: true })
    expect(edited).toMatchObject({ text: 'Port is 3001', status: 'kept', enabled: true })
    expect((await memories.update({ memoryId: proposed.memoryId, enabled: false })).enabled).toBe(false)
    await expect(memories.update({ memoryId: proposed.memoryId, text: '' })).rejects.toThrow(/one line/)
    await expect(memories.update({ memoryId: 'mem_nope', text: 'x' })).rejects.toThrow(/no longer exists/)
    await memories.remove(proposed.memoryId)
    expect(await memories.list()).toEqual([])
  })

  it('forget by text hits the folder and everywhere, not another folder; clear takes a folder or all', async () => {
    const memories = await store()
    await memories.add({ text: 'The API is on port 3000', scope: 'workspace', ...SHOP, by: WREN, status: 'kept' })
    await memories.add({ text: 'The API is on port 3000', scope: 'global', ...SHOP, by: WREN, status: 'kept' })
    await memories.add({ text: 'The API is on port 3000', scope: 'workspace', ...LEDGER, by: WREN, status: 'kept' })
    // Both copies -- this folder's and everywhere's -- named rather than
    // counted, so a caller can say WHICH memory went.
    const gone = await memories.forget('the api is on port 3000!', 'ws_shop')
    expect(gone.removed).toHaveLength(2)
    expect(gone.refusal).toBeUndefined()
    expect((await memories.list()).map((m) => m.workspaceId)).toEqual(['ws_ledger'])
    await memories.add({ text: 'a', scope: 'workspace', ...SHOP, by: WREN, status: 'kept' })
    await memories.add({ text: 'b', scope: 'global', ...SHOP, by: WREN, status: 'kept' })
    expect(await memories.clear({ workspaceId: 'ws_shop' })).toBe(1)
    expect((await memories.list()).map((m) => m.text)).toEqual(['The API is on port 3000', 'b'])
    expect(await memories.clear({})).toBe(2)
    expect(await memories.list()).toEqual([])
  })

  it('refuses what it cannot keep, and a malformed file is unreadable rather than empty', async () => {
    const memories = await store()
    await expect(memories.add({ text: '', scope: 'workspace', ...SHOP, by: WREN, status: 'kept' })).rejects.toThrow(/one line/)
    await expect(memories.add({ text: 'x', scope: 'team', ...SHOP, by: WREN, status: 'kept' })).rejects.toThrow(/folder or for everywhere/)
    // A torn FILE is unreadable, never empty: read as empty, the next memory
    // kept was written over it (harness review, 2026-09-24).
    expect(() => parsedFile('{{{')).toThrow(MEMORY_UNREADABLE)
    // A bad MEMORY inside a good file is still just dropped.
    expect(parsedFile(JSON.stringify({ schemaVersion: 1, memories: [{ memoryId: 'mem_1', text: 'no scope' }] }))).toEqual({ schemaVersion: 1, memories: [] })
    // This asserted the bug: "not json" read as an empty list, which the
    // next memory kept then replaced (harness review, 2026-09-24).
    await writeFile(join(root, 'memories.json'), 'not json', 'utf8')
    await expect(memories.list()).rejects.toThrow(MEMORY_UNREADABLE)
  })

  it('is bounded', async () => {
    const memories = await store()
    // Seeded on disk in one write rather than added one by one: 400
    // write-and-rename cycles took longer than the 5 s test budget whenever
    // the disk was busy, and the bound is a property of the file's length,
    // not of how it got that long.
    const full = Array.from({ length: MAX_MEMORIES }, (_, i) => ({
      memoryId: `mem_seed${String(i)}`,
      text: `memory ${String(i)}`,
      scope: 'workspace',
      ...SHOP,
      by: WREN,
      createdAt: NOW,
      status: 'kept',
      enabled: true
    }))
    await writeFile(join(root, 'memories.json'), JSON.stringify({ schemaVersion: 1, memories: full }), 'utf8')
    expect((await memories.list()).length).toBe(MAX_MEMORIES)
    await expect(memories.add({ text: 'one more', scope: 'workspace', ...SHOP, by: WREN, status: 'kept' })).rejects.toThrow(/at most/)
  })
})
