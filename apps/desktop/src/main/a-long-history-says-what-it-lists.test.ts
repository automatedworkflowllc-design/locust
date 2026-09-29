import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'
import { createFileMissionLedger } from '@teammate/mission-store'
import type { MissionLedgerMetadata } from '@teammate/mission-store'

import { readMissionHistory } from './mission-history.js'

/**
 * A LONG HISTORY SAYS WHAT IT LISTS (QA-2026-09-29 round 2, R28).
 *
 * At 300 missions the list stopped, and the header's "300 conversations"
 * read like a total while 900 more sat on disk. The list now reaches 2,000
 * turns, and past that the history says how many the ledger keeps.
 */
const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function metadata(index: number): MissionLedgerMetadata {
  return {
    missionId: `mission_${String(index).padStart(5, '0')}`,
    runId: `run_${String(index)}`,
    prompt: `Task ${String(index)}`,
    runtime: 'opencode',
    model: 'opencode/muse-spark-1.3-contributor-free',
    requestedRouteId: 'opencode',
    resolvedRouteId: 'opencode-account:default',
    cliVersion: 'test',
    workspaceId: 'ws_test',
    sandbox: 'read-only',
    executionPolicyVersion: 1,
    createdAt: new Date(Date.UTC(2026, 8, 1) + index * 60_000).toISOString()
  }
}

async function ledgerOf(count: number) {
  const root = await mkdtemp(join(tmpdir(), 'locust-long-history-'))
  roots.push(root)
  const ledger = createFileMissionLedger({ rootDirectory: root })
  for (let index = 1; index <= count; index += 1) await ledger.createMission(metadata(index))
  await ledger.flush()
  return ledger
}

describe('a long history', () => {
  it('lists far past the old 300, and says nothing more when everything is listed', async () => {
    const history = await readMissionHistory(await ledgerOf(1_201), undefined, 'C:/work')
    if (!history.ok) throw new Error(history.error.message)
    const prompts = new Set(history.data.missions.map((mission) => mission.prompt))
    expect(prompts.has('Task 900')).toBe(true)
    expect(prompts.has('Task 1')).toBe(true)
    expect(history.data.totalMissions).toBeUndefined()
  }, 120_000)

  it('past 2,000, says how many the ledger keeps and how many are listed', async () => {
    const history = await readMissionHistory(await ledgerOf(2_005), undefined, 'C:/work')
    if (!history.ok) throw new Error(history.error.message)
    expect(history.data).toMatchObject({ totalMissions: 2_005, listedMissions: 2_000 })
    // The newest are the ones listed.
    expect(history.data.missions.some((mission) => mission.prompt === 'Task 2005')).toBe(true)
  }, 120_000)
})
