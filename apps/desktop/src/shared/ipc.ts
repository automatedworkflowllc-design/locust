import type { MissionRuntimeId, NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

export const RUNTIME_DISCOVERY_CHANNEL = 'runtime-discovery:get'
export const CODEX_MISSION_START_CHANNEL = 'codex-mission:start'
export const CODEX_MISSION_CANCEL_CHANNEL = 'codex-mission:cancel'
export const CODEX_MISSION_UPDATE_CHANNEL = 'codex-mission:update'
export const MISSION_HISTORY_CHANNEL = 'mission-history:list'
export const TEAMMATE_LIST_CHANNEL = 'teammates:list'
export const TEAMMATE_CREATE_CHANNEL = 'teammates:create'
export const TEAMMATE_REMOVE_CHANNEL = 'teammates:remove'
export const TEAMMATE_ASSIGN_CHANNEL = 'teammates:assign'

export type LocalRuntimeId = 'codex' | 'claude' | 'omniroute'

export type TeammateHue = 'lime' | 'blue' | 'violet' | 'clay'

export type TeammateRole =
  | 'Code & Migrations'
  | 'Research & Briefs'
  | 'Ops & Scheduling'
  | 'Docs & QA'
  | 'Data & Reporting'
  | 'Custom'

/**
 * A teammate is local identity and routing defaults. It owns no process and
 * grants no capability -- the roster is real without a multi-agent runtime
 * behind it.
 */
export interface PublicTeammate {
  readonly teammateId: string
  readonly name: string
  readonly hue: TeammateHue
  readonly role: TeammateRole
  readonly createdAt: string
}

export interface TeammateCreateRequest {
  readonly name: string
  readonly hue: TeammateHue
  readonly role: TeammateRole
}

export type TeammateListResponse =
  | {
      readonly ok: true
      readonly data: {
        readonly teammates: readonly PublicTeammate[]
        readonly missionOwners: Readonly<Record<string, string>>
      }
    }
  | { readonly ok: false; readonly error: { readonly code: 'TEAMMATES_UNAVAILABLE'; readonly message: string } }

export type TeammateMutationResponse =
  | { readonly ok: true; readonly data: { readonly teammate?: PublicTeammate } }
  | { readonly ok: false; readonly error: { readonly code: 'TEAMMATE_REJECTED'; readonly message: string } }
export type RuntimeAuthState = 'authenticated' | 'unauthenticated' | 'unknown' | 'not-applicable'
export type RuntimeProbeStatus = 'ready' | 'not-installed' | 'auth-required' | 'offline' | 'probe-failed'

export interface PublicRuntimeStatus {
  readonly id: LocalRuntimeId
  readonly displayName: string
  readonly installed: boolean
  readonly version: string | null
  readonly auth: RuntimeAuthState
  readonly ready: boolean
  readonly status: RuntimeProbeStatus
}

export type RuntimeDiscoveryResponse =
  | {
      readonly ok: true
      readonly data: {
        readonly checkedAt: string
        readonly runtimes: readonly PublicRuntimeStatus[]
      }
    }
  | {
      readonly ok: false
      readonly error: {
        readonly code: 'DISCOVERY_FAILED'
        readonly message: string
      }
    }

export type CodexMissionErrorCode =
  | 'INVALID_PROMPT'
  | 'RUN_ALREADY_ACTIVE'
  | 'CODEX_UNAVAILABLE'
  | 'RUNTIME_START_FAILED'
  | 'PERSISTENCE_FAILED'
  | 'RUN_NOT_ACTIVE'
  | 'INTERNAL_ERROR'

export interface CodexMissionError {
  readonly code: CodexMissionErrorCode
  readonly message: string
}

/**
 * How much a mission may touch. `ask` is read-only: the agent inspects and
 * explains, and the OS sandbox refuses every write. `accept-edits` lets it edit
 * files inside the workspace folder the host chose, and nowhere else.
 *
 * Consent is given here, at the start, because `codex exec` has no interactive
 * approval channel -- there is no way for the runtime to stop mid-run and ask.
 * Per-action approval needs the experimental app-server protocol.
 */
export type MissionMode = 'ask' | 'accept-edits'

export interface CodexMissionStartRequest {
  readonly prompt: string
  readonly mode?: MissionMode
}

/**
 * What the renderer needs to say which route a mission is on. Shared by a live
 * start response and a mission restored from the ledger, because a restored
 * mission may be on a runtime this build cannot start.
 */
export interface MissionRouteSummary {
  readonly runId: string
  readonly missionId: string
  readonly runtime: MissionRuntimeId
  readonly model: string
  readonly resolvedRouteId: string
  readonly cliVersion: string | null
  /**
   * What the run was actually allowed to do. Carried here so the UI states the
   * real posture of THIS run rather than whatever mode the composer shows now.
   */
  readonly sandbox: 'read-only' | 'workspace-write'
}

/** A Codex start is always Codex on the account default; the narrowing is real. */
export interface CodexMissionStartData extends MissionRouteSummary {
  readonly runtime: 'codex'
  readonly model: 'account-default'
}

export type CodexMissionStartResponse =
  | { readonly ok: true; readonly data: CodexMissionStartData }
  | { readonly ok: false; readonly error: CodexMissionError }

export interface CodexMissionCancelRequest {
  readonly runId: string
}

export type CodexMissionCancelResponse =
  | {
      readonly ok: true
      readonly data: {
        readonly runId: string
        readonly state: 'cancellation-requested'
      }
    }
  | { readonly ok: false; readonly error: CodexMissionError }

export type CodexMissionUpdate =
  | {
      readonly kind: 'event'
      readonly runId: string
      readonly missionId: string
      readonly event: NormalizedRuntimeEvent
    }
  | {
      readonly kind: 'transport-error'
      readonly runId: string
      readonly missionId: string
      readonly error: {
        readonly code: 'RUNTIME_TRANSPORT_FAILED'
        readonly message: string
      }
    }
  | {
      readonly kind: 'persistence-error'
      readonly runId: string
      readonly missionId: string
      readonly error: {
        readonly code: 'MISSION_PERSISTENCE_FAILED'
        readonly message: string
      }
    }

/**
 * A checkpoint as the renderer may see it. Deliberately narrower than the
 * ledger's record: the receipt card needs to say how many checkpoints exist,
 * which was last, and what was left unsettled -- it does not need the
 * transcript digest or the assistant summary, and neither belongs on an IPC
 * surface that exists to render a status card.
 */
export interface PublicMissionCheckpoint {
  readonly epoch: number
  readonly reason: string
  readonly resumeSafety: 'safe' | 'approval-required' | 'unsafe'
  readonly safetyReason: string
  readonly createdAt: string
  readonly unsettledActions: readonly { readonly itemId: string; readonly name: string }[]
}

export interface PublicRecoveredMission {
  readonly missionId: string
  readonly runId: string
  readonly prompt: string
  // History spans every runtime a mission could have run under, so this is the
  // union even while Codex is the only one that can be started today. Pinning
  // it to a literal would make recovered Claude missions a type error rather
  // than a missing feature.
  readonly runtime: MissionRuntimeId
  readonly model: string
  readonly requestedRouteId: string
  readonly resolvedRouteId: string
  readonly cliVersion: string | null
  readonly createdAt: string
  readonly lastUpdatedAt: string
  readonly phase: 'completed' | 'failed' | 'cancelled' | 'interrupted'
  readonly events: readonly NormalizedRuntimeEvent[]
  readonly eventCount: number
  readonly eventsTruncated: boolean
  readonly hostFailureMessage?: string
  readonly integrityIssueCount: number
  readonly sandbox: 'read-only' | 'workspace-write'
  readonly checkpoints: readonly PublicMissionCheckpoint[]
}

export type MissionHistoryResponse =
  | {
      readonly ok: true
      readonly data: {
        readonly missions: readonly PublicRecoveredMission[]
        readonly issueCount: number
      }
    }
  | {
      readonly ok: false
      readonly error: {
        readonly code: 'HISTORY_UNAVAILABLE'
        readonly message: string
      }
    }

export interface DesktopApi {
  readonly platform: string
  minimize(): void
  toggleMaximize(): void
  close(): void
  getLocalRuntimes(): Promise<RuntimeDiscoveryResponse>
  getMissionHistory(): Promise<MissionHistoryResponse>
  listTeammates(): Promise<TeammateListResponse>
  createTeammate(request: TeammateCreateRequest): Promise<TeammateMutationResponse>
  removeTeammate(teammateId: string): Promise<TeammateMutationResponse>
  assignMission(teammateId: string, missionId: string): Promise<TeammateMutationResponse>
  startCodexMission(request: CodexMissionStartRequest): Promise<CodexMissionStartResponse>
  cancelCodexMission(request: CodexMissionCancelRequest): Promise<CodexMissionCancelResponse>
  onCodexMissionUpdate(listener: (update: CodexMissionUpdate) => void): () => void
}
