import type { PublicRecoveredMission, PublicRuntimeStatus } from '../../shared/ipc.js'

/**
 * Every status word the shell shows, derived from discovery and mission state
 * and from nothing else.
 *
 * This module exists because the product's whole claim is that you can always
 * tell which runtime and model are really in play. A label that can drift from
 * what discovery proved -- a hard-coded `LIVE`, an optimistic default, a chip
 * that survives a failed probe -- turns that claim into decoration. So the
 * labels are pure functions with tests, and the tests are mutation-checked.
 *
 * The load-bearing invariant, stated once: **nothing renders as LIVE or READY
 * unless discovery reported the runtime ready.** Everything else here is
 * presentation.
 */

/** Route-picker and settings status tags, in the design's vocabulary. */
export type RouteTag =
  | 'ACTIVE'
  | 'READY'
  | 'PREVIEW'
  | 'SIGN IN'
  | 'UNAVAILABLE'
  | 'API'
  | 'LOCAL'
  | 'PLANNED'

/** How far a runtime's integration actually goes in this build. */
export type IntegrationLevel =
  /** Can own a live mission end to end today. */
  | 'live'
  /** Discovered and selectable, but the adapter is not finished. */
  | 'preview'
  /** Drawn in the design, not implemented at all. */
  | 'planned'

/**
 * How far each integration actually goes, in ONE place.
 *
 * This lived in three files -- the route picker, Settings and the first-launch
 * panel -- and drifted the moment a runtime was added. On 2026-09-02 the same
 * screen showed Cursor Agent as READY in Settings and PLANNED in the welcome
 * panel, which is precisely the "you can always tell what is really in play"
 * claim failing at the only moment a newcomer looks. A new runtime is now one
 * edit, not three.
 */
export const RUNTIME_INTEGRATION: Readonly<Record<string, IntegrationLevel>> = {
  codex: 'live',
  claude: 'live',
  cursor: 'live',
  gemini: 'planned',
  omniroute: 'planned'
}

/** What a runtime this build does not know should be treated as. */
export function integrationOf(runtimeId: string): IntegrationLevel {
  return RUNTIME_INTEGRATION[runtimeId] ?? 'planned'
}

export interface RouteRowStatus {
  readonly tag: RouteTag
  /** Whether the row may be chosen as the active route right now. */
  readonly selectable: boolean
  /** Sentence shown under the row. Always says why, never just what. */
  readonly detail: string
}

/**
 * The one function that may say a runtime is usable. `ready` comes from a
 * probe that actually ran; `status` distinguishes why a runtime is not.
 */
export function runtimeIsUsable(runtime: PublicRuntimeStatus): boolean {
  return runtime.ready && runtime.status === 'ready'
}

/**
 * The tag a route row wears, given what discovery proved and whether this is
 * the row the composer is set to.
 *
 * ACTIVE is drawn in the same lime as READY and reads as a stronger claim, so
 * it may only sit on a row that could actually run. A fresh install defaults
 * the route to Codex; before this, that row wore a lime ACTIVE tag directly
 * above the sentence "Codex CLI was not found on this machine."
 */
export function routeRowTag(status: RouteRowStatus, isActive: boolean): RouteTag {
  return isActive && status.selectable ? 'ACTIVE' : status.tag
}

export function routeRowStatus(
  runtime: PublicRuntimeStatus,
  integration: IntegrationLevel,
  isActive: boolean
): RouteRowStatus {
  if (integration === 'planned') {
    return {
      tag: 'PLANNED',
      selectable: false,
      detail: 'Not built yet. Shown so the roadmap is visible, not because it works.'
    }
  }
  if (!runtime.installed) {
    return {
      tag: 'UNAVAILABLE',
      selectable: false,
      detail: `${runtime.displayName} was not found on this machine.`
    }
  }
  if (runtime.status === 'auth-required' || runtime.auth === 'unauthenticated') {
    return {
      tag: 'SIGN IN',
      selectable: false,
      detail: `Installed, but ${runtime.displayName} is not signed in.`
    }
  }
  if (!runtimeIsUsable(runtime)) {
    const reason =
      runtime.status === 'offline'
        ? 'could not be reached'
        : runtime.status === 'probe-failed'
          ? 'did not answer its version probe'
          : 'is not ready'
    return {
      tag: 'UNAVAILABLE',
      selectable: false,
      detail: `${runtime.displayName} ${reason}.`
    }
  }
  // Ready, and the adapter is only partly built: selectable, never called live.
  if (integration === 'preview') {
    return {
      tag: 'PREVIEW',
      selectable: true,
      detail: `Signed in and detected. The ${runtime.displayName} adapter is not finished, so runs are not durable yet.`
    }
  }
  return {
    tag: isActive ? 'ACTIVE' : 'READY',
    selectable: true,
    detail: 'Signed in on this machine, using your own account.'
  }
}

/** Count for the sidebar's "N connected" line. Only usable runtimes count. */
export function connectedRuntimeCount(runtimes: readonly PublicRuntimeStatus[]): number {
  return runtimes.filter(runtimeIsUsable).length
}

