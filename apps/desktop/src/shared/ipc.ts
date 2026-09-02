import type { MissionRuntimeId, NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

import type { AvatarSpec } from './avatar.js'

export const RUNTIME_DISCOVERY_CHANNEL = 'runtime-discovery:get'
export const CODEX_MISSION_START_CHANNEL = 'codex-mission:start'
export const CODEX_MISSION_CANCEL_CHANNEL = 'codex-mission:cancel'
export const MISSION_HANDOFF_CHANNEL = 'mission:hand-off'
export const CODEX_MISSION_UPDATE_CHANNEL = 'codex-mission:update'
export const MISSION_HISTORY_CHANNEL = 'mission-history:list'
export const TEAMMATE_LIST_CHANNEL = 'teammates:list'
export const TEAMMATE_CREATE_CHANNEL = 'teammates:create'
export const TEAMMATE_REMOVE_CHANNEL = 'teammates:remove'
export const TEAMMATE_UPDATE_CHANNEL = 'teammates:update'
export const TEAMMATE_ASSIGN_CHANNEL = 'teammates:assign'
export const MODEL_CATALOG_CHANNEL = 'models:list'
export const WORKSPACE_SETTINGS_READ_CHANNEL = 'workspace-settings:read'
export const WORKSPACE_SETTINGS_WRITE_CHANNEL = 'workspace-settings:write'
export const MISSION_APPROVAL_CHANNEL = 'mission-approval:request'
export const MISSION_APPROVAL_DECIDE_CHANNEL = 'mission-approval:decide'

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
  /**
   * The face, persisted with the record. Seeded from the immutable id when a
   * teammate is created without one, so a rename never changes it.
   */
  readonly avatar: AvatarSpec
  readonly createdAt: string
}

/**
 * A workroom message as the renderer sees it: who said it to whom, and the
 * text. `direction` is relative to the mission being shown -- `received` was
 * quoted into that mission's prompt, `posted` came out of its work. `text` is
 * null when the ledger still points at a message the workroom no longer holds,
 * which is said rather than hidden.
 */
export interface PublicPeerMessage {
  readonly messageId: string
  readonly direction: 'received' | 'posted'
  readonly from: { readonly teammateId: string; readonly name: string }
  readonly to: { readonly teammateId: string; readonly name: string }
  readonly text: string | null
  readonly at: string
}

export interface TeammateCreateRequest {
  readonly name: string
  readonly hue: TeammateHue
  readonly role: TeammateRole
  /** The look chosen in the dialog; omitted, the store seeds one from the new id. */
  readonly avatar?: AvatarSpec
}

/**
 * Everything about a teammate a person may change. The id is what they are
 * and stays; missions filed under them stay filed.
 */
