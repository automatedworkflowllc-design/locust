import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { boundedEditCheck, createFileMissionLedger } from '../src/index.js'
import type { MissionEditCheck, MissionLedgerMetadata } from '../src/index.js'

/*
 * A3.3, after 0.347: the check card was held only in the window, so a
 * conversation reopened after a restart came back without it -- and without
 * its Send button, the one thing the card is for. The host now writes what
 * the check said onto the mission it ran after.
 */

const NOW = '2026-09-25T17:00:00.000Z'
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function ledgerWithMission(schemaVersion?: number): Promise<{ root: string; ledger: ReturnType<typeof createFileMissionLedger> }> {
  const root = await mkdtemp(join(tmpdir(), 'teammate-check-'))
  roots.push(root)
  const metadata = {
    missionId: 'mission_1',
    runId: 'run_1',
    prompt: 'Change notes.txt.',
    runtime: 'claude',
    model: 'haiku',
    requestedRouteId: 'claude',
    resolvedRouteId: 'claude-account:haiku',
    cliVersion: '2.1.281',
    workspaceId: 'ws_test',
    sandbox: 'workspace-write',
    executionPolicyVersion: 1,
    createdAt: NOW
  }
  if (schemaVersion === undefined) {
    const ledger = createFileMissionLedger({ rootDirectory: root })
    await ledger.createMission(metadata as unknown as MissionLedgerMetadata)
    return { root, ledger }
  }
  await writeFile(join(root, 'mission_1.jsonl'), `${JSON.stringify({
    schemaVersion,
    recordType: 'mission.created',
    ledgerSequence: 1,
    occurredAt: NOW,
    metadata: { ...metadata, runtime: 'codex', model: 'account-default', requestedRouteId: 'codex', resolvedRouteId: 'codex-account:default', cliVersion: '0.151.0' }
  })}\n`, 'utf8')
  return { root, ledger: createFileMissionLedger({ rootDirectory: root }) }
}

const FAILED: MissionEditCheck = {
  command: 'node check.js',
  outcome: 'failed',
  newLines: ['FAIL: notes.txt says BROKEN'],
  unchanged: false,
  first: true,
  occurredAt: NOW
}

describe('the check after a turn is kept on its mission', () => {
  it('comes back from the file exactly as written', async () => {
    const { root, ledger } = await ledgerWithMission()
    await ledger.appendEditCheck('mission_1', FAILED)

    const recovered = await createFileMissionLedger({ rootDirectory: root }).getMission('mission_1')

    expect(recovered?.issues).toEqual([])
    expect(recovered?.editChecks).toEqual([FAILED])
    expect(recovered?.ledgerSequence).toBe(2)
  }, 20_000)

  it('keeps the file walkable after it: a later record still reads', async () => {
    const { root, ledger } = await ledgerWithMission()
    await ledger.appendEditCheck('mission_1', FAILED)
    await ledger.appendPeerLinks('mission_1', [
      { direction: 'posted', messageId: 'wm_1', peerTeammateId: 'tm_atlas', occurredAt: NOW }
    ])

    const recovered = await createFileMissionLedger({ rootDirectory: root }).getMission('mission_1')

    expect(recovered?.issues).toEqual([])
    expect(recovered?.editChecks).toHaveLength(1)
    expect(recovered?.peerLinks).toHaveLength(1)
  }, 20_000)

  it('is refused on a mission written before version 17, which its own readers would stop at', async () => {
    const { ledger } = await ledgerWithMission(16)
    await expect(ledger.appendEditCheck('mission_1', FAILED)).rejects.toThrow('cannot hold check results')
  }, 20_000)

  it('is read as damage in a file written before version 17', async () => {
    const { root } = await ledgerWithMission(16)
    await writeFile(join(root, 'mission_1.jsonl'), `${JSON.stringify({
      schemaVersion: 16,
      recordType: 'mission.edit_check',
      ledgerSequence: 2,
      occurredAt: NOW,
      check: FAILED
    })}\n`, { flag: 'a' })

    const recovered = await createFileMissionLedger({ rootDirectory: root }).getMission('mission_1')

    expect(recovered?.editChecks).toEqual([])
    expect(recovered?.issues.map((issue) => issue.code)).toEqual(['invalid-record'])
  }, 20_000)

  it('refuses an outcome it does not know, and an unbounded list of lines', async () => {
    const { ledger } = await ledgerWithMission()
    await expect(ledger.appendEditCheck('mission_1', { ...FAILED, outcome: 'maybe' as 'failed' })).rejects.toThrow()
    await expect(ledger.appendEditCheck('mission_1', { ...FAILED, newLines: Array.from({ length: 61 }, () => 'x') })).rejects.toThrow()
  }, 20_000)

  it('bounds a big result to what the reader accepts, so the host never writes one it would refuse', async () => {
    const { root, ledger } = await ledgerWithMission()
    const huge = { ...FAILED, newLines: Array.from({ length: 400 }, (_, index) => `line ${String(index)} ${'y'.repeat(900)}`) }
    await ledger.appendEditCheck('mission_1', boundedEditCheck(huge))

    const recovered = await createFileMissionLedger({ rootDirectory: root }).getMission('mission_1')
    const kept = recovered?.editChecks[0]

    expect(recovered?.issues).toEqual([])
    expect(kept?.newLines).toHaveLength(60)
    expect(kept?.newLines[0]?.length).toBe(500)
    expect((await readFile(join(root, 'mission_1.jsonl'), 'utf8')).length).toBeLessThan(60_000)
  }, 20_000)
})
