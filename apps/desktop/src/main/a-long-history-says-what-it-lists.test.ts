import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'
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

/*
 * What stops a hang, not what the work is allowed to cost: a limit set to what
 * this costs on a quiet machine fails it for somebody else's disk. The folder
 * it makes holds two thousand files, so removing it gets the same room.
 */
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 })

const roots: string[] = []
afterEach(async () => {
  // Retried: a folder of two thousand files that a virus scanner has only just
  // finished with can refuse to go (ENOTEMPTY, EBUSY) for a moment.
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })))
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

/**
 * A ledger holding `count` missions, as files on disk.
 *
 * The first two go through the ledger's own `createMission`. The rest are
 * written the way those are, straight to disk, because this is a test of
 * READING a long history and the writer's durable write -- one fsync a mission,
 * two thousand in a row -- is not what is under test: it was 11 seconds alone,
 * 23 to 25 beside the gate's other workers, and over two minutes when the disk
 * was busy, which is a timeout that says nothing about the history.
 *
 * What a mission file holds is the writer's to say, so the copies are made
 * FROM a file it wrote, and the copy rule is checked against the second one it
 * wrote: if the ledger's format ever grows a field this rule does not follow,
 * that is said here, not as two thousand missions the reader refuses.
 */
const BATCH = 64
async function ledgerOf(count: number) {
  const root = await mkdtemp(join(tmpdir(), 'locust-long-history-'))
  roots.push(root)
  const ledger = createFileMissionLedger({ rootDirectory: root })
  await ledger.createMission(metadata(1))
  await ledger.createMission(metadata(2))
  await ledger.flush()
  const fileOf = (index: number) => join(root, `${metadata(index).missionId}.jsonl`)
  const template = JSON.parse(await readFile(fileOf(1), 'utf8')) as Record<string, unknown>
  const copy = (index: number) => `${JSON.stringify({ ...template, occurredAt: metadata(index).createdAt, metadata: metadata(index) })}\n`
  expect(copy(2), "the copy rule no longer reproduces the ledger's own file").toBe(await readFile(fileOf(2), 'utf8'))
  const rest = Array.from({ length: Math.max(0, count - 2) }, (_, offset) => offset + 3)
  for (let from = 0; from < rest.length; from += BATCH) {
    await Promise.all(rest.slice(from, from + BATCH).map((index) => writeFile(fileOf(index), copy(index), { encoding: 'utf8', flag: 'wx' })))
  }
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
  })

  it('past 2,000, says how many the ledger keeps and how many are listed', async () => {
    const history = await readMissionHistory(await ledgerOf(2_005), undefined, 'C:/work')
    if (!history.ok) throw new Error(history.error.message)
    expect(history.data).toMatchObject({ totalMissions: 2_005, listedMissions: 2_000 })
    // The newest are the ones listed.
    expect(history.data.missions.some((mission) => mission.prompt === 'Task 2005')).toBe(true)
  })
})
