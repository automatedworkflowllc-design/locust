import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createFileMissionLedger } from '@teammate/mission-store'
import type { MissionLedgerMetadata } from '@teammate/mission-store'

import { readOneMission } from './mission-history.js'

/*
 * A3.3, after 0.347: the check card lived only in the window, so a
 * conversation reopened after a restart came back without it or its Send
 * button. Through a real file: written by the host, read back the way the
 * window reads a conversation it opens.
 */

const NOW = '2026-09-25T17:00:00.000Z'
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function ledger(): Promise<{ root: string }> {
  const root = await mkdtemp(join(tmpdir(), 'locust-reopen-check-'))
  roots.push(root)
  await createFileMissionLedger({ rootDirectory: root }).createMission({
    missionId: 'mission_1',
    runId: 'run_1',
    prompt: 'Replace notes.txt with BROKEN.',
    runtime: 'claude',
    model: 'haiku',
    requestedRouteId: 'claude',
    resolvedRouteId: 'claude-account:haiku',
    cliVersion: '2.1.281',
    workspaceId: 'ws_test',
    sandbox: 'workspace-write',
    executionPolicyVersion: 1,
    createdAt: NOW
  } as unknown as MissionLedgerMetadata)
  return { root }
}

describe('a reopened conversation keeps the check after its turn', () => {
  it('reads back the newest check on the mission it ran after', async () => {
    const { root } = await ledger()
    const writer = createFileMissionLedger({ rootDirectory: root })
    await writer.appendEditCheck('mission_1', { command: 'node check.js', outcome: 'failed', newLines: ['FAIL: notes.txt says BROKEN'], unchanged: false, first: true, occurredAt: NOW })
    await writer.appendEditCheck('mission_1', { command: 'node check.js', outcome: 'passed', newLines: [], unchanged: false, first: false, occurredAt: '2026-09-25T17:01:00.000Z' })
    await writer.appendEditCheck('mission_1', { command: 'node check.js', outcome: 'failed', newLines: ['FAIL: again'], unchanged: false, first: false, occurredAt: '2026-09-25T17:02:00.000Z' })

    // A fresh ledger over the same folder: what a restarted app reads.
    const read = await readOneMission(createFileMissionLedger({ rootDirectory: root }), undefined, 'mission_1')

    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.data.mission.editCheck).toEqual({ command: 'node check.js', outcome: 'failed', newLines: ['FAIL: again'], unchanged: false, first: false })
  }, 20_000)

  it('has no check when none ran', async () => {
    const { root } = await ledger()
    const read = await readOneMission(createFileMissionLedger({ rootDirectory: root }), undefined, 'mission_1')

    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.data.mission.editCheck).toBeUndefined()
  }, 20_000)
})
