import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { compareMembership, compareSlotKey } from '../shared/compare.js'
import { createCompareStore } from './compare-store.js'

/**
 * A COMPARISON IS REMEMBERED (0.441, shared/compare.ts).
 *
 * One ask to two or three models, each column its own mission, recorded
 * outside the ledger the way a room is -- so the columns come back after a
 * restart, and a file that cannot be read is never taken for an empty one.
 */
const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
const folder = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'locust-compares-'))
  roots.push(root)
  return root
}
const ROUTES = [
  { runtime: 'claude', model: 'fable', label: 'Fable 5.1' },
  { runtime: 'codex', model: 'gpt-6-astra', label: 'GPT-6 Astra' }
]

describe('a comparison', () => {
  it('is recorded with a column per model, each turn added as it starts, and one kept', async () => {
    const root = await folder()
    const store = createCompareStore({ rootDirectory: root, now: () => new Date('2026-09-28T12:00:00.000Z'), createId: () => 'cmp_1' })
    const made = await store.create({ teammateId: 'tm_wren', prompt: '  Add a discount code field.  ', routes: ROUTES })
    expect(made.prompt).toBe('Add a discount code field.')
    expect(made.slots.map((column) => [column.slot, column.route.label])).toEqual([['a', 'Fable 5.1'], ['b', 'GPT-6 Astra']])

    await store.addTurn('cmp_1', 'a', 'm_a1')
    await store.addTurn('cmp_1', 'b', 'm_b1')
    await store.addTurn('cmp_1', 'a', 'm_a2')
    const kept = await store.keep('cmp_1', 'a')
    expect(kept.kept).toEqual({ slot: 'a', at: '2026-09-28T12:00:00.000Z' })

    // A restart: a new store over the same file reads the same thing.
    const again = await createCompareStore({ rootDirectory: root }).get('cmp_1')
    expect(again?.slots.find((column) => column.slot === 'a')?.missionIds).toEqual(['m_a1', 'm_a2'])
    expect(again?.kept?.slot).toBe('a')
    expect([...compareMembership([again!]).byMission.keys()].sort()).toEqual(['m_a1', 'm_a2', 'm_b1'])
  })

  it('says why a column could not start, and cannot keep a column that has nothing', async () => {
    const store = createCompareStore({ rootDirectory: await folder(), createId: () => 'cmp_2' })
    await store.create({ teammateId: 'tm_wren', prompt: 'Go', routes: ROUTES })
    const refused = await store.refuse('cmp_2', 'b', 'This column is still answering.')
    expect(refused.slots[1]?.refused).toBe('This column is still answering.')
    await expect(store.keep('cmp_2', 'b')).rejects.toThrow(/nothing to keep/)
  })

  it('is two or three models, never one or four', async () => {
    const store = createCompareStore({ rootDirectory: await folder() })
    await expect(store.create({ teammateId: 'tm_wren', prompt: 'Go', routes: ROUTES.slice(0, 1) })).rejects.toThrow(/2 or 3/)
    await expect(store.create({ teammateId: 'tm_wren', prompt: 'Go', routes: [...ROUTES, ...ROUTES] })).rejects.toThrow(/2 or 3/)
  })

  it('treats a file it cannot read as unreadable, never as empty', async () => {
    const root = await folder()
    await writeFile(join(root, 'compares.json'), '{"schemaVersion":1,"compares":[', 'utf8')
    const store = createCompareStore({ rootDirectory: root })
    await expect(store.list()).rejects.toThrow(/could not be read/)
    await expect(store.create({ teammateId: 'tm_wren', prompt: 'Go', routes: ROUTES })).rejects.toThrow(/could not be read/)
  })

  it('may belong to nobody: no teammate is needed to compare', async () => {
    const root = await folder()
    const store = createCompareStore({ rootDirectory: root, createId: () => 'cmp_3' })
    const made = await store.create({ prompt: 'Go', routes: ROUTES })
    expect(made.teammateId).toBeUndefined()
    const again = await createCompareStore({ rootDirectory: root }).get('cmp_3')
    expect(again?.compareId).toBe('cmp_3')
    expect(again?.teammateId).toBeUndefined()
    expect(compareSlotKey(undefined, 'cmp_3', 'a')).not.toBe(compareSlotKey(undefined, 'cmp_3', 'b'))
  })

  it('remembers that it edits, and which files the kept one brought into the folder (0.445)', async () => {
    const root = await folder()
    const store = createCompareStore({ rootDirectory: root, now: () => new Date('2026-09-28T12:00:00.000Z'), createId: () => 'cmp_9' })
    const made = await store.create({ prompt: 'Fix the cart total.', routes: ROUTES, changes: true })
    expect(made.changes).toBe(true)
    await store.addTurn('cmp_9', 'a', 'm_a1')
    await store.keep('cmp_9', 'a', ['cart.py', 'notes.md'])
    const again = await createCompareStore({ rootDirectory: root }).get('cmp_9')
    expect(again?.changes).toBe(true)
    expect(again?.kept).toEqual({ slot: 'a', at: '2026-09-28T12:00:00.000Z', brought: ['cart.py', 'notes.md'] })
    // One that only answers says neither.
    const answers = await createCompareStore({ rootDirectory: root, createId: () => 'cmp_10' }).create({ prompt: 'Why?', routes: ROUTES })
    expect(answers.changes).toBeUndefined()
  })

  it('remembers that its names are hidden (0.449)', async () => {
    const root = await folder()
    await createCompareStore({ rootDirectory: root, createId: () => 'cmp_b' }).create({ prompt: 'Blind.', routes: ROUTES, blind: true })
    expect((await createCompareStore({ rootDirectory: root }).get('cmp_b'))?.blind).toBe(true)
  })

  it('gives each column a run slot of its own', () => {
    expect(compareSlotKey('tm_wren', 'cmp_1', 'a')).not.toBe(compareSlotKey('tm_wren', 'cmp_1', 'b'))
    expect(compareSlotKey('tm_wren', 'cmp_1', 'a')).not.toBe('tm_wren')
  })
})
