import type { MissionLedger, RecoveredMission, Workroom, WorkroomMessage } from '@teammate/mission-store'
import type {
  MissionDeleteResponse,
  MissionHistoryResponse,
  PublicPeerMessage,
  PublicRecoveredMission
} from '../shared/ipc.js'

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

/**
 * Join a mission's peer links with the workroom's messages. The ledger holds
 * only ids, so the text comes from the channel; a link whose message is gone
 * is kept with `text: null` rather than dropped, because "this mission was
 * shown a message that can no longer be read" is itself worth knowing.
 */
export function publicPeerMessages(
  mission: RecoveredMission,
  workroomMessages: ReadonlyMap<string, WorkroomMessage>
): readonly PublicPeerMessage[] {
  return mission.peerLinks.map((link) => {
    const message = workroomMessages.get(link.messageId)
    if (message === undefined) {
      const unknown = { teammateId: link.peerTeammateId, name: 'a teammate' }
      return {
        messageId: link.messageId,
        direction: link.direction,
        from: link.direction === 'received' ? unknown : { teammateId: '', name: '' },
        to: link.direction === 'received' ? { teammateId: '', name: '' } : unknown,
        text: null,
        at: link.occurredAt
      }
    }
    return {
      messageId: message.messageId,
      direction: link.direction,
      from: { teammateId: message.from.teammateId, name: message.from.name },
      to: { teammateId: message.to.teammateId, name: message.to.name },
      text: message.text,
      at: message.postedAt
    }
  })
}

export function publicRecoveredMission(
  mission: RecoveredMission,
  workroomMessages: ReadonlyMap<string, WorkroomMessage> = new Map()
): PublicRecoveredMission {
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
    })),
    peerMessages: publicPeerMessages(mission, workroomMessages),
    ...(mission.metadata.continuesFrom === undefined
      ? {}
      : {
          continuesFrom: {
            missionId: mission.metadata.continuesFrom.missionId,
            checkpointEpoch: mission.metadata.continuesFrom.checkpointEpoch,
            reason: mission.metadata.continuesFrom.reason
          }
        })
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

export async function readMissionHistory(
  ledger: MissionLedger,
  workroom?: Workroom
): Promise<MissionHistoryResponse> {
  try {
    const snapshot = await ledger.listMissions({ limit: MAX_HISTORY_MISSIONS })
    // The workroom is joined best-effort: a channel that cannot be read makes
    // every peer message show as unreadable, which is the truthful state, and
    // must not take the mission history down with it.
    const workroomMessages = new Map<string, WorkroomMessage>()
    if (workroom !== undefined) {
      try {
        for (const message of (await workroom.read()).messages) {
          workroomMessages.set(message.messageId, message)
        }
      } catch {
        // Every link then reads as `text: null`, which is what happened.
      }
    }
    return {
      ok: true,
      data: {
        missions: withinByteBudget(
          snapshot.missions
            .slice(0, MAX_HISTORY_MISSIONS)
            .map((mission) => publicRecoveredMission(mission, workroomMessages))
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

/**
 * Delete a mission's record, unless it is still running.
 *
 * Deleting a live mission would orphan a process that keeps writing into a
 * file that no longer exists -- and it would take the person's only stop
 * control with it. So the answer is a refusal that names the remedy. Nothing
 * here touches the workroom: a deleted mission's messages stay, attributed,
 * because the person they were sent to still has a right to see them.
 */
export async function deleteMissionRecord(
  ledger: MissionLedger,
  missionId: unknown,
  isLive: (missionId: string) => boolean
): Promise<MissionDeleteResponse> {
  if (typeof missionId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(missionId)) {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'That mission does not exist.' } }
  }
  if (isLive(missionId)) {
    return {
      ok: false,
      error: { code: 'LIVE', message: 'That mission is still running. Stop it first, then delete it.' }
    }
  }
  try {
    const removed = await ledger.deleteMission(missionId)
    return removed
      ? { ok: true }
      : { ok: false, error: { code: 'NOT_FOUND', message: 'That mission does not exist.' } }
  } catch {
    return { ok: false, error: { code: 'INTERNAL_ERROR', message: 'The mission could not be deleted.' } }
  }
}