/** Sidebar / roster status vocabulary from the design. */
export type TeammateStatus = 'working' | 'approval-needed' | 'idle' | 'blocked'

export interface TeammateStatusView {
  readonly status: TeammateStatus
  readonly label: string
  /** Semantic token name, never a literal color. */
  readonly tone: 'lime' | 'amber' | 'muted' | 'red'
  readonly pulse: boolean
}

export function teammateStatusView(input: {
  /**
   * The runtime this teammate's own work is on, when they have any. A
   * teammate with no missions has no runtime of their own, and judging every
   * teammate against one hard-coded runtime told people their teammate needed
   * a sign-in while she was visibly working on another one.
   */
  readonly runtime: PublicRuntimeStatus | undefined
  /** Whether ANY runtime could take work right now. */
  readonly anyRuntimeUsable?: boolean
  readonly hasRunningMission: boolean
  readonly pendingApprovals: number
  readonly roleLabel: string
}): TeammateStatusView {
  // Nobody can work when nothing is signed in, whatever this teammate has
  // done before.
  if (input.anyRuntimeUsable === false) {
    return { status: 'blocked', label: 'Runtime sign-in required', tone: 'red', pulse: false }
  }
  // A teammate whose OWN runtime cannot run is blocked, even if a mission
  // looks active in the renderer -- the sign-in wall outranks optimistic
  // local state. One with no runtime of their own is simply idle.
  if (input.runtime !== undefined && !runtimeIsUsable(input.runtime)) {
    return {
      status: 'blocked',
      label: 'Runtime sign-in required',
      tone: 'red',
      pulse: false
    }
  }
  if (input.pendingApprovals > 0) {
    return { status: 'approval-needed', label: 'Approval needed', tone: 'amber', pulse: false }
  }
  if (input.hasRunningMission) {
    return { status: 'working', label: `${input.roleLabel} · working`, tone: 'lime', pulse: true }
  }
  return { status: 'idle', label: `${input.roleLabel} · idle`, tone: 'muted', pulse: false }
}

export interface MissionPhaseView {
  readonly label: string
  readonly tone: 'lime' | 'blue' | 'amber' | 'red' | 'muted'
  /** Uppercase tag for the missions table. */
  readonly tag: string
}

export function missionPhaseView(
  phase: PublicRecoveredMission['phase'] | 'running',
  hasIntegrityIssues = false
): MissionPhaseView {
  if (phase === 'running') return { label: 'Running', tone: 'lime', tag: 'RUNNING' }
  if (phase === 'interrupted') {
    return { label: 'Interrupted', tone: 'red', tag: 'INTERRUPTED' }
  }
  if (phase === 'failed') return { label: 'Failed', tone: 'red', tag: 'FAILED' }
  if (phase === 'cancelled') return { label: 'Cancelled', tone: 'muted', tag: 'CANCELLED' }
  // Completed, but the ledger could not be read to its end: the run finished
  // and its record did not, and the design's receipt card must not print
  // `verified` over that.
  if (hasIntegrityIssues) {
    return { label: 'Completed · receipt incomplete', tone: 'amber', tag: 'COMPLETED' }
  }
  return { label: 'Completed', tone: 'blue', tag: 'COMPLETED' }
}

/**
 * The word the receipt card prints against the ledger path. `verified` is a
 * claim about durability, so it requires zero integrity issues -- not merely
 * that a mission was recovered.
 */
export function ledgerVerificationLabel(integrityIssueCount: number): 'verified' | 'incomplete' {
  return integrityIssueCount === 0 ? 'verified' : 'incomplete'
}

/** Short mission id for mono provenance: real UUID prefix, never a fake counter. */
export function shortMissionId(missionId: string): string {
  const bare = missionId.startsWith('mission_') ? missionId.slice('mission_'.length) : missionId
  return bare.slice(0, 8)
}

/** Checkpoint display id. Epochs are 1-based in the ledger. */
export function checkpointLabel(epoch: number): string {
  return `ck_${epoch}`
}

/**
 * Whether the route control can hand the running mission to another runtime.
 *
 * A handoff is addressed by runId, and there is a real window -- between the
 * user submitting and the host's receipt coming back -- where a mission is
 * visibly running but has no id yet. A control offered in that window looks
 * available and silently does nothing, which is the exact failure this shell
 * refuses everywhere else. So the state is named, and the control says why.
 *
 * `switching` is a handoff already in flight: a second one would race the
 * first, and the first is irreversible.
 */
export type HandoffAvailability = 'idle' | 'starting' | 'available' | 'switching'

export function handoffAvailability(
  running: boolean,
  hasRunId: boolean,
  switching: boolean
): HandoffAvailability {
  if (switching) return 'switching'
  if (!running) return 'idle'
  return hasRunId ? 'available' : 'starting'
}

