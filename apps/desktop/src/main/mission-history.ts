import type { MissionLedger, RecoveredMission } from '@teammate/mission-store'
import type { MissionHistoryResponse, PublicRecoveredMission } from '../shared/ipc.js'

const MAX_HISTORY_MISSIONS = 20
const MAX_HISTORY_EVENTS = 500
const MAX_HISTORY_CHECKPOINTS = 25
/**
 * Ceiling on one IPC response. The per-mission event window bounds COUNT, not
 * SIZE: a mission of large tool outputs can carry megabytes inside 500 events,
 * and twenty such missions would hand the renderer an unbounded payload to
 * structured-clone in one go. Missions are dropped from the tail -- they are
 * already ordered newest first, so what is lost is the oldest.
 */
const MAX_HISTORY_BYTES = 4 * 1024 * 1024

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
    sandbox: mission.metadata.sandbox,
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

/**
 * Take missions until the response would exceed its byte budget. The first
 * mission is always included even if it alone is over budget: returning an
 * empty history for one large mission would look like "you have no missions",
 * which is a worse failure than a large payload.
 */
export function withinByteBudget(
  missions: readonly PublicRecoveredMission[],
  budget = MAX_HISTORY_BYTES
): readonly PublicRecoveredMission[] {
  const kept: PublicRecoveredMission[] = []
  let used = 0
  for (const mission of missions) {
    const size = Buffer.byteLength(JSON.stringify(mission), 'utf8')
    if (kept.length > 0 && used + size > budget) break
    kept.push(mission)
    used += size
  }
  return kept
}

export async function readMissionHistory(ledger: MissionLedger): Promise<MissionHistoryResponse> {
  try {
    const snapshot = await ledger.listMissions({ limit: MAX_HISTORY_MISSIONS })
    return {
      ok: true,
      data: {
        missions: withinByteBudget(
          snapshot.missions.slice(0, MAX_HISTORY_MISSIONS).map(publicRecoveredMission)
        ),
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
