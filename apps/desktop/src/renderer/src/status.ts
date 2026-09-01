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
  readonly runtime: PublicRuntimeStatus | undefined
  readonly hasRunningMission: boolean
  readonly pendingApprovals: number
  readonly roleLabel: string
}): TeammateStatusView {
  // A teammate whose runtime cannot run is blocked, even if a mission looks
  // active in the renderer -- the sign-in wall outranks optimistic local state.
  if (input.runtime === undefined || !runtimeIsUsable(input.runtime)) {
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