export interface TeammateUpdateRequest {
  readonly teammateId: string
  readonly name: string
  readonly hue: TeammateHue
  readonly role: TeammateRole
  readonly avatar: AvatarSpec
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
  /**
   * The run was stopped for a handoff, and the handoff could not proceed. The
   * stop is NOT undone -- nothing here can restart a killed process -- so this
   * error always describes a mission that is now stopped, and the message says
   * so rather than implying the user can simply try again.
   */
  | 'HANDOFF_REFUSED'

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
/**
 * `ask` is read-only. `accept-edits` may write inside the workspace with no
 * per-action prompt. `approve-each` runs on the app-server transport, where the
 * runtime can stop and ask before every consequential action.
 *
 * These are three different bargains, not three intensities, so the composer
 * states the consequence of each rather than only its name.
 */
export type MissionMode = 'ask' | 'accept-edits' | 'approve-each'

/**
 * A model the active runtime actually reports, with the reasoning efforts IT
 * supports. Effort is per model -- offering one a model cannot honour would be
 * a silent no-op, which the design explicitly forbids.
 */
export interface PublicModel {
  readonly id: string
  /** The runtime this model belongs to; a model is never offered under another. */
  readonly runtime: MissionRuntimeId
  readonly displayName: string
  readonly description: string
  readonly supportedEfforts: readonly string[]
}

export type ModelCatalogResponse =
  | { readonly ok: true; readonly data: { readonly models: readonly PublicModel[] } }
  | { readonly ok: false; readonly error: { readonly code: 'MODELS_UNAVAILABLE'; readonly message: string } }

/**
 * Workspace-wide settings. `swarm` runs every mission at its model's MAXIMUM
 * supported effort -- which is only meaningful because the catalog reports
 * effort per model, so "maximum" is a real value rather than a guess.
 */
export interface WorkspaceSettings {
  readonly swarm: boolean
}

/** What the runtime is asking permission to do. */
export type MissionApprovalKind = 'command' | 'file-change' | 'question'

export interface MissionApprovalRequest {
  readonly approvalId: string
  readonly runId: string
  readonly missionId: string
  readonly kind: MissionApprovalKind
  /** One line naming the action, safe to show. */
  readonly summary: string
  /** The exact command or change, already bounded. Empty when there is none. */
  readonly detail: string
  /** Where it would happen. */
  readonly cwd: string | null
  readonly requestedAt: string
}

/**
 * `approve-once` allows this action only. `approve-always` allows matching
 * actions for the rest of the session. `deny` refuses it. There is deliberately
 * no "always, forever" -- a durable grant is a Settings decision, not something
 * to hand over mid-run under time pressure.
 */
export type MissionApprovalDecision = 'approve-once' | 'approve-always' | 'deny'

export interface MissionApprovalAnswer {
  readonly approvalId: string
  readonly decision: MissionApprovalDecision
}

export interface CodexMissionStartRequest {
  readonly prompt: string
  readonly mode?: MissionMode
  readonly runtime?: MissionRuntimeId
  /** A model id from the catalog, or omitted for the account default. */
  readonly model?: string
  /** Only meaningful when the chosen model reports supporting it. */
  readonly effort?: string
  /**
   * The teammate this mission is messaged to. Decides who the mission belongs
   * to, whose waiting workroom messages it is shown, and under whose name its
   * findings are shared. Absent for a mission that belongs to nobody.
   */
  readonly teammateId?: string
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

/**
 * A mission start receipt. `runtime` is the union rather than a literal now
 * that Claude can own a run: narrowing it here would make a real Claude start
 * a type error instead of a supported route.
 */
export interface CodexMissionStartData extends MissionRouteSummary {
  /** Workroom messages quoted into this mission's prompt, oldest first. */
  readonly peerMessages: readonly PublicPeerMessage[]
  /**
   * True when the workroom could not be read at start. The mission still ran,
   * with no teammate messages; whatever was waiting is still waiting.
   */
  readonly peerDeliveryFailed: boolean
}

export type CodexMissionStartResponse =
  | { readonly ok: true; readonly data: CodexMissionStartData }
  | { readonly ok: false; readonly error: CodexMissionError }

export interface CodexMissionCancelRequest {
  readonly runId: string
}

/**
 * Move work from one runtime to another mid-mission.
 *
 * This is deliberately NOT modelled as "the same mission changes runtime". A
 * mission records ONE runtime and every event must agree with it, so a switch
 * produces a NEW mission that continues from a checkpoint of the old one --
 * which is also what actually happened: two runs, with a reconciliation
 * between them.
 */
export interface MissionHandoffRequest {
  readonly runId: string
  readonly runtime: MissionRuntimeId
  readonly mode: MissionMode
  readonly model?: string
  readonly effort?: string
}

export interface MissionHandoffData extends CodexMissionStartData {
  /** The mission this one continues, and the checkpoint it resumed from. */
  readonly continuesFrom: {
    readonly missionId: string
    readonly checkpointEpoch: number
  }
  /**
   * How much the briefing could promise the new runtime. `safe` means nothing
   * was in flight when the old run stopped; `approval-required` means some
   * actions started and never reported back, and the new run has been told to
   * verify them before building on them.
   */
  readonly resumeSafety: 'safe' | 'approval-required'
  /** Sections of the briefing dropped to fit the prompt bound, if any. */
  readonly omittedBriefing: readonly string[]
  /**
   * How many actions had started and not reported back when the old run
   * stopped. The divider states this rather than a reassuring summary: it is
   * the number the person needs to decide whether to trust what follows.
   */
  readonly unsettledCount: number
}

export type MissionHandoffResponse =
  | { readonly ok: true; readonly data: MissionHandoffData }
  | { readonly ok: false; readonly error: CodexMissionError }

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
  /** The mission's work posted a message to another teammate. */
  | {
      readonly kind: 'peer-message'
      readonly runId: string
      readonly missionId: string
      readonly message: PublicPeerMessage
    }
  /** The mission asked to share something and the host could not honour it. */
  | {
      readonly kind: 'peer-share-failed'
      readonly runId: string
      readonly missionId: string
      readonly message: string
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
  /** Workroom messages this mission received or posted, in ledger order. */
  readonly peerMessages: readonly PublicPeerMessage[]
  /**
   * Set when this mission continued another after a route switch. The
   * renderer uses it to draw the pair as one thread under a divider -- and to
   * show the ROOT mission's prompt, because this mission's own recorded prompt
   * is the machine-written briefing.
   */
  readonly continuesFrom?: { readonly missionId: string; readonly checkpointEpoch: number }
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
  updateTeammate(request: TeammateUpdateRequest): Promise<TeammateMutationResponse>
  removeTeammate(teammateId: string): Promise<TeammateMutationResponse>
  assignMission(teammateId: string, missionId: string): Promise<TeammateMutationResponse>
  /** Answer a pending approval. Unknown or already-answered ids are ignored. */
  listModels(): Promise<ModelCatalogResponse>
  readWorkspaceSettings(): Promise<WorkspaceSettings>
  writeWorkspaceSettings(settings: WorkspaceSettings): Promise<WorkspaceSettings>
  decideMissionApproval(answer: MissionApprovalAnswer): Promise<{ readonly ok: boolean }>
  onMissionApproval(listener: (request: MissionApprovalRequest) => void): () => void
  startCodexMission(request: CodexMissionStartRequest): Promise<CodexMissionStartResponse>
  cancelCodexMission(request: CodexMissionCancelRequest): Promise<CodexMissionCancelResponse>
  handOffMission(request: MissionHandoffRequest): Promise<MissionHandoffResponse>
  onCodexMissionUpdate(listener: (update: CodexMissionUpdate) => void): () => void
}
