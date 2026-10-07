import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'
import { createFileMissionLedger } from '@teammate/mission-store'
import type { MissionLedger, MissionLedgerMetadata } from '@teammate/mission-store'
import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

import { spendByTeammate } from './mission-history.js'
import { isOwnModel, limitReached } from '../shared/spend.js'

/**
 * A MODEL OF YOUR OWN IS UNPRICED, NOT FREE (0.689).
 *
 * OpenCode declares a model the person added with no price, so its receipt
 * carries tokens and no dollars -- the same receipt a free model writes. The
 * month left such a run out, and a teammate with a $5.00 limit read
 * "$0.00 of $5.00" however much its provider billed (Grok's read of 0.687;
 * Paperclip books it "unpriced"). It is counted as a run, never as dollars.
 */
const roots: string[] = []
afterAll(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const AT = '2026-09-15T12:00:00.000Z'

function metadata(missionId: string, model: string): MissionLedgerMetadata {
  return {
    missionId,
    runId: `run_${missionId}`,
    prompt: 'Question',
    runtime: 'opencode',
    model,
    requestedRouteId: 'opencode',
    resolvedRouteId: 'opencode-account:default',
    cliVersion: 'test',
    workspaceId: 'ws_test',
    sandbox: 'read-only',
    executionPolicyVersion: 1,
    createdAt: AT
  }
}

function event(missionId: string, sequence: number, type: string, payload: Record<string, unknown>): NormalizedRuntimeEvent {
  return {
    id: `event_${missionId}_${String(sequence)}`,
    runId: `run_${missionId}`,
    missionId,
    sequence,
    occurredAt: AT,
    sourceAdapter: 'opencode',
    type,
    payload: { ...payload, evidence: { redacted: true } }
  } as unknown as NormalizedRuntimeEvent
}

const processEvidence = {
  exitCode: 0,
  signal: null,
  stderr: '',
  stderrTruncated: false,
  recordCount: 2,
  inputDeliveryFailed: false,
  outputLimitExceeded: false,
  forcedTerminationAttempted: false,
  terminationUnconfirmed: false,
  startedAt: AT,
  finishedAt: AT
}

/** One run per mission: [mission, model, usage, owner]. */
const RUNS: readonly (readonly [string, string, Record<string, unknown>, string])[] = [
  // Wren runs on a gateway of the person's own: two unpriced runs, one priced.
  ['mission_own_1', 'own-gateway/big-model', { inputTokens: 900, outputTokens: 40 }, 'tm_wren'],
  ['mission_own_2', 'own-gateway/big-model', { inputTokens: 300, outputTokens: 20 }, 'tm_wren'],
  ['mission_own_3', 'own-gateway/big-model', { usd: 0.4, inputTokens: 300, outputTokens: 20 }, 'tm_wren'],
  // A run that used no tokens cost nothing anywhere.
  ['mission_own_4', 'own-gateway/big-model', { inputTokens: 0, outputTokens: 0 }, 'tm_wren'],
  // Juno runs on OpenCode's own free model: free, and said as nothing, as before.
  ['mission_free_1', 'opencode/free-model', { inputTokens: 900, outputTokens: 40 }, 'tm_juno']
]

async function ledgerWithRuns(): Promise<MissionLedger> {
  const root = await mkdtemp(join(tmpdir(), 'locust-unpriced-'))
  roots.push(root)
  const ledger = createFileMissionLedger({ rootDirectory: root })
  for (const [missionId, model, usage] of RUNS) {
    await ledger.createMission(metadata(missionId, model))
    await ledger.appendEvents(missionId, [
      event(missionId, 1, 'message.delta', { itemId: 'answer', operation: 'append', text: 'done', final: true }),
      event(missionId, 2, 'run.completed', { usage, process: processEvidence })
    ])
  }
  await ledger.flush()
  return ledger
}

const owners = Object.fromEntries(RUNS.map(([missionId, , , owner]) => [missionId, owner]))

describe('a model of your own', () => {
  it('is one the person added, which OpenCode runs -- and an old record without a model is not', () => {
    expect(isOwnModel('opencode', 'own-gateway/big-model')).toBe(true)
    expect(isOwnModel('opencode', 'opencode/free-model')).toBe(false)
    expect(isOwnModel('claude', 'own-gateway/big-model')).toBe(false)
    expect(isOwnModel('opencode', undefined)).toBe(false)
  })

  it('counts a run with tokens and no price as unpriced, never as dollars; a free catalog model stays nothing', async () => {
    const totals = await spendByTeammate(await ledgerWithRuns(), owners, '2026-09')
    expect(totals?.get('tm_wren')).toEqual({ usd: 0.4, unpricedRuns: 2 })
    expect(totals?.has('tm_juno')).toBe(false)
    expect((await spendByTeammate(await ledgerWithRuns(), owners, '2026-10'))?.size).toBe(0)
  })

  it('never moves the limit: it is said on the card instead (a-teammates-month-and-limit)', () => {
    expect(limitReached({ unpricedRuns: 40 }, 5)).toBe(false)
  })
})
