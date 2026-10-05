import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'
import { createFileMissionLedger } from '@teammate/mission-store'
import type { MissionLedger, MissionLedgerMetadata } from '@teammate/mission-store'
import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

import { readMissionHistory, spendByTeammate } from './mission-history.js'

/**
 * WHAT A TEAMMATE SPENT THIS MONTH, from every conversation.
 *
 * The Team card added up the conversations the window held events for --
 * the newest twenty -- and called it the teammate's cost; everything older
 * fell out without a word (found designing the monthly limit, 2026-09-26).
 * The host reads each ledger file once, keeps its money beside the light
 * record, and totals by the month a run ENDED.
 */
const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const id = (index: number): string => `mission_${String(index).padStart(3, '0')}`

function metadata(index: number, createdAt: string): MissionLedgerMetadata {
  return {
    missionId: id(index),
    runId: `run_${String(index)}`,
    prompt: `Question ${String(index)}`,
    runtime: 'opencode',
    model: 'opencode/some-paid-model',
    requestedRouteId: 'opencode',
    resolvedRouteId: 'opencode-account:default',
    cliVersion: 'test',
    workspaceId: 'ws_test',
    sandbox: 'read-only',
    executionPolicyVersion: 1,
    createdAt
  }
}

function event(index: number, sequence: number, occurredAt: string, type: string, payload: Record<string, unknown>): NormalizedRuntimeEvent {
  return {
    id: `event_${String(index)}_${String(sequence)}`,
    runId: `run_${String(index)}`,
    missionId: id(index),
    sequence,
    occurredAt,
    sourceAdapter: 'opencode',
    type,
    payload: { ...payload, evidence: { redacted: true } }
  } as unknown as NormalizedRuntimeEvent
}

/** What the ledger requires a finished run to say about its process. */
const processEvidence = (at: string): Record<string, unknown> => ({
  exitCode: 0,
  signal: null,
  stderr: '',
  stderrTruncated: false,
  recordCount: 2,
  inputDeliveryFailed: false,
  outputLimitExceeded: false,
  forcedTerminationAttempted: false,
  terminationUnconfirmed: false,
  startedAt: at,
  finishedAt: at
})

/**
 * Thirty runs, oldest first. Wren's odd ones are priced at a dollar, and the
 * oldest of them are far past the newest twenty; Juno's are a subscription's,
 * whose "usd" nobody paid; two of Wren's ended in August; one belongs to
 * nobody.
 */
async function ledgerWithRuns(): Promise<MissionLedger> {
  const root = await mkdtemp(join(tmpdir(), 'locust-spend-'))
  roots.push(root)
  const ledger = createFileMissionLedger({ rootDirectory: root })
  for (let index = 1; index <= 30; index += 1) {
    const august = index <= 2
    const at = august ? `2026-08-${String(10 + index)}T12:00:00.000Z` : `2026-09-${String(Math.min(28, index)).padStart(2, '0')}T12:00:00.000Z`
    await ledger.createMission(metadata(index, at))
    const usage =
      index % 2 === 1
        ? { usd: 1, inputTokens: 900, outputTokens: 40 }
        : { usd: 3, inputTokens: 900, outputTokens: 40, billing: 'subscription' }
    await ledger.appendEvents(id(index), [
      event(index, 1, at, 'message.delta', { itemId: `answer_${String(index)}`, operation: 'append', text: 'done', final: true }),
      event(index, 2, at, 'run.completed', { usage, process: processEvidence(at) })
    ])
  }
  await ledger.flush()
  return ledger
}

const owners = (): Record<string, string> => {
  const held: Record<string, string> = {}
  for (let index = 1; index <= 29; index += 1) held[id(index)] = index % 2 === 1 ? 'tm_wren' : 'tm_juno'
  // mission_030 belongs to nobody.
  return held
}

describe('what a teammate spent this month', () => {
  /*
   * Thirty ledgers. Alone this is about two and a half seconds; in the gate,
   * beside the rest of the suite, it crossed the default five (2026-10-05),
   * and the gate's own retry of this file still did. Twenty seconds still
   * fails a hang.
   */
  it('counts every priced run of the month, not only the newest twenty, and nothing a plan paid for', async () => {
    const ledger = await ledgerWithRuns()
    const totals = await spendByTeammate(ledger, owners(), '2026-09')
    // Wren's odd runs 3..29 are September's: fourteen dollars. Runs 1 ended
    // in August. Juno's runs were a subscription's: no money at all.
    expect(totals?.get('tm_wren')).toEqual({ usd: 14 })
    expect(totals?.has('tm_juno')).toBe(false)
    expect(totals?.size).toBe(1)
  }, 20_000)

  it('counts a run in the month it ended', async () => {
    const ledger = await ledgerWithRuns()
    expect((await spendByTeammate(ledger, owners(), '2026-08'))?.get('tm_wren')).toEqual({ usd: 1 })
    expect((await spendByTeammate(ledger, owners(), '2026-10'))?.size).toBe(0)
  }, 20_000)

  it('sends every row its money, including the ones sent without their events', async () => {
    const ledger = await ledgerWithRuns()
    const history = await readMissionHistory(ledger, undefined, 'C:/work')
    if (!history.ok) throw new Error('history did not read')
    const oldest = history.data.missions.find((mission) => mission.missionId === id(3))
    // Among the oldest: sent as a row, no events -- and still priced.
    expect(oldest?.events).toEqual([])
    expect(oldest?.money).toEqual({ usd: 1 })
    // A plan's run carries no money on its row either.
    expect(history.data.missions.find((mission) => mission.missionId === id(4))?.money).toBeUndefined()
  }, 20_000)
})
