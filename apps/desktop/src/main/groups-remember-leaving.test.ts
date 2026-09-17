import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { MAX_LEFT_PER_CONVERSATION, createGroupStore } from './group-store.js'

/**
 * A conversation that LEAVES a group is remembered as having left.
 *
 * The join line ("Trading's instructions brief every turn from here") needs
 * a mirror when the words stop: "Trading's instructions no longer apply from
 * here". The store used to delete the membership and keep nothing, so the
 * thread could not say where the briefing ended. Wording confirmed by the
 * design agent, 2026-09-16; shape recorded in NEXT-GROUP-INSTRUCTIONS.md.
 */

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const store = async (clock: { at: string }) => {
  const root = await mkdtemp(join(tmpdir(), 'locust-groups-left-'))
  roots.push(root)
  let next = 0
  return createGroupStore({ rootDirectory: root, createId: () => `grp_${String((next += 1))}`, now: () => new Date(clock.at) })
}

describe('when a conversation leaves a group', () => {
  it('records the group as it was, and when', async () => {
    const clock = { at: '2026-09-17T10:00:00.000Z' }
    const groups = await store(clock)
    const trading = await groups.create('Trading')
    await groups.setInstructions(trading.groupId, 'Analysis only. Never place a trade.')
    await groups.assign('mission_1', trading.groupId)
    clock.at = '2026-09-17T11:00:00.000Z'
    await groups.assign('mission_1', undefined)
    const listed = await groups.list()
    expect(listed.members['mission_1']).toBeUndefined()
    expect(listed.left['mission_1']).toEqual([
      { groupId: trading.groupId, name: 'Trading', instructions: 'Analysis only. Never place a trade.', at: '2026-09-17T10:00:00.000Z', until: '2026-09-17T11:00:00.000Z' }
    ])
  })

  it('keeps the name and words the group HAD, after it is renamed, edited or removed', async () => {
    const clock = { at: '2026-09-17T10:00:00.000Z' }
    const groups = await store(clock)
    const trading = await groups.create('Trading')
    await groups.setInstructions(trading.groupId, 'Old words.')
    await groups.assign('mission_1', trading.groupId)
    clock.at = '2026-09-17T11:00:00.000Z'
    await groups.assign('mission_1', undefined)
    await groups.rename(trading.groupId, 'Markets')
    await groups.setInstructions(trading.groupId, 'New words.')
    await groups.remove(trading.groupId)
    const listed = await groups.list()
    expect(listed.groups).toEqual([])
    expect(listed.left['mission_1']?.[0]).toMatchObject({ name: 'Trading', instructions: 'Old words.' })
  })

  it('treats a move between groups as a leave and a join at the same moment', async () => {
    const clock = { at: '2026-09-17T10:00:00.000Z' }
    const groups = await store(clock)
    const trading = await groups.create('Trading')
    await groups.setInstructions(trading.groupId, 'Trading words.')
    const research = await groups.create('Research')
    await groups.assign('mission_1', trading.groupId)
    clock.at = '2026-09-17T11:00:00.000Z'
    await groups.assign('mission_1', research.groupId)
    const listed = await groups.list()
    expect(listed.members['mission_1']).toEqual({ groupId: research.groupId, at: '2026-09-17T11:00:00.000Z' })
    expect(listed.left['mission_1']?.map((entry) => [entry.name, entry.until])).toEqual([['Trading', '2026-09-17T11:00:00.000Z']])
    // Assigning to the group it is already in records nothing.
    await groups.assign('mission_1', research.groupId)
    expect((await groups.list()).left['mission_1']).toHaveLength(1)
  })

  it('records a leave for every conversation in a group that is removed', async () => {
    const clock = { at: '2026-09-17T10:00:00.000Z' }
    const groups = await store(clock)
    const trading = await groups.create('Trading')
    await groups.setInstructions(trading.groupId, 'Words.')
    await groups.assign('mission_1', trading.groupId)
    await groups.assign('mission_2', trading.groupId)
    clock.at = '2026-09-17T12:00:00.000Z'
    await groups.remove(trading.groupId)
    const listed = await groups.list()
    expect(Object.keys(listed.left).sort()).toEqual(['mission_1', 'mission_2'])
    expect(listed.left['mission_2']?.[0]?.until).toBe('2026-09-17T12:00:00.000Z')
  })

  it('keeps only the newest few leaves per conversation', async () => {
    const clock = { at: '2026-09-17T10:00:00.000Z' }
    const groups = await store(clock)
    const trading = await groups.create('Trading')
    for (let index = 0; index < MAX_LEFT_PER_CONVERSATION + 3; index += 1) {
      clock.at = `2026-09-17T10:${String(index).padStart(2, '0')}:00.000Z`
      await groups.assign('mission_1', trading.groupId)
      await groups.assign('mission_1', undefined)
    }
    const kept = (await groups.list()).left['mission_1'] ?? []
    expect(kept).toHaveLength(MAX_LEFT_PER_CONVERSATION)
    expect(kept[kept.length - 1]?.until).toBe(`2026-09-17T10:${String(MAX_LEFT_PER_CONVERSATION + 2)}:00.000Z`)
  })

  it('reads a file from before leaves were kept as having none', async () => {
    const clock = { at: '2026-09-17T10:00:00.000Z' }
    const groups = await store(clock)
    await groups.create('Trading')
    expect((await groups.list()).left).toEqual({})
  })
})
