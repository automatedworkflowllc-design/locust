import { workspaceIdFor } from './workspace.js'
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

/**
 * Which runtimes are still, as far as the record knows, at their limit.
 *
 * Per runtime, the latest event in time across all missions decides: a
 * `route.limit_detected` of kind `quota-exhausted` puts it at its limit, a
 * later `run.completed` on the same runtime takes it off. Same rule the
 * window applies live, applied to the ledger at boot so a reload does not
 * amount to a lie about the account.
 */
export function limitedRuntimesFrom(missions: readonly RecoveredMission[]): Record<string, string> {
  const latest = new Map<string, { readonly at: string; readonly said: string | undefined }>()
  for (const mission of missions) {
    for (const event of mission.events) {
      let said: string | undefined
      let relevant = false
      if (event.type === 'route.limit_detected' && event.payload.kind === 'quota-exhausted') {
        relevant = true
        said = event.payload.message
      } else if (event.type === 'run.completed') {
        relevant = true
      }
      if (!relevant) continue
      const runtime = event.sourceAdapter
      const current = latest.get(runtime)
      if (current === undefined || event.occurredAt > current.at) latest.set(runtime, { at: event.occurredAt, said })
    }
  }
  const limited: Record<string, string> = {}
  for (const [runtime, entry] of latest) {
    if (entry.said !== undefined) limited[runtime] = entry.said
  }
  return limited
}

/**
 * The latest still-allowed rate-limit reading per runtime, from the ledger,
 * so a reload does not forget what the route chip said. A limit that hit
 * (`route.limit_detected`) is the other map; this one is the number before it.
 */
export function usageWindowsFrom(missions: readonly RecoveredMission[]): Record<string, string> {
  const latest = new Map<string, { readonly at: string; readonly said: string }>()
  for (const mission of missions) {
    for (const event of mission.events) {
      if (event.type !== 'adapter.diagnostic' || !/\.usage_window$/.test(event.payload.code)) continue
      const runtime = event.sourceAdapter
      const current = latest.get(runtime)
      if (current === undefined || event.occurredAt > current.at) latest.set(runtime, { at: event.occurredAt, said: event.payload.message })
    }
  }
  const windows: Record<string, string> = {}
  for (const [runtime, entry] of latest) windows[runtime] = entry.said
  return windows
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
    // Which folder it ran in, so the shell can open the conversation that
    // belongs to the folder it was launched in.
    workspaceId: mission.metadata.workspaceId,
    prompt: mission.metadata.prompt,
    runtime: mission.metadata.runtime,
    model: mission.metadata.model,
    requestedRouteId: mission.metadata.requestedRouteId,
    resolvedRouteId: mission.metadata.resolvedRouteId,
    cliVersion: mission.metadata.cliVersion,
    sandbox: mission.metadata.sandbox,
    // What was ASKED for, beside what it was allowed. Without it a reopened
    // plan is indistinguishable from an ordinary read-only run -- the ledger
    // gained the field and the projection did not pass it on, which is the
    // half a unit test cannot see and a drive can (2026-09-06).
    ...(mission.metadata.mode === undefined ? {} : { mode: mission.metadata.mode }),
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
        }),
    // Copied by kind rather than spread: each carries a different counter, and
    // a spread would let a future field ride out to the renderer unreviewed.
    ...(mission.metadata.startedBy === undefined
      ? {}
      : mission.metadata.startedBy.kind === 'relay'
        ? { startedBy: { kind: 'relay' as const, hop: mission.metadata.startedBy.hop } }
        : mission.metadata.startedBy.kind === 'routine'
          ? {
              startedBy: {
                kind: 'routine' as const,
                routineId: mission.metadata.startedBy.routineId,
                step: mission.metadata.startedBy.step
              }
            }
          : { startedBy: { kind: 'resume' as const, epoch: mission.metadata.startedBy.epoch } })
  }
}

/**
 * Ledger files that raised an issue and yielded NO mission at all.
 *
 * Found by Astra, 2026-09-08, writing damaged JSONL by hand and rendering the
 * real Missions component from the result. The reader is sound: for all six
 * damage shapes it keeps exactly the safe prefix and reports the right issue
 * code. What is not sound is what the screen then says.
 *
 * A file damaged in its BODY still recovers a mission, that mission carries
 * `integrityIssueCount`, and the header reads "1 with an incomplete receipt".
 * A file damaged in its HEADER -- or one over the size limit -- recovers no
 * mission at all, so there is nothing to carry a per-mission count, and the
 * header reads **"0 local · ledger verified"**. The snapshot's own issue is
 * right there, and `issueCount` carried it faithfully all the way across the
 * IPC boundary, where App.tsx never read it.
 *
 * So the worse the damage, the more confident the reassurance. That is the
 * exact shape this app spends its time hunting: the mechanism was fine and the
 * reporting lied.
 *
 * Counted by distinct mission id rather than by issue, because one bad file
 * raises several -- a truncated header produces both `truncated-tail` and
 * `invalid-record` -- and "2 could not be read" for one file would be a new
 * false statement in place of the old one. An issue with no id at all is
 * still a file that could not be read, so it counts once.
 */
export function unreadableFileCount(snapshot: {
  readonly missions: readonly RecoveredMission[]
  readonly issues: readonly { readonly missionId?: string }[]
}): number {
  const recovered = new Set(snapshot.missions.map((mission) => mission.metadata.missionId))
  const unreadable = new Set<string>()
  let anonymous = 0
  for (const issue of snapshot.issues) {
    if (issue.missionId === undefined) {
      anonymous += 1
      continue
    }
    if (!recovered.has(issue.missionId)) unreadable.add(issue.missionId)
  }
  return unreadable.size + (anonymous > 0 ? 1 : 0)
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
  workroom?: Workroom,
  /** The folder this window works in; defaults to the process's own. */
  workspacePath: string = process.cwd()
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
        currentWorkspaceId: workspaceIdFor(workspacePath),
        issueCount: snapshot.issues.length,
        unreadableCount: unreadableFileCount(snapshot),
        limitedRuntimes: limitedRuntimesFrom(snapshot.missions),
        usageWindows: usageWindowsFrom(snapshot.missions)
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
