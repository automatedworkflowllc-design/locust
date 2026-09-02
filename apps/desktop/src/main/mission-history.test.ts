import type { MissionLedger, RecoveredMission, WorkroomMessage } from '@teammate/mission-store'
import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'
import { describe, expect, it, vi } from 'vitest'
import { deleteMissionRecord, publicRecoveredMission, withinByteBudget, readMissionHistory } from './mission-history.js'

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
    peerLinks: [],
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

describe('peer messages in history', () => {
  const link = (direction: 'received' | 'posted', messageId: string) => ({
    direction,
    messageId,
    peerTeammateId: 'tm_atlas',
    occurredAt: NOW
  })
  const atlasMessage = (messageId: string): WorkroomMessage => ({
    messageId,
    sequence: 1,
    from: { teammateId: 'tm_atlas', name: 'Atlas', missionId: 'mission_a' },
    to: { teammateId: 'tm_wren', name: 'Wren' },
    text: 'pnpm check runs everything.',
    postedAt: NOW
  })

  it('joins a mission\'s links with the workroom text, keeping direction', () => {
    const mapped = publicRecoveredMission(
      recovered({ peerLinks: [link('received', 'wm_1')] }),
      new Map([['wm_1', atlasMessage('wm_1')]])
    )
    expect(mapped.peerMessages).toEqual([
      {
        messageId: 'wm_1',
        direction: 'received',
        from: { teammateId: 'tm_atlas', name: 'Atlas' },
        to: { teammateId: 'tm_wren', name: 'Wren' },
        text: 'pnpm check runs everything.',
        at: NOW
      }
    ])
  })

  it('keeps a link whose message the workroom no longer holds, with no text', () => {
    // Dropping it would show a mission that was briefed from a claim as if it
    // had been briefed from nothing.
    const mapped = publicRecoveredMission(recovered({ peerLinks: [link('received', 'wm_gone')] }), new Map())
    expect(mapped.peerMessages).toHaveLength(1)
    expect(mapped.peerMessages[0]).toMatchObject({ messageId: 'wm_gone', direction: 'received', text: null })
  })

  it('reads history even when the workroom itself cannot be read', async () => {
    const response = await readMissionHistory(
      ledger({
        listMissions: async () => ({ missions: [recovered({ peerLinks: [link('posted', 'wm_1')] })], issues: [] })
      }),
      {
        post: async () => { throw new Error('unused') },
        unread: async () => ({ messages: [], remaining: 0 }),
        markDelivered: async () => undefined,
        read: async () => { throw new Error('channel damaged') },
        flush: async () => undefined
      }
    )
    expect(response.ok).toBe(true)
    if (!response.ok) return
    expect(response.data.missions[0]?.peerMessages[0]?.text).toBeNull()
  })

  function ledger(overrides: Partial<MissionLedger>): MissionLedger {
    return {
      createMission: async () => undefined,
      appendEvents: async () => undefined,
      appendHostFailure: async () => undefined,
      createCheckpoint: async () => { throw new Error('not used in this test') },
      appendPeerLinks: async () => undefined,
      deleteMission: async () => true,
      getMission: async () => undefined,
      listMissions: async () => ({ missions: [], issues: [] }),
      flush: async () => undefined,
      ...overrides
    }
  }
})

describe('mission history reads', () => {
  const ledger = (overrides: Partial<MissionLedger>): MissionLedger => ({
    createMission: async () => undefined,
    appendEvents: async () => undefined,
    appendHostFailure: async () => undefined,
    createCheckpoint: async () => { throw new Error('not used in this test') },
    appendPeerLinks: async () => undefined,
    deleteMission: async () => true,
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

describe('history byte budget', () => {
  function sized(missionId: string, bytes: number) {
    return recovered({
      metadata: { ...recovered().metadata, missionId },
      events: [
        {
          ...event(1),
          payload: { ...event(1).payload, message: 'x'.repeat(bytes) }
        } as unknown as NormalizedRuntimeEvent
      ]
    })
  }

  it('stops adding missions once the response would exceed its budget', () => {
    // The per-mission window bounds COUNT, not SIZE: 500 events of large tool
    // output is still megabytes, and twenty of those is an unbounded payload.
    const missions = [
      publicRecoveredMission(sized('mission_1', 400)),
      publicRecoveredMission(sized('mission_2', 400)),
      publicRecoveredMission(sized('mission_3', 400))
    ]
    // Budget derived from the real serialized size rather than guessed, so the
    // test pins the BEHAVIOUR (two fit, the third does not) instead of pinning
    // a magic number that drifts the moment a field is added to the shape.
    const one = Buffer.byteLength(JSON.stringify(missions[0]), 'utf8')
    const kept = withinByteBudget(missions, one * 2 + 1)

    expect(kept.map((mission) => mission.missionId)).toEqual(['mission_1', 'mission_2'])
  })

  it('always returns the first mission even when it alone is over budget', () => {
    // An empty history reads as "you have no missions", which is a worse lie
    // than a large payload.
    const kept = withinByteBudget([publicRecoveredMission(sized('mission_1', 5000))], 10)
    expect(kept).toHaveLength(1)
  })

  it('keeps everything when the whole response fits', () => {
    const missions = [
      publicRecoveredMission(sized('mission_1', 10)),
      publicRecoveredMission(sized('mission_2', 10))
    ]
    expect(withinByteBudget(missions, 1_000_000)).toHaveLength(2)
  })
})

describe('deleting a mission', () => {
  function ledger(overrides: Partial<MissionLedger>): MissionLedger {
    return {
      createMission: async () => undefined,
      appendEvents: async () => undefined,
      appendHostFailure: async () => undefined,
      createCheckpoint: async () => { throw new Error('not used in this test') },
      appendPeerLinks: async () => undefined,
      deleteMission: async () => true,
      getMission: async () => undefined,
      listMissions: async () => ({ missions: [], issues: [] }),
      flush: async () => undefined,
      ...overrides
    }
  }

  it('refuses to delete a mission that is still running, and names the remedy', async () => {
    const deleteMission = vi.fn<MissionLedger['deleteMission']>(async () => true)
    const response = await deleteMissionRecord(ledger({ deleteMission }), 'mission_1', () => true)
    expect(response).toEqual({
      ok: false,
      error: { code: 'LIVE', message: 'That mission is still running. Stop it first, then delete it.' }
    })
    // Refused means untouched: the file is never asked to go.
    expect(deleteMission).not.toHaveBeenCalled()
  })

  it('deletes a finished mission and says when there was nothing to delete', async () => {
    expect(await deleteMissionRecord(ledger({}), 'mission_1', () => false)).toEqual({ ok: true })
    expect(await deleteMissionRecord(ledger({ deleteMission: async () => false }), 'mission_9', () => false))
      .toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
  })

  it('refuses an id that could name any other file, before touching the store', async () => {
    const deleteMission = vi.fn<MissionLedger['deleteMission']>(async () => true)
    const response = await deleteMissionRecord(ledger({ deleteMission }), '../escape', () => false)
    expect(response).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
    expect(deleteMission).not.toHaveBeenCalled()
  })
})
