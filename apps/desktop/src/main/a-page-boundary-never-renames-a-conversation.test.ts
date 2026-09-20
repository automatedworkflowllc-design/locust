import { describe, expect, it } from 'vitest'

import { readMissionHistory } from './mission-history.js'
import type { MissionLedger, RecoveredMission } from '@teammate/mission-store'

/**
 * A conversation's IDENTITY must not depend on where the page happened to cut.
 *
 * Colin, 2026-09-20, with a screenshot of an empty group: *"both my stonks and
 * research chats are gone out of the stonks group, probably autorenamed and
 * moved, def need this fixed"*.
 *
 * Nothing was moved and nothing was renamed. History returns the 20
 * most-recently-touched missions; his stonks conversations began on 14 and 15
 * September; so their EARLIEST turns fell off the page. The row's `rootId`
 * comes from walking `continuesFrom` back through the missions the renderer
 * was handed, and with the early turns gone the walk stopped short — which
 * silently renamed the row (the title is the root's first sentence), dropped
 * the name he had typed, and unfiled it from `stonks`, because all three are
 * stored against the root.
 *
 * Three symptoms, one cause, zero data lost — the ledgers and `groups.json`
 * were intact and were checked before anything was changed.
 */

const NOW = '2026-09-20T12:00:00.000Z'

function mission(missionId: string, prompt: string, parent?: string): RecoveredMission {
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
      createdAt: NOW,
      ...(parent === undefined
        ? {}
        : { continuesFrom: { missionId: parent, checkpointEpoch: 1, reason: 'follow-up' as const } })
    },
    events: [],
    hostFailures: [],
    checkpoints: [],
    peerLinks: [],
    phase: 'completed',
    lastUpdatedAt: NOW,
    ledgerSequence: 1,
    issues: []
  } as unknown as RecoveredMission
}

/** The root is OFF the page; only the follow-up came back from `listMissions`. */
const ROOT = mission('mission_root', 'stonks: what is the market doing')
const FOLLOW_UP = mission('mission_reply', 'and what about semis', 'mission_root')

const ledgerWith = (page: readonly RecoveredMission[], onDisk: readonly RecoveredMission[]): MissionLedger =>
  ({
    getMission: async (missionId: string) => onDisk.find((entry) => entry.metadata.missionId === missionId),
    listMissions: async () => ({ missions: [...page], issues: [], unreadableCount: 0 }),
    flush: async () => undefined
  }) as unknown as MissionLedger

describe('a page boundary never renames a conversation', () => {
  it('returns the root of a conversation whose first turn fell off the page', async () => {
    const response = await readMissionHistory(ledgerWith([FOLLOW_UP], [ROOT, FOLLOW_UP]))
    expect(response.ok).toBe(true)
    if (!response.ok) return
    const ids = response.data.missions.map((entry) => entry.missionId)
    // Without this the renderer walks `continuesFrom` into nothing, keeps the
    // follow-up as the root, and the row takes that turn's prompt as its name.
    expect(ids).toContain('mission_root')
    expect(ids).toContain('mission_reply')
  })

  it('carries the root prompt, because the row is named from it', async () => {
    const response = await readMissionHistory(ledgerWith([FOLLOW_UP], [ROOT, FOLLOW_UP]))
    if (!response.ok) throw new Error('history unavailable')
    const root = response.data.missions.find((entry) => entry.missionId === 'mission_root')
    expect(root?.prompt).toBe('stonks: what is the market doing')
  })

  it('brings back identity, not transcript', async () => {
    /*
     * The page is bounded by BYTES, because a mission carries up to 500 events
     * and some are megabytes. Ancestors are appended after that budget, so
     * they have to be nearly free: ids and prompts, no events. Raising the
     * mission count instead would only move the cliff.
     */
    const heavy = {
      ...ROOT,
      events: Array.from({ length: 40 }, () => ({ type: 'noise' }))
    } as unknown as RecoveredMission
    const response = await readMissionHistory(ledgerWith([FOLLOW_UP], [heavy, FOLLOW_UP]))
    if (!response.ok) throw new Error('history unavailable')
    const root = response.data.missions.find((entry) => entry.missionId === 'mission_root')
    expect(root?.events).toEqual([])
  })

  it('walks a whole chain, not just one hop', async () => {
    const middle = mission('mission_middle', 'second turn', 'mission_root')
    const head = mission('mission_head', 'third turn', 'mission_middle')
    const response = await readMissionHistory(ledgerWith([head], [ROOT, middle, head]))
    if (!response.ok) throw new Error('history unavailable')
    const ids = response.data.missions.map((entry) => entry.missionId)
    expect(ids).toContain('mission_middle')
    expect(ids).toContain('mission_root')
  })

  it('stops where an ancestor is unreadable instead of failing the whole history', async () => {
    /*
     * A torn or deleted ancestor ends that branch of the walk where it stands.
     * The row keeps whatever root it can reach — the old behaviour — rather
     * than taking the history down with it.
     */
    const ledger = {
      getMission: async () => {
        throw new Error('torn file')
      },
      listMissions: async () => ({ missions: [FOLLOW_UP], issues: [], unreadableCount: 0 }),
      flush: async () => undefined
    } as unknown as MissionLedger
    const response = await readMissionHistory(ledger)
    expect(response.ok).toBe(true)
    if (!response.ok) return
    expect(response.data.missions.map((entry) => entry.missionId)).toEqual(['mission_reply'])
  })

  it('adds nothing when the page already holds the root', async () => {
    const response = await readMissionHistory(ledgerWith([FOLLOW_UP, ROOT], [ROOT, FOLLOW_UP]))
    if (!response.ok) throw new Error('history unavailable')
    expect(response.data.missions).toHaveLength(2)
  })
})
