import type { MissionLedger, RecoveredMission } from '@teammate/mission-store'
import { describe, expect, it } from 'vitest'

import type { PublicRecoveredMission } from '../shared/ipc.js'
import { missingTranscripts, mergeHistory } from '../renderer/src/historyMerge.js'
import { readOneMission } from './mission-history.js'

/**
 * H3: AN OLDER CONVERSATION OPENS WITH ITS REPLIES. History sends the newest
 * twenty missions whole and every other one as a row with no events, and
 * nothing fetched the rest, so a conversation eleven back opened on the
 * person's words alone.
 */
const NOW = '2026-09-24T12:00:00.000Z'
function recovered(missionId: string): RecoveredMission {
  return {
    metadata: {
      missionId, runId: `run_${missionId}`, prompt: 'Where do the checks run?', runtime: 'codex', model: 'account-default',
      requestedRouteId: 'codex', resolvedRouteId: 'codex-account:default', cliVersion: null, workspaceId: 'ws_test',
      sandbox: 'read-only', executionPolicyVersion: 1, createdAt: NOW
    },
    events: [
      { id: 'e1', runId: `run_${missionId}`, missionId, sequence: 1, type: 'run.started', occurredAt: NOW, sourceAdapter: 'codex', payload: { evidence: { redacted: true } } },
      { id: 'e2', runId: `run_${missionId}`, missionId, sequence: 2, type: 'message.delta', occurredAt: NOW, sourceAdapter: 'codex', payload: { itemId: 'a', operation: 'append', text: 'They run with pnpm check.', final: true, evidence: { redacted: true } } },
      { id: 'e3', runId: `run_${missionId}`, missionId, sequence: 3, type: 'run.completed', occurredAt: NOW, sourceAdapter: 'codex', payload: { process: {}, evidence: { redacted: true } } }
    ],
    issues: [],
    hostFailures: [],
    checkpoints: [],
    peerLinks: [],
    phase: 'completed',
    lastUpdatedAt: NOW
  } as unknown as RecoveredMission
}
const ledger = { getMission: async (id: string) => (id === 'mission_old' ? recovered(id) : undefined) } as unknown as MissionLedger

describe('reading one mission', () => {
  it('gives it whole, with its events and a digest, as history gives the newest', async () => {
    const answer = await readOneMission(ledger, undefined, 'mission_old')
    expect(answer.ok).toBe(true)
    const mission = answer.ok ? answer.data.mission : undefined
    expect(mission?.events.length).toBeGreaterThan(0)
    expect(JSON.stringify(mission?.events)).toContain('They run with pnpm check.')
    expect(mission?.digest).toMatch(/.+/)
  })

  it('says so, without throwing, for a mission that is not there or an id that is not one', async () => {
    expect((await readOneMission(ledger, undefined, 'mission_gone')).ok).toBe(false)
    expect((await readOneMission(ledger, undefined, 42)).ok).toBe(false)
  })
})

describe('what opening a conversation reads', () => {
  const row = (missionId: string, eventCount: number): PublicRecoveredMission => ({ missionId, events: [], eventCount } as unknown as PublicRecoveredMission)
  const whole = (missionId: string, eventCount: number): PublicRecoveredMission => ({ missionId, events: [{}] as never, eventCount, digest: 'd' } as unknown as PublicRecoveredMission)

  it('is every turn that came as a row though the ledger has events for it', () => {
    const byId = new Map([
      ['m1', row('m1', 3)],
      ['m2', whole('m2', 3)],
      ['m3', row('m3', 0)]
    ])
    expect(missingTranscripts(['m1', 'm2', 'm3', 'm1', 'nope'], byId)).toEqual(['m1'])
  })

  it('stays read: a later history row for the same unchanged record keeps the whole one', () => {
    const held = [whole('m1', 3)]
    expect(mergeHistory(held, [row('m1', 3)])[0]).toBe(held[0])
    // A record that grew is taken as sent, to be read again.
    expect(mergeHistory(held, [row('m1', 5)])[0]?.events).toEqual([])
  })
})
