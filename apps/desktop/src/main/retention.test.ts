import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it, vi } from 'vitest'

import type { MissionLedger, MissionPruneOptions } from '@teammate/mission-store'

import {
  MAX_RETENTION_DAYS,
  MIN_RETENTION_DAYS,
  pruneMissionRecords,
  readStorageReport,
  retentionCutoff
} from './retention.js'

const NOW = new Date('2026-09-02T12:00:00.000Z')

function ledgerWith(overrides: Partial<MissionLedger> = {}): MissionLedger {
  return {
    createMission: async () => undefined,
    appendEvents: async () => undefined,
    appendHostFailure: async () => undefined,
    createCheckpoint: async () => {
      throw new Error('not used in this test')
    },
    appendPeerLinks: async () => undefined, appendEditCheck: async () => undefined,
    deleteMission: async () => true,
    listTrashedMissions: async () => [],
    restoreMission: async () => true,
    emptyTrash: async () => 0,
    storageReport: async () => ({ missionCount: 0, byteTotal: 0, unreadableCount: 0 }),
    pruneMissions: async () => ({ deleted: [], failed: [], unreadable: [], keptForContinuity: [], keptAsRunning: [] }),
    getMission: async () => undefined,
    listMissions: async () => ({ missions: [], issues: [], unreadableCount: 0 }),
    flush: async () => undefined,
    ...overrides
  }
}

describe('the cutoff a window may ask for', () => {
  it('is computed from the host clock, not from anything the window sent', () => {
    expect(retentionCutoff(30, NOW)).toBe('2026-08-03T12:00:00.000Z')
  })

  it('refuses an age that is not a finite number of days', () => {
    for (const value of ['30', null, undefined, Number.NaN, Number.POSITIVE_INFINITY, {}]) {
      expect(retentionCutoff(value, NOW)).toBeUndefined()
    }
  })

  it('refuses an age outside its bounds, in either direction', () => {
    expect(retentionCutoff(0, NOW)).toBeUndefined()
    expect(retentionCutoff(-1, NOW)).toBeUndefined()
    expect(retentionCutoff(MAX_RETENTION_DAYS + 1, NOW)).toBeUndefined()
    expect(retentionCutoff(MIN_RETENTION_DAYS, NOW)).toBeDefined()
    expect(retentionCutoff(MAX_RETENTION_DAYS, NOW)).toBeDefined()
  })
})

describe('pruning, as the host offers it', () => {
  it('previews by default, and only an explicit false actually deletes', async () => {
    const pruneMissions = vi.fn(async (_options: MissionPruneOptions) => ({
      deleted: ['mission_1'],
      failed: [],
      unreadable: [],
      keptForContinuity: [],
      keptAsRunning: []
    }))
    const ledger = ledgerWith({ pruneMissions })

    for (const request of [
      { olderThanDays: 30 },
      { olderThanDays: 30, dryRun: true },
      { olderThanDays: 30, dryRun: 'no' },
      'not an object'
    ]) {
      pruneMissions.mockClear()
      const response = await pruneMissionRecords(ledger, request, () => [], () => NOW)
      if (typeof request === 'string') {
        // No age at all: refused before the ledger is touched.
        expect(response.ok).toBe(false)
        expect(pruneMissions).not.toHaveBeenCalled()
        continue
      }
      expect(pruneMissions.mock.calls[0]?.[0]?.dryRun).toBe(true)
      expect(response).toMatchObject({ ok: true, data: { previewed: true } })
    }

    pruneMissions.mockClear()
    const done = await pruneMissionRecords(ledger, { olderThanDays: 30, dryRun: false }, () => [], () => NOW)
    expect(pruneMissions.mock.calls[0]?.[0]?.dryRun).toBe(false)
    expect(done).toMatchObject({ ok: true, data: { previewed: false, deleted: ['mission_1'] } })
  })

  // L8 (the code review): the confirm recomputed the cutoff and never passed
  // the previewed ids, so a panel left open deleted more than it showed; and
  // the handler dropped the owners of missions only moved to the trash.
  it('deletes only what the preview showed, and leaves the owners for the trash', async () => {
    const pruneMissions = vi.fn(async (_options: MissionPruneOptions) => ({ deleted: ['mission_1'], failed: [], unreadable: [], keptForContinuity: [], keptAsRunning: [] }))
    await pruneMissionRecords(ledgerWith({ pruneMissions }), { olderThanDays: 30, dryRun: false, only: ['mission_1'] }, () => [], () => NOW)
    expect(pruneMissions.mock.calls[0]?.[0]?.only).toEqual(['mission_1'])
    // A preview is never bounded -- it is what finds the list.
    pruneMissions.mockClear()
    await pruneMissionRecords(ledgerWith({ pruneMissions }), { olderThanDays: 30, dryRun: true, only: ['mission_1'] }, () => [], () => NOW)
    expect(pruneMissions.mock.calls[0]?.[0]?.only).toBeUndefined()
    const index = readFileSync(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8')
    const handler = index.slice(index.indexOf('ipcMain.handle(MISSION_PRUNE_CHANNEL'), index.indexOf('const deletedThisSession'))
    expect(handler).not.toContain('unassignMission')
  })

  it('tells the ledger which missions are running, from the transports', async () => {
    const pruneMissions = vi.fn(async (_options: MissionPruneOptions) => ({
      deleted: [],
      failed: [],
      unreadable: [],
      keptForContinuity: [],
      keptAsRunning: ['mission_live']
    }))
    await pruneMissionRecords(
      ledgerWith({ pruneMissions }),
      { olderThanDays: 7, dryRun: false },
      () => ['mission_live'],
      () => NOW
    )
    expect(pruneMissions.mock.calls[0]?.[0]?.protectMissionIds).toEqual(['mission_live'])
  })

  it('refuses an age it will not honour, without touching the ledger', async () => {
    const pruneMissions = vi.fn(async () => ({ deleted: [], failed: [], unreadable: [], keptForContinuity: [], keptAsRunning: [] }))
    const response = await pruneMissionRecords(
      ledgerWith({ pruneMissions }),
      { olderThanDays: 0, dryRun: false },
      () => [],
      () => NOW
    )
    expect(response).toMatchObject({ ok: false, error: { code: 'PRUNE_REFUSED' } })
    expect(pruneMissions).not.toHaveBeenCalled()
  })

  it('reports a failed prune as one, rather than as an empty success', async () => {
    const response = await pruneMissionRecords(
      ledgerWith({
        pruneMissions: async () => {
          throw new Error('disk gone')
        }
      }),
      { olderThanDays: 30, dryRun: false },
      () => [],
      () => NOW
    )
    expect(response).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR' } })
  })
})

describe('what the history costs', () => {
  it('passes the ledger report through', async () => {
    const response = await readStorageReport(
      ledgerWith({ storageReport: async () => ({ missionCount: 4, byteTotal: 2048, unreadableCount: 0, oldestUpdatedAt: '2026-01-01T00:00:00.000Z' }) })
    )
    expect(response).toEqual({
      ok: true,
      data: { missionCount: 4, byteTotal: 2048, unreadableCount: 0, oldestUpdatedAt: '2026-01-01T00:00:00.000Z' }
    })
  })

  it('says it could not be measured rather than reporting an empty history', async () => {
    const response = await readStorageReport(
      ledgerWith({
        storageReport: async () => {
          throw new Error('unreadable')
        }
      })
    )
    expect(response).toMatchObject({ ok: false, error: { code: 'STORAGE_UNAVAILABLE' } })
  })
})
