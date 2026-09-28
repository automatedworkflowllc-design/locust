import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { compareMembership } from '../shared/compare.js'
import { createCompareStore } from './compare-store.js'

/**
 * A COLUMN CAN BE TRIED AGAIN (0.444, Arena's per-column Regenerate).
 *
 * 2026-09-28, a packaged compare drive: one free model's provider was down,
 * its column said "failed", and the only way to ask it again was to start the
 * whole comparison over. Try again asks that one column its newest ask again,
 * on the same model; the new answer takes the failed one's place, and the
 * failed one stays the comparison's -- never a stray conversation of its own
 * in the sidebar.
 */
const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
const store = async () => {
  const root = await mkdtemp(join(tmpdir(), 'locust-compare-retry-'))
  roots.push(root)
  let id = 0
  return {
    root,
    store: createCompareStore({ rootDirectory: root, now: () => new Date('2026-09-28T12:00:00.000Z'), createId: () => `cmp_${String((id += 1))}` })
  }
}
const ROUTES = [
  { runtime: 'opencode', model: 'opencode/nemotron-3-ultra-free', label: 'Nemotron 3 Ultra Free' },
  { runtime: 'opencode', model: 'opencode/ling-3.0-flash-fin-free', label: 'Ling 3.0 Flash Fin Free' }
]

describe('trying a column again', () => {
  it('puts the new answer in the failed one\'s place, turn for turn, and keeps the failed one folded in', async () => {
    const { root, store: compares } = await store()
    await compares.create({ prompt: 'What does a worktree let you do?', routes: ROUTES })
    await compares.addTurn('cmp_1', 'a', 'm_a1')
    await compares.addTurn('cmp_1', 'b', 'm_b1')
    await compares.addTurn('cmp_1', 'a', 'm_a2')
    await compares.addTurn('cmp_1', 'b', 'm_b2')

    const tried = await compares.retry('cmp_1', 'b', 'm_b2_again')
    const b = tried.slots.find((column) => column.slot === 'b')
    // Still two turns, so the answers still line up under their asks.
    expect(b?.missionIds).toEqual(['m_b1', 'm_b2_again'])
    expect(b?.retried).toEqual(['m_b2'])
    expect(tried.slots.find((column) => column.slot === 'a')?.missionIds).toEqual(['m_a1', 'm_a2'])

    // The failed answer is still the comparison's: the sidebar folds it in.
    const { byMission } = compareMembership([tried])
    expect(byMission.get('m_b2')).toEqual({ compareId: 'cmp_1', slot: 'b' })
    expect(byMission.get('m_b2_again')).toEqual({ compareId: 'cmp_1', slot: 'b' })

    // A restart reads the same thing.
    const again = await createCompareStore({ rootDirectory: root }).get('cmp_1')
    expect(again?.slots.find((column) => column.slot === 'b')).toEqual(b)
  })

  it('gives a column that could not start its first turn, and drops the refusal', async () => {
    const { store: compares } = await store()
    await compares.create({ prompt: 'Name three uses of a worktree.', routes: ROUTES })
    await compares.addTurn('cmp_1', 'a', 'm_a1')
    await compares.refuse('cmp_1', 'b', 'The folder is too big to copy for this column.')

    const tried = await compares.retry('cmp_1', 'b', 'm_b1')
    const b = tried.slots.find((column) => column.slot === 'b')
    expect(b?.missionIds).toEqual(['m_b1'])
    expect(b?.refused).toBeUndefined()
    expect(b?.retried).toBeUndefined()
  })

  it('says so for a column the comparison does not have', async () => {
    const { store: compares } = await store()
    await compares.create({ prompt: 'Anything.', routes: ROUTES })
    await expect(compares.retry('cmp_1', 'c', 'm_c1')).rejects.toThrow(/no such column/)
  })
})