/** What the route control says about itself. `undefined` where a title adds nothing. */
export function handoffTitle(availability: HandoffAvailability): string | undefined {
  if (availability === 'available') return 'Hand this mission to another runtime'
  if (availability === 'starting') return 'Waiting for the mission to start before it can be handed over'
  if (availability === 'switching') return 'Handing this mission over'
  return undefined
}

/**
 * A face moves only while its teammate is doing something. Everything else --
 * idle, waiting on an approval, blocked -- is still, and says so through the
 * presence dot and the label instead.
 */
export function faceActivityFor(status: TeammateStatus): 'working' | 'still' {
  return status === 'working' ? 'working' : 'still'
}

export function facePresenceFor(status: TeammateStatus): 'working' | 'approval' | 'blocked' | 'none' {
  if (status === 'working') return 'working'
  if (status === 'approval-needed') return 'approval'
  if (status === 'blocked') return 'blocked'
  return 'none'
}

/**
 * How many rows of one runtime's models the picker shows before it stops and
 * says how many more there are.
 *
 * A route group is usually a handful of rows. One runtime here lists 217, and
 * an unannounced wall of them buries every other runtime below it -- the list
 * scrolls, so the rows underneath are not visibly there at all. The cap is a
 * presentation choice and must never read as "this is all there is", so what
 * it holds back is COUNTED and stated, and typing in the picker's search
 * lifts it entirely.
 */
export const ROUTE_GROUP_LIMIT = 6

export interface CappedRouteRows<TRow> {
  readonly rows: readonly TRow[]
  /** Rows held back per group, by group name. A group at the cap is absent. */
  readonly hiddenByGroup: ReadonlyMap<string, number>
}

/**
 * Cap each group to `limit` rows, keeping the order they arrived in.
 *
 * Two rules make the cap safe to show:
 * - The ACTIVE row is always kept, even when it sits below the cut. A picker
 *   that hides the route you are on cannot be read as a picker at all.
 * - Nothing is dropped silently: every group over the cap reports how many
 *   rows it is not showing, and the caller must say so.
 *
 * While a search is running there is no cap: the person has narrowed the list
 * themselves, and a second, invisible narrowing on top of theirs would make
 * the result a lie about what matched.
 */
export function capRouteRows<TRow extends { readonly group: string; readonly tag: RouteTag }>(
  rows: readonly TRow[],
  limit: number,
  searching: boolean
): CappedRouteRows<TRow> {
  if (searching) return { rows, hiddenByGroup: new Map() }
  const counts = new Map<string, number>()
  const kept: TRow[] = []
  const hidden = new Map<string, number>()
  for (const row of rows) {
    const seen = counts.get(row.group) ?? 0
    counts.set(row.group, seen + 1)
    if (seen < limit) {
      kept.push(row)
      continue
    }
    // Below the cut. The active row displaces the last kept row of its group
    // rather than being hidden, so the count shown stays exactly `limit`.
    if (row.tag === 'ACTIVE') {
      const last = kept.map((entry) => entry.group).lastIndexOf(row.group)
      if (last >= 0) {
        kept.splice(last, 1, row)
        hidden.set(row.group, (hidden.get(row.group) ?? 0) + 1)
        continue
      }
    }
    hidden.set(row.group, (hidden.get(row.group) ?? 0) + 1)
  }
  return { rows: kept, hiddenByGroup: hidden }
}

/** Bytes, in the largest unit that keeps the number readable. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return 'unknown'
  if (bytes < 1024) return `${String(Math.round(bytes))} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value < 10 ? value.toFixed(1) : String(Math.round(value))} ${units[unit]}`
}

/**
 * What a prune preview says out loud, before anyone agrees to it.
 *
 * The count of what would go is never the whole story: some old missions are
 * kept because a conversation being kept continues from them, and some
 * because they are running. A preview that mentioned only the deletions would
 * read as though the rest had been missed.
 */
export function prunePreviewSummary(preview: {
  readonly deleted: readonly string[]
  readonly keptForContinuity: readonly string[]
  readonly keptAsRunning: readonly string[]
}): string {
  const missions = (count: number): string => `${String(count)} mission${count === 1 ? '' : 's'}`
  if (preview.deleted.length === 0) {
    const because: string[] = []
    if (preview.keptForContinuity.length > 0) {
      because.push(`${missions(preview.keptForContinuity.length)} still part of a conversation you are keeping`)
    }
    if (preview.keptAsRunning.length > 0) because.push(`${missions(preview.keptAsRunning.length)} running right now`)
    return because.length === 0
      ? 'Nothing is old enough to delete.'
      : `Nothing would be deleted: ${because.join(', and ')}.`
  }
  const kept: string[] = []
  if (preview.keptForContinuity.length > 0) {
    kept.push(`${missions(preview.keptForContinuity.length)} kept as part of a conversation you are keeping`)
  }
  if (preview.keptAsRunning.length > 0) kept.push(`${missions(preview.keptAsRunning.length)} kept because they are running`)
  return `Delete ${missions(preview.deleted.length)} for good${kept.length === 0 ? '' : `, with ${kept.join(' and ')}`}.`
}
