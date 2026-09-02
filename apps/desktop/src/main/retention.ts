import type { MissionLedger } from '@teammate/mission-store'

import type { MissionPruneRequest, MissionPruneResponse, StorageReportResponse } from '../shared/ipc.js'

/**
 * Retention: deleting old missions in bulk.
 *
 * Two things are decided here rather than in the renderer, because a window
 * must not be able to talk the host into deleting more than it meant to:
 *
 * - The CUTOFF is computed from the host's own clock. The renderer sends a
 *   number of days, which is checked; it never sends an instant. A window
 *   that sent a date could send one in the future and take everything.
 * - WHICH MISSIONS ARE RUNNING is answered by the transports, not asked of
 *   the renderer, for the same reason `deleteMission` refuses a live mission.
 *
 * There is no automatic pruning anywhere in this app. A durable local record
 * is the product's whole claim, and deleting one on a timer -- without the
 * person present, and with no undo -- would quietly take history nobody
 * agreed to lose. Retention happens when someone asks for it, after they have
 * been shown exactly what would go.
 */

/** Bounds on the age a window may ask for. A day is the shortest honest unit. */
export const MIN_RETENTION_DAYS = 1
export const MAX_RETENTION_DAYS = 3650

export function retentionCutoff(olderThanDays: unknown, now: Date): string | undefined {
  if (typeof olderThanDays !== 'number' || !Number.isFinite(olderThanDays)) return undefined
  const days = Math.trunc(olderThanDays)
  if (days < MIN_RETENTION_DAYS || days > MAX_RETENTION_DAYS) return undefined
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString()
}

export async function readStorageReport(ledger: MissionLedger): Promise<StorageReportResponse> {
  try {
    const report = await ledger.storageReport()
    return { ok: true, data: report }
  } catch {
    return {
      ok: false,
      error: { code: 'STORAGE_UNAVAILABLE', message: 'The local mission history could not be measured.' }
    }
  }
}

export async function pruneMissionRecords(
  ledger: MissionLedger,
  request: unknown,
  liveMissionIds: () => readonly string[],
  now: () => Date
): Promise<MissionPruneResponse> {
  const payload = (typeof request === 'object' && request !== null ? request : {}) as Partial<MissionPruneRequest>
  const before = retentionCutoff(payload.olderThanDays, now())
  if (before === undefined) {
    return {
      ok: false,
      error: {
        code: 'PRUNE_REFUSED',
        message: `Choose an age between ${String(MIN_RETENTION_DAYS)} and ${String(MAX_RETENTION_DAYS)} days.`
      }
    }
  }
  // Anything but an explicit false is a preview. A malformed request must
  // never be the thing that deletes a person's history.
  const dryRun = payload.dryRun !== false
  try {
    const result = await ledger.pruneMissions({
      before,
      dryRun,
      protectMissionIds: liveMissionIds()
    })
    return {
      ok: true,
      data: {
        deleted: result.deleted,
        keptForContinuity: result.keptForContinuity,
        keptAsRunning: result.keptAsRunning,
        previewed: dryRun
      }
    }
  } catch {
    return { ok: false, error: { code: 'INTERNAL_ERROR', message: 'The missions could not be pruned.' } }
  }
}
