import { describe, expect, it } from 'vitest'

import { knownDigests, readMissionHistory } from './mission-history.js'
import type { MissionLedger, RecoveredMission } from '@teammate/mission-store'
import type { PublicRecoveredMission } from '../shared/ipc.js'

/**
 * A RECORD THE WINDOW ALREADY HAS IS NOT SENT TO IT AGAIN.
 *
 * Batch C: the history is read on every run end and every first open of a
 * finished conversation, and each read sent the newest twenty missions with
 * all their events -- 2.69 MB a read on Colin's ledger, nearly all of it what
 * the window had been sent the time before. A whole record now carries a
 * digest of itself as sent; the window hands the digests back, and a record
 * whose digest has not moved comes back without its events.
 */

const AT = '2026-09-23T12:00:00.000Z'
/** The window's folder: any fixed path, since nothing here reads it. */
const FOLDER = 'C:/work/locust'

function mission(missionId: string, events: readonly unknown[]): RecoveredMission {
  return {
    metadata: {
      missionId,
      runId: `run_${missionId}`,
      prompt: `prompt ${missionId}`,
      runtime: 'codex',
      model: 'account-default',
      requestedRouteId: 'codex',
      resolvedRouteId: 'codex-account:default',
      cliVersion: '0.151.0',
      workspaceId: 'ws_test',
      sandbox: 'read-only',
      executionPolicyVersion: 1,
      createdAt: AT
    },
    events,
    hostFailures: [],
    checkpoints: [],
    peerLinks: [],
    editChecks: [], approvals: [],
    phase: 'completed',
    lastUpdatedAt: AT,
    ledgerSequence: 1,
    issues: []
  } as unknown as RecoveredMission
}

const said = (text: string): unknown => ({
  type: 'message.delta',
  id: `e_${text}`,
  occurredAt: AT,
  payload: { itemId: 'answer', operation: 'append', text, final: true }
})

const ledgerOf = (missions: readonly RecoveredMission[]): MissionLedger =>
  ({
    getMission: async (missionId: string) => missions.find((m) => m.metadata.missionId === missionId),
    listMissions: async () => ({ missions: [...missions], issues: [], unreadableCount: 0 }),
    flush: async () => undefined
  }) as unknown as MissionLedger

async function read(ledger: MissionLedger, known?: Readonly<Record<string, string>>): Promise<readonly PublicRecoveredMission[]> {
  const response = await readMissionHistory(ledger, undefined, FOLDER, knownDigests(known))
  if (!response.ok) throw new Error('history unavailable')
  return response.data.missions
}

const digestsOf = (missions: readonly PublicRecoveredMission[]): Record<string, string> =>
  Object.fromEntries(missions.map((m) => [m.missionId, m.digest!]))

describe('a history read', () => {
  it('sends every whole record with a digest of itself the first time', async () => {
    const first = await read(ledgerOf([mission('a', [said('one')]), mission('b', [said('two')])]))
    expect(first.map((m) => m.events.length)).toEqual([1, 1])
    expect(first.every((m) => typeof m.digest === 'string' && m.digest.length > 0 && m.eventsKept === undefined)).toBe(true)
  })

  it('keeps back the events of a record the window holds unchanged, and sends the one that moved', async () => {
    const before = await read(ledgerOf([mission('a', [said('one')]), mission('b', [said('two')])]))
    const after = await read(ledgerOf([mission('a', [said('one')]), mission('b', [said('two'), said(' more')])]), digestsOf(before))
    const [a, b] = after
    expect(a?.eventsKept).toBe(true)
    expect(a?.events).toEqual([])
    expect(a?.digest).toBe(before[0]?.digest)
    expect(a?.eventCount).toBe(1)
    expect(b?.eventsKept).toBeUndefined()
    expect(b?.events.length).toBeGreaterThan(0)
    expect(b?.digest).not.toBe(before[1]?.digest)
  })

  it('sends everything whole when the window says nothing, or says it in a shape it does not recognise', async () => {
    const ledger = ledgerOf([mission('a', [said('one')])])
    const before = await read(ledger)
    for (const known of [undefined, {}, { a: 42 }, ['a'], 'a']) {
      const again = await readMissionHistory(ledger, undefined, FOLDER, knownDigests(known))
      expect(again.ok && again.data.missions[0]?.events.length).toBe(1)
    }
    expect((await read(ledger, digestsOf(before)))[0]?.eventsKept).toBe(true)
  })
})
