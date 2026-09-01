import type { MissionLedger, RecoveredMission } from '@teammate/mission-store'
import type { MissionHistoryResponse, PublicRecoveredMission } from '../shared/ipc.js'

const MAX_HISTORY_MISSIONS = 20
const MAX_HISTORY_EVENTS = 500
const MAX_HISTORY_CHECKPOINTS = 25

export function publicRecoveredMission(mission: RecoveredMission): PublicRecoveredMission {
  const events = mission.events.length <= MAX_HISTORY_EVENTS
    ? mission.events
    : [mission.events[0], ...mission.events.slice(-(MAX_HISTORY_EVENTS - 1))]
        .filter((event) => event !== undefined)
  const hostFailureMessage = mission.hostFailures.at(-1)?.message
  return {
    missionId: mission.metadata.missionId,
    runId: mission.metadata.runId,
    prompt: mission.metadata.prompt,
    runtime: mission.metadata.runtime,
    model: mission.metadata.model,
    requestedRouteId: mission.metadata.requestedRouteId,
    resolvedRouteId: mission.metadata.resolvedRouteId,
    cliVersion: mission.metadata.cliVersion,
    createdAt: mission.metadata.createdAt,
    lastUpdatedAt: mission.lastUpdatedAt,
    phase: mission.phase,
    events,
    eventCount: mission.events.length,
    eventsTruncated: events.length !== mission.events.length,
    ...(hostFailureMessage === undefined ? {} : { hostFailureMessage }),
    integrityIssueCount: mission.issues.length,
    // Bounded projection: counts and causes, not the digest or the summary.
    checkpoints: mission.checkpoints.slice(-MAX_HISTORY_CHECKPOINTS).map((checkpoint) => ({
      epoch: checkpoint.epoch,
      reason: checkpoint.reason,
      resumeSafety: checkpoint.resumeSafety,
      safetyReason: checkpoint.safetyReason,
      createdAt: checkpoint.createdAt,
      unsettledActions: checkpoint.unsettledActions.map((action) => ({
        itemId: action.itemId,
        name: action.name
      }))
    }))
  }
}

export async function readMissionHistory(ledger: MissionLedger): Promise<MissionHistoryResponse> {
  try {
    const snapshot = await ledger.listMissions({ limit: MAX_HISTORY_MISSIONS })
    return {
      ok: true,
      data: {
        missions: snapshot.missions.slice(0, MAX_HISTORY_MISSIONS).map(publicRecoveredMission),
        issueCount: snapshot.issues.length
      }
    }
  } catch {
    return {
      ok: false,
      error: {
        code: 'HISTORY_UNAVAILABLE',
        message: 'Local mission history could not be read.'
      }
    }
  }
}
