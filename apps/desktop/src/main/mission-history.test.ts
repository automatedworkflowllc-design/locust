import type { MissionLedger, RecoveredMission } from '@teammate/mission-store'
import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'
import { describe, expect, it } from 'vitest'
import { publicRecoveredMission, readMissionHistory } from './mission-history.js'

const NOW = '2026-08-31T15:00:00.000Z'

function event(sequence: number): NormalizedRuntimeEvent {
  return {
    id: `event_${sequence}`,
    runId: 'run_1',
    missionId: 'mission_1',
    sequence,
    type: 'step.started',
    occurredAt: NOW,
    sourceAdapter: 'codex',
    payload: {
      stepKind: 'turn',
      evidence: { redacted: true }
    }
  } as unknown as NormalizedRuntimeEvent
}

function recovered(overrides: Partial<RecoveredMission> = {}): RecoveredMission {
  return {
    metadata: {
      missionId: 'mission_1',
      runId: 'run_1',
      prompt: 'Inspect the workspace without changing it.',
      runtime: 'codex',
      model: 'account-default',
      requestedRouteId: 'codex',
      resolvedRouteId: 'codex-account:default',
      cliVersion: '0.151.0-alpha.7.2',
      workspaceId: 'ws_test',
      sandbox: 'read-only',
      executionPolicyVersion: 1,
      createdAt: NOW
    },
    events: [],
    hostFailures: [],
    checkpoints: [],
    phase: 'completed',
    lastUpdatedAt: NOW,
    ledgerSequence: 1,
    issues: [],
    ...overrides
  }
}

describe('mission history mapping', () => {
  it('passes small missions through untruncated with truthful counts', () => {
    const mission = recovered({ events: Array.from({ length: 500 }, (_, index) => event(index + 1)) })
    const mapped = publicRecoveredMission(mission)
    expect(mapped.events).toHaveLength(500)
    expect(mapped.eventCount).toBe(500)
    expect(mapped.eventsTruncated).toBe(false)
    expect(mapped.integrityIssueCount).toBe(0)
  })

  it('windows oversized missions to the first and latest events and says so', () => {
    const mission = recovered({ events: Array.from({ length: 501 }, (_, index) => event(index + 1)) })
    const mapped = publicRecoveredMission(mission)
    expect(mapped.events).toHaveLength(500)
    expect(mapped.events[0]?.sequence).toBe(1)
    expect(mapped.events.at(-1)?.sequence).toBe(501)
    expect(mapped.events[1]?.sequence).toBe(3)
    expect(mapped.eventCount).toBe(501)
    expect(mapped.eventsTruncated).toBe(true)
  })

  it('surfaces only the latest host failure and the mission-local issue count', () => {
    const mission = recovered({
      hostFailures: [
        { code: 'runtime-start-failed', message: 'first failure', occurredAt: NOW },
        { code: 'runtime-transport-failed', message: 'latest failure', occurredAt: NOW }
      ],
      issues: [{ code: 'truncated-tail', message: 'An incomplete final ledger record was ignored after recovery.' }],
      phase: 'failed'
    })
    const mapped = publicRecoveredMission(mission)
    expect(mapped.hostFailureMessage).toBe('latest failure')
    expect(mapped.integrityIssueCount).toBe(1)
    expect(mapped.phase).toBe('failed')
  })
})

describe('mission history reads', () => {
  const ledger = (overrides: Partial<MissionLedger>): MissionLedger => ({
    createMission: async () => undefined,
    appendEvents: async () => undefined,
    appendHostFailure: async () => undefined,
    createCheckpoint: async () => { throw new Error('not used in this test') },
    getMission: async () => undefined,
    listMissions: async () => ({ missions: [], issues: [] }),
    flush: async () => undefined,
    ...overrides
  })

  it('returns mapped missions and the store-wide issue count', async () => {
    const response = await readMissionHistory(ledger({
      listMissions: async () => ({
        missions: [recovered()],
        issues: [{ code: 'read-failed', message: 'A mission ledger could not be read.' }]
      })
    }))
    expect(response.ok).toBe(true)
    if (!response.ok) return
    expect(response.data.missions).toHaveLength(1)
    expect(response.data.missions[0]?.missionId).toBe('mission_1')
    expect(response.data.issueCount).toBe(1)
  })

  it('converts a ledger failure into a generic response without leaking the error', async () => {
    const response = await readMissionHistory(ledger({
      listMissions: async () => {
        throw new Error('C:\\private\\ledger-path sk-secret')
      }
    }))
    expect(response).toEqual({
      ok: false,
      error: {
        code: 'HISTORY_UNAVAILABLE',
        message: 'Local mission history could not be read.'
      }
    })
    expect(JSON.stringify(response)).not.toContain('private')
  })
})
