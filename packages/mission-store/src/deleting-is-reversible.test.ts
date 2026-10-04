import { mkdtemp, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createFileMissionLedger, MISSION_TRASH_DIR } from './index.js'

/**
 * Deleting a conversation is reversible until the trash is emptied.
 *
 * MEASURED 2026-09-17 on Colin's own machine: eighteen missions deleted in
 * four seconds through the app's own two-step confirm, and the files were
 * unlinked. No Recycle Bin entry, no shadow copy, File History off. A day of
 * portfolio work came back only because those runs were on Cursor, which
 * keeps its own transcripts -- and a product whose claim is a durable local
 * record cannot lean on another program's copy for that.
 *
 * The rule these tests hold: a deleted mission is GONE from every listing at
 * once, and its bytes are kept, unchanged, until someone empties the trash.
 */

const metadata = (missionId: string, createdAt: string, prompt = 'do the thing') => ({
  missionId,
  runId: `run_${missionId}`,
  prompt,
  runtime: 'codex' as const,
  model: 'gpt-6-astra',
  requestedRouteId: 'codex:account-default',
  resolvedRouteId: 'codex:gpt-6-astra',
  cliVersion: null,
  workspaceId: 'ws_test',
  sandbox: 'read-only' as const,
  executionPolicyVersion: 1 as const,
  createdAt
})

const ledger = async () => {
  const root = await mkdtemp(join(tmpdir(), 'locust-trash-'))
  return { root, store: createFileMissionLedger({ rootDirectory: root }) }
}

describe('deleting a mission', () => {
  it('takes it out of every listing, and keeps the bytes', async () => {
    const { root, store } = await ledger()
    await store.createMission(metadata('mission_a', '2026-09-17T10:00:00.000Z', 'the stocks one'))
    await store.createMission(metadata('mission_b', '2026-09-17T11:00:00.000Z'))
    const before = await readFile(join(root, 'mission_a.jsonl'), 'utf8')

    expect(await store.deleteMission('mission_a')).toBe(true)

    // Gone from where a person is standing.
    const listed = await store.listMissions()
    expect(listed.missions.map((mission) => mission.metadata.missionId)).toEqual(['mission_b'])
    expect(await store.getMission('mission_a')).toBeUndefined()
    // And gone from what the app says the history COSTS, so the number a
    // person reads still describes the missions they can see.
    expect((await store.storageReport()).missionCount).toBe(1)

    // Kept, byte for byte.
    const trashed = await store.listTrashedMissions()
    expect(trashed.map((entry) => entry.missionId)).toEqual(['mission_a'])
    expect(trashed[0]?.prompt).toBe('the stocks one')
    expect(await readFile(join(root, MISSION_TRASH_DIR, 'mission_a.jsonl'), 'utf8')).toBe(before)
  })

  it('can be put back, exactly as it was', async () => {
    const { store } = await ledger()
    await store.createMission(metadata('mission_a', '2026-09-17T10:00:00.000Z', 'the stocks one'))
    const before = await store.getMission('mission_a')
    await store.deleteMission('mission_a')

    expect(await store.restoreMission('mission_a')).toBe(true)

    expect(await store.getMission('mission_a')).toEqual(before)
    expect(await store.listTrashedMissions()).toEqual([])
    expect((await store.storageReport()).missionCount).toBe(1)
  })

  it('says no rather than writing over a record', async () => {
    const { store } = await ledger()
    await store.createMission(metadata('mission_a', '2026-09-17T10:00:00.000Z'))
    await store.deleteMission('mission_a')
    // The same id ran again: the live one is the truth, and a restore that
    // clobbered it would destroy the very thing this feature exists to save.
    await store.createMission(metadata('mission_a', '2026-09-17T12:00:00.000Z', 'the new one'))

    expect(await store.restoreMission('mission_a')).toBe(false)

    const live = await store.getMission('mission_a')
    expect(live?.metadata.prompt).toBe('the new one')
    expect((await store.listTrashedMissions()).map((entry) => entry.missionId)).toEqual(['mission_a'])
  })

  it('reports nothing to restore for a mission that was never there', async () => {
    const { store } = await ledger()
    expect(await store.deleteMission('mission_missing')).toBe(false)
    expect(await store.restoreMission('mission_missing')).toBe(false)
  })

  it('empties for good, and only then', async () => {
    const { root, store } = await ledger()
    await store.createMission(metadata('mission_a', '2026-09-17T10:00:00.000Z'))
    await store.createMission(metadata('mission_b', '2026-09-17T11:00:00.000Z'))
    await store.deleteMission('mission_a')
    await store.deleteMission('mission_b')
    expect((await store.listTrashedMissions()).length).toBe(2)

    expect(await store.emptyTrash()).toBe(2)

    expect(await store.listTrashedMissions()).toEqual([])
    expect(await store.restoreMission('mission_a')).toBe(false)
    expect((await readdir(join(root, MISSION_TRASH_DIR))).filter((name) => name.endsWith('.jsonl'))).toEqual([])
  })

  it('survives being deleted, restored and deleted again', async () => {
    const { store } = await ledger()
    await store.createMission(metadata('mission_a', '2026-09-17T10:00:00.000Z'))
    await store.deleteMission('mission_a')
    await store.restoreMission('mission_a')
    expect(await store.deleteMission('mission_a')).toBe(true)
    expect((await store.listTrashedMissions()).map((entry) => entry.missionId)).toEqual(['mission_a'])
    expect(await store.restoreMission('mission_a')).toBe(true)
    expect(await store.getMission('mission_a')).toBeDefined()
  })

  it('keeps what a bulk prune takes, the same way', async () => {
    // Prune and delete share one path, so retention is undoable too. This is
    // the case that would otherwise take the most at once.
    const { store } = await ledger()
    await store.createMission(metadata('mission_old', '2026-01-01T00:00:00.000Z'))
    const result = await store.pruneMissions({ before: '2026-06-01T00:00:00.000Z', protectMissionIds: [] })
    expect(result.deleted).toEqual(['mission_old'])
    expect((await store.listTrashedMissions()).map((entry) => entry.missionId)).toEqual(['mission_old'])
    expect(await store.restoreMission('mission_old')).toBe(true)
  })
})
