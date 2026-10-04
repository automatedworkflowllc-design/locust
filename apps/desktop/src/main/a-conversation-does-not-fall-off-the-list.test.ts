import { describe, expect, it } from 'vitest'

import { readMissionHistory } from './mission-history.js'
import type { MissionLedger, RecoveredMission } from '@teammate/mission-store'

/**
 * A conversation you have not opened lately is still a conversation.
 *
 * Colin, 2026-09-20, on the same conversation for the second time: *"my
 * research convo disappeared again, not sure if it renamed or what happened"*.
 *
 * 0.216 fixed the half of this that changes a row's IDENTITY — a conversation
 * whose earliest turn fell off the page walked `continuesFrom` into nothing,
 * so it renamed itself and left its group. This is the other half: a
 * conversation whose NEWEST turn is older than the twenty most-recently-
 * touched missions was not in the response at all. No row, no group entry,
 * nothing to rename — gone.
 *
 * Twenty was a budget on TRANSCRIPT, not a statement about how many
 * conversations a person may have, and the two had no business being one
 * number. They are two now.
 */

const NOW = '2026-09-20T12:00:00.000Z'

function mission(missionId: string, prompt: string, at: string, parent?: string): RecoveredMission {
  return {
    metadata: {
      missionId,
      runId: `run_${missionId}`,
      prompt,
      runtime: 'codex',
      model: 'account-default',
      requestedRouteId: 'codex',
      resolvedRouteId: 'codex-account:default',
      cliVersion: '0.151.0',
      workspaceId: 'ws_test',
      sandbox: 'read-only',
      executionPolicyVersion: 1,
      createdAt: at,
      ...(parent === undefined
        ? {}
        : { continuesFrom: { missionId: parent, checkpointEpoch: 1, reason: 'follow-up' as const } })
    },
    events: [{ type: 'noise' }],
    hostFailures: [],
    checkpoints: [],
    peerLinks: [],
    editChecks: [], approvals: [],
    phase: 'completed',
    lastUpdatedAt: at,
    ledgerSequence: 1,
    issues: []
  } as unknown as RecoveredMission
}

/** Newest first, the way the reader hands them over. */
const newer = Array.from({ length: 25 }, (_, index) =>
  mission(`mission_new_${String(index)}`, `turn ${String(index)}`, NOW))
const RESEARCH = mission('mission_research', 'research: what is the market doing', '2026-09-15T09:00:00.000Z')

const ledgerOf = (missions: readonly RecoveredMission[]): MissionLedger =>
  ({
    getMission: async (missionId: string) => missions.find((m) => m.metadata.missionId === missionId),
    listMissions: async (options?: { limit?: number }) => ({
      missions: missions.slice(0, options?.limit ?? 20),
      issues: [],
      unreadableCount: 0
    }),
    flush: async () => undefined
  }) as unknown as MissionLedger

describe('a conversation does not fall off the list', () => {
  it('lists a conversation older than the newest twenty', async () => {
    const response = await readMissionHistory(ledgerOf([...newer, RESEARCH]))
    expect(response.ok).toBe(true)
    if (!response.ok) return
    const ids = response.data.missions.map((entry) => entry.missionId)
    expect(ids).toContain('mission_research')
  })

  it('carries its prompt, because the row is named from it', async () => {
    const response = await readMissionHistory(ledgerOf([...newer, RESEARCH]))
    if (!response.ok) throw new Error('history unavailable')
    const found = response.data.missions.find((entry) => entry.missionId === 'mission_research')
    expect(found?.prompt).toBe('research: what is the market doing')
  })

  it('lists it WITHOUT its transcript', async () => {
    // The whole reason the limit could be raised. A row needs an id, a name
    // and a clock; the transcript is fetched when it is opened.
    const response = await readMissionHistory(ledgerOf([...newer, RESEARCH]))
    if (!response.ok) throw new Error('history unavailable')
    const found = response.data.missions.find((entry) => entry.missionId === 'mission_research')
    expect(found?.events).toEqual([])
  })

  it('still carries the transcript for the newest', async () => {
    const response = await readMissionHistory(ledgerOf([...newer, RESEARCH]))
    if (!response.ok) throw new Error('history unavailable')
    const first = response.data.missions[0]
    expect(first?.events.length).toBeGreaterThan(0)
  })

  it('lists every conversation exactly once', async () => {
    const response = await readMissionHistory(ledgerOf([...newer, RESEARCH]))
    if (!response.ok) throw new Error('history unavailable')
    const ids = response.data.missions.map((entry) => entry.missionId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('still finds an ancestor that is off the end of even the long list', async () => {
    // The 0.216 floor has to keep holding: identity comes from the root.
    const root = mission('mission_root', 'the first turn', '2026-09-14T09:00:00.000Z')
    const head = mission('mission_head', 'a later turn', NOW, 'mission_root')
    const ledger = {
      getMission: async (missionId: string) =>
        [root, head].find((m) => m.metadata.missionId === missionId),
      listMissions: async () => ({ missions: [head], issues: [], unreadableCount: 0 }),
      flush: async () => undefined
    } as unknown as MissionLedger
    const response = await readMissionHistory(ledger)
    if (!response.ok) throw new Error('history unavailable')
    expect(response.data.missions.map((entry) => entry.missionId)).toContain('mission_root')
  })
})
