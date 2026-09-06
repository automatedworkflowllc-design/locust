import type { MissionRuntimeId, NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

import type { AvatarSpec } from './avatar.js'

import type { RoutineSchedule } from './routine-schedule.js'
export type { RoutineSchedule } from './routine-schedule.js'
import type { MemoryScope } from './memory.js'
export type { MemoryScope } from './memory.js'

/**
 * How a teammate's memory is treated: kept at once and shown (the Claude
 * Code way), shown first and kept on a yes (the Cursor way), or not at all.
 */
export type MemoryMode = 'auto' | 'ask' | 'off'
export const DEFAULT_MEMORY_MODE: MemoryMode = 'auto'

/** One thing the team remembers, with who wrote it, where, and from what. */
export interface PublicMemory {
  readonly memoryId: string
  readonly text: string
  readonly scope: MemoryScope
  /** The folder it was written in (`ws_` id); a global memory still records where it came from. */
  readonly workspaceId: string
  readonly workspaceName: string
  readonly by: { readonly teammateId?: string; readonly name: string }
  readonly missionId?: string
  readonly createdAt: string
  /** `proposed` waits for the person; only `kept` is briefed. */
  readonly status: 'kept' | 'proposed'
  readonly enabled: boolean
}

export interface MemoryAddRequest {
  readonly text: string
  readonly scope: MemoryScope
}

export interface MemoryUpdateRequest {
  readonly memoryId: string
  readonly text?: string
  readonly enabled?: boolean
  /** Keep a proposed memory. */
  readonly keep?: boolean
}

export interface MemoryClearRequest {
  readonly scope: 'workspace' | 'all'
}

/**
 * What a runtime has configured for itself, read from its own files and
 * never changed: MCP server names and hook events with their counts.
 * `sources` are the files read; `unreadable` the ones that exist but could
 * not be read or parsed. Names only -- no commands, no arguments.
 */
export interface PublicRuntimeSetup {
  readonly mcpServers: readonly string[]
  readonly hooks: readonly string[]
  /** Skills and agents the runtime can reach for, by name; Claude Code today. */
  readonly skills: readonly string[]
  readonly agents: readonly string[]
  readonly sources: readonly string[]
  readonly unreadable: readonly string[]
}

/** The folder's LOCUST.md as the host last read it: how much, and whether the rest was cut. Null when there is none. */
export interface PublicWorkspaceBrief {
  readonly lines: number
  readonly truncated: boolean
}

/** A teammate's own worktree, as git reports it. */
export interface PublicWorktree {
  readonly teammateId: string
  readonly teammateName: string | undefined
  readonly branch: string
  readonly path: string
  /** A run is live in it, so it cannot be removed now. */
  readonly busy: boolean
}

export type WorktreeListResponse =
  | { readonly ok: true; readonly data: { readonly worktrees: readonly PublicWorktree[]; readonly reason: string | undefined } }
  | { readonly ok: false; readonly error: { readonly code: 'WORKTREES_UNAVAILABLE'; readonly message: string } }

export type RuntimeSetupResponse =
  | {
      readonly ok: true
      readonly data: { readonly runtimes: Readonly<Record<string, PublicRuntimeSetup>>; readonly workspaceBrief: PublicWorkspaceBrief | null }
    }
  | { readonly ok: false; readonly error: { readonly code: 'SETUP_UNAVAILABLE'; readonly message: string } }

export type MemoryListResponse =
  | {
      readonly ok: true
      readonly data: { readonly memories: readonly PublicMemory[]; readonly workspaceId: string; readonly workspaceName: string }
    }
  | { readonly ok: false; readonly error: { readonly code: 'MEMORY_REJECTED'; readonly message: string } }

export const RUNTIME_DISCOVERY_CHANNEL = 'runtime-discovery:get'
export const CODEX_MISSION_START_CHANNEL = 'codex-mission:start'
export const CODEX_MISSION_CANCEL_CHANNEL = 'codex-mission:cancel'
export const MISSION_HANDOFF_CHANNEL = 'mission:hand-off'
export const MISSION_RESUME_CHANNEL = 'mission:resume'
export const CODEX_MISSION_UPDATE_CHANNEL = 'codex-mission:update'
export const MISSION_HISTORY_CHANNEL = 'mission-history:list'
export const MISSION_DELETE_CHANNEL = 'mission:delete'
export const APP_INFO_CHANNEL = 'app:info'
export const MISSION_STORAGE_CHANNEL = 'mission:storage'
export const APP_UPDATE_CHECK_CHANNEL = 'app:update-check'
export const APP_UPDATE_INSTALL_CHANNEL = 'app:update-install'
export const APP_UPDATE_STATE_CHANNEL = 'app:update-state'

/**
 * Where an update stands. `unsupported` is a real answer: a development build
 * or one installed outside its installer cannot replace itself, and saying
 * "up to date" there would be a claim nothing checked.
 */
export type AppUpdatePhase =
  | 'idle'
  | 'checking'
  | 'current'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'failed'
  | 'unsupported'

export interface AppUpdateState {
  readonly phase: AppUpdatePhase
  readonly currentVersion: string
  readonly availableVersion?: string
  readonly percent?: number
  /** Set only when the phase is `failed`; never the provider's own text. */
  readonly message?: string
}

export type AppUpdateResponse =
  | { readonly ok: true; readonly data: AppUpdateState }
  | {
      readonly ok: false
      readonly error: { readonly code: 'UPDATE_NOT_READY' | 'UPDATE_BUSY' | 'INTERNAL_ERROR'; readonly message: string }
    }
export const MISSION_PRUNE_CHANNEL = 'mission:prune'

/** What the local mission history costs on this machine. */
export interface PublicStorageReport {
  readonly missionCount: number
  readonly byteTotal: number
  readonly oldestUpdatedAt?: string
}

export type StorageReportResponse =
  | { readonly ok: true; readonly data: PublicStorageReport }
  | { readonly ok: false; readonly error: { readonly code: 'STORAGE_UNAVAILABLE'; readonly message: string } }

export interface MissionPruneRequest {
  /** Missions untouched for longer than this are candidates. */
  readonly olderThanDays: number
  /** Ask what would happen. The preview and the deletion are one code path. */
  readonly dryRun: boolean
}

export interface MissionPruneData {
  readonly deleted: readonly string[]
  /** Old missions kept because a mission that survives continues from them. */
  readonly keptForContinuity: readonly string[]
  /** Old missions kept because they are running right now. */
  readonly keptAsRunning: readonly string[]
  /** Whether this was a preview. A preview deleted nothing. */
  readonly previewed: boolean
}

export type MissionPruneResponse =
  | { readonly ok: true; readonly data: MissionPruneData }
  | {
      readonly ok: false
      readonly error: { readonly code: 'PRUNE_REFUSED' | 'INTERNAL_ERROR'; readonly message: string }
    }

/** What this build is, so a person can say which one they are running. */
export interface AppInfo {
  readonly name: string
  readonly version: string
  readonly packaged: boolean
  /**
   * The platform this build is running on. Some containment is platform
   * specific -- Cursor's sandbox exists on macOS and Linux only -- and the
   * window has to know, or it offers modes the host will refuse.
   */
  readonly platform: string
  /**
   * The folder every mission runs in, by its last segment; empty when none
   * is chosen. The folder is the one the app was launched from, or the one
   * chosen last time when it was launched from its own install folder --
   * never the install folder itself.
   */
  readonly workspaceName: string
  readonly workspacePath: string
  /**
   * Locust made the folder itself (Documents\Locust) because nothing was
   * chosen and the app was launched from its install folder. The window
   * says so where the folder is named, so a person knows where their
   * teammates' files went and that any other folder is one click away.
   */
  readonly workspaceMade: boolean
}

/**
 * The answer to "choose a folder". A chosen folder makes the app reopen
 * itself there: every service binds the folder when it starts and the
 * mission list is scoped by it, so a running window cannot simply switch.
 */
export type WorkspaceChooseResponse =
  | { readonly ok: true; readonly data: { readonly path: string; readonly reopening: true } }
  | {
      readonly ok: false
      readonly error: {
        readonly code: 'CANCELLED' | 'INSTALL_FOLDER' | 'RUNS_ACTIVE' | 'INTERNAL_ERROR'
        readonly message: string
      }
    }
export const TEAMMATE_LIST_CHANNEL = 'teammates:list'
export const TEAMMATE_CREATE_CHANNEL = 'teammates:create'
export const TEAMMATE_REMOVE_CHANNEL = 'teammates:remove'
export const TEAMMATE_UPDATE_CHANNEL = 'teammates:update'
export const TEAMMATE_ASSIGN_CHANNEL = 'teammates:assign'
export const ROUTINE_LIST_CHANNEL = 'routines:list'
export const ROUTINE_CREATE_CHANNEL = 'routines:create'
export const ROUTINE_UPDATE_CHANNEL = 'routines:update'
export const ROUTINE_REMOVE_CHANNEL = 'routines:remove'
export const ROUTINE_RUN_CHANNEL = 'routines:run'
export const MODEL_CATALOG_CHANNEL = 'models:list'

/**
 * Installing a runtime the person asked for, from inside the app.
 *
 * Colin, 2026-09-06: "why would you not want to give the user the ability to
 * click something to get what they would need to make it work". The app shows
 * the exact command before it runs it, runs one at a time, and streams npm's
 * own output back so a slow install does not look like a frozen one.
 */
export const RUNTIME_INSTALL_CHANNEL = 'runtime:install'
/** npm's output, line by line, while an install runs. */
export const RUNTIME_INSTALL_PROGRESS_CHANNEL = 'runtime:install-progress'

export interface RuntimeInstallProgress {
  readonly runtime: string
  readonly line: string
}

export type RuntimeInstallResponse =
  | { readonly ok: true }
  | {
      readonly ok: false
      /** One sentence: what happened. */
      readonly what: string
      /** One sentence: what to do about it. */
      readonly next: string
      /** Whether restarting Locust is the action, rather than running it again. */
      readonly restart?: boolean
    }
export const WORKSPACE_SETTINGS_READ_CHANNEL = 'workspace-settings:read'
export const WORKSPACE_SETTINGS_WRITE_CHANNEL = 'workspace-settings:write'
export const WORKSPACE_CHOOSE_CHANNEL = 'workspace:choose'
export const ROOM_LIST_CHANNEL = 'rooms:list'
export const ROOM_CREATE_CHANNEL = 'rooms:create'
export const ROOM_REMOVE_CHANNEL = 'rooms:remove'
export const ROOM_POST_CHANNEL = 'rooms:post'
export const ROOM_TASK_CHANNEL = 'rooms:task'
export const MEMORY_LIST_CHANNEL = 'memory:list'
export const MEMORY_ADD_CHANNEL = 'memory:add'
export const MEMORY_UPDATE_CHANNEL = 'memory:update'
export const MEMORY_REMOVE_CHANNEL = 'memory:remove'
export const MEMORY_CLEAR_CHANNEL = 'memory:clear'
export const RUNTIME_SETUP_CHANNEL = 'runtime:setup'
export const WORKTREE_LIST_CHANNEL = 'worktrees:list'
export const WORKTREE_REMOVE_CHANNEL = 'worktrees:remove'
export const MISSION_APPROVAL_CHANNEL = 'mission-approval:request'
export const MISSION_APPROVAL_DECIDE_CHANNEL = 'mission-approval:decide'

export type LocalRuntimeId = 'codex' | 'claude' | 'cursor' | 'gemini' | 'opencode' | 'copilot' | 'antigravity' | 'omniroute'

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
   * What a Custom teammate actually does, in the person's own words: the
   * title shown beside their name and the role their runtime is told. The
   * built-in roles carry their own name and need none; a Custom teammate
   * with no title is shown as, and briefed as, "Custom".
   */
  readonly roleTitle?: string
  /**
   * Works on its own branch: missions run in this teammate's own worktree of
   * the folder's repository (`.locust/worktrees/<id>`, branch `locust/<name>`),
   * so two teammates editing one repository do not collide. Off by default.
   */
  readonly worktree?: boolean
  /**
   * The face, persisted with the record. Seeded from the immutable id when a
   * teammate is created without one, so a rename never changes it.
   */
  readonly avatar: AvatarSpec
  readonly createdAt: string
  /**
   * The route this teammate last ran on, recorded by the host from the
   * missions a person started for them. A teammate replying on their own
   * runs HERE -- their own runtime, model and mode -- never on whoever
   * wrote to them. People will pit one model against another on purpose,
   * and that only means anything if each side stays itself.
   */
  readonly route?: TeammateRoute
}

export interface TeammateRoute {
  readonly runtime: MissionRuntimeId
  /** A model id from the catalog, or `account-default`. */
  readonly model: string
  readonly mode: MissionMode
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
  readonly roleTitle?: string
  readonly worktree?: boolean
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
  readonly roleTitle?: string
  readonly worktree?: boolean
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

/**
 * A routine: a conversation a person saved as steps a teammate can replay.
 * The teammate cannot watch a person work outside the app; what it can learn
 * from is work it did WITH them, which every mission already records. So a
 * routine is the words typed on each turn of one conversation, in order,
 * editable, tied to the teammate and the route it was learned on.
 */
export interface PublicRoutine {
  readonly routineId: string
  readonly name: string
  readonly teammateId: string
  /** The route the routine was learned on and replays on: a read-only routine stays read-only. */
  readonly route: TeammateRoute
  /** What the person typed on each turn, in order. Corrections are edits here. */
  readonly steps: readonly string[]
  /** The missions the steps were taken from, oldest first. A routine can always show where it came from. */
  readonly learnedFrom: readonly string[]
  readonly createdAt: string
  readonly runs: number
  readonly lastRunAt?: string
  /**
   * When it runs on its own: every N hours from the last run, or daily at
   * a wall-clock time -- local, and only while the app is open. Absent
   * means what every routine was before: it runs when a person presses Run.
   */
  readonly schedule?: RoutineSchedule
}

export interface RoutineCreateRequest {
  readonly name: string
  readonly teammateId: string
  readonly route: TeammateRoute
  readonly steps: readonly string[]
  readonly learnedFrom: readonly string[]
  readonly schedule?: RoutineSchedule
}

export interface RoutineUpdateRequest {
  readonly routineId: string
  readonly name: string
  readonly steps: readonly string[]
  /** `null` clears a schedule; absent leaves it as it was. */
  readonly schedule?: RoutineSchedule | null
}

export type RoutineListResponse =
  | { readonly ok: true; readonly data: { readonly routines: readonly PublicRoutine[] } }
  | { readonly ok: false; readonly error: { readonly code: 'ROUTINES_UNAVAILABLE'; readonly message: string } }

export type RoutineMutationResponse =
  | { readonly ok: true; readonly data: { readonly routine?: PublicRoutine } }
  | { readonly ok: false; readonly error: { readonly code: 'ROUTINE_REJECTED'; readonly message: string } }

/**
 * A room: a named set of teammates a person can write to at once, and the
 * posts they made. A post starts one ordinary mission per teammate, on that
 * teammate's own route; the room remembers which, and the thread a person
 * watches is read from those missions' records.
 */
export interface RoomPost {
  readonly postId: string
  readonly text: string
  readonly at: string
  /** The mission each teammate answered in, by teammate id. A teammate whose run could not start is absent. */
  readonly missions: Readonly<Record<string, string>>
}

/**
 * A task on a room's board: a line of text, an owner, a state, and the
 * mission that last touched it (vision #2, "ownership"). Teammates move it
 * with a task block at the end of a reply; a person moves it from the room.
 */
export interface RoomTask {
  readonly taskId: string
  readonly text: string
  readonly ownerId: string | undefined
  readonly state: 'open' | 'in-hand' | 'done'
  /** The mission whose reply last moved this task, when a teammate did. */
  readonly missionId: string | undefined
  readonly at: string
}

export interface PublicRoom {
  readonly roomId: string
  readonly name: string
  readonly teammateIds: readonly string[]
  readonly createdAt: string
  readonly posts: readonly RoomPost[]
  readonly tasks: readonly RoomTask[]
}

/** A person moving the board: add a task, hand it to someone, finish it, or open it again. */
export interface RoomTaskRequest {
  readonly roomId: string
  readonly op: 'add' | 'assign' | 'done' | 'reopen' | 'remove'
  readonly taskId?: string
  readonly text?: string
  /** For `assign`: a teammate in the room, or undefined to leave it with nobody. */
  readonly ownerId?: string
}

export type RoomTaskResponse =
  | { readonly ok: true; readonly data: { readonly room: PublicRoom } }
  | { readonly ok: false; readonly error: { readonly code: 'ROOM_REJECTED'; readonly message: string } }

export interface RoomCreateRequest {
  readonly name: string
  readonly teammateIds: readonly string[]
}

export interface RoomPostRequest {
  readonly roomId: string
  readonly text: string
}

export type RoomListResponse =
  | { readonly ok: true; readonly data: { readonly rooms: readonly PublicRoom[] } }
  | { readonly ok: false; readonly error: { readonly code: 'ROOMS_UNAVAILABLE'; readonly message: string } }

export type RoomMutationResponse =
  | { readonly ok: true; readonly data: { readonly room?: PublicRoom } }
  | { readonly ok: false; readonly error: { readonly code: 'ROOM_REJECTED'; readonly message: string } }

/** A post, with what it started and who it could not start, in the host's words. */
export type RoomPostResponse =
  | {
      readonly ok: true
      readonly data: {
        readonly post: RoomPost
        readonly refused: readonly { readonly teammateId: string; readonly name: string; readonly message: string }[]
      }
    }
  | { readonly ok: false; readonly error: { readonly code: 'ROOM_REJECTED'; readonly message: string } }

export type RoutineRunResponse =
  | { readonly ok: true; readonly data: { readonly missionId: string; readonly runId: string } }
  | { readonly ok: false; readonly error: { readonly code: 'ROUTINE_REJECTED'; readonly message: string } }
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
  /**
   * No folder is chosen for the teammates to work in. The installed app is
   * launched from its own install folder, which is never a workspace, so a
   * start there is refused until a folder is picked -- it must not quietly
   * edit the app's own files.
   */
  | 'NO_WORKSPACE'

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
/**
 * What a mission may do. `plan` is the fourth because planning IS a
 * permission stance, not a switch beside one: it can only ever be chosen
 * where the sandbox already refuses writes, so a separate toggle asked the
 * same question twice in two shapes and could disagree with the answer next
 * to it (design pass, 2026-09-05).
 *
 * `auto` is the fifth, and the only one that has to be switched on before it
 * can be chosen (Colin, 2026-09-06: "there needs to be an auto option ... to
 * allow them to work out of the workspace folder if desired by the user").
 * It runs without asking and is not confined to the workspace folder, which
 * is the one bargain in this list the app cannot take back on the person's
 * behalf -- so the host refuses it unless `WorkspaceSettings.autoMode` is on,
 * whatever the renderer sends.
 */
export type MissionMode = 'ask' | 'accept-edits' | 'approve-each' | 'plan' | 'auto'

/**
 * A model the active runtime actually reports, with the reasoning efforts IT
 * supports. Effort is per model -- offering one a model cannot honour would be
 * a silent no-op, which the design explicitly forbids.
 */
export interface PublicModel {
  readonly id: string
  /**
   * The concrete model id for each effort, when a runtime encodes effort in
   * the id rather than taking a flag. Cursor lists `cursor-grok-4.6-high` and
   * `cursor-grok-4.6-low` as separate models; they are one model here, and
   * this says which id each effort means.
   */
  readonly variants?: Readonly<Record<string, string>>
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
  /**
   * Teammates reply to each other on their own: a share to a teammate starts
   * a run for them, and their answer starts the sender's next turn. On by
   * default -- talking to each other is the point of having more than one --
   * and it ends when a reply has nothing more to say; a hop cap is the
   * backstop that bounds the spend.
   */
  readonly relay: boolean
  /**
   * How many automatic replies one exchange may use before it stops and
   * waits for a person -- the autonomy budget. Six was a constant; the
   * 0.21.2 QA pass (rec. 6) asked for it to be the person's own number.
   * Bounded 1..12 by the host; anything else reads as the default.
   */
  readonly relayHopCap: number
  /** What happens to a memory a teammate writes. Absent or malformed reads as the default. */
  readonly memoryMode: MemoryMode
  /**
   * Whether the Auto mode may be chosen at all. Off until a person turns it
   * on, and the host checks it again when a run starts -- a mode that lets a
   * runtime change files anywhere on the machine is not something a stale
   * window or a saved routine gets to decide.
   */
  readonly autoMode: boolean
}

export const DEFAULT_RELAY_HOP_CAP = 6
export const MIN_RELAY_HOP_CAP = 1
export const MAX_RELAY_HOP_CAP = 12

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
  /**
   * For a file change: the unified diff Codex attached to the item the
   * approval is about, bounded like a ledger patch. Absent when the runtime
   * sent none -- the card then says what it was told and no more.
   */
  readonly patch?: ApprovalPatch
}

export interface ApprovalPatch {
  readonly text: string
  readonly added: number
  readonly removed: number
  readonly truncated: boolean
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
  /**
   * The mission this one replies to. The host looks up that mission's own
   * session handle and resumes it, so a second message is the next turn of a
   * conversation rather than a stranger arriving mid-thought. A mission that
   * cannot be resumed is refused rather than silently started blank.
   */
  readonly followUpOf?: string
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
  readonly sandbox: 'read-only' | 'workspace-write' | 'full-access'
}

/**
 * A mission start receipt. `runtime` is the union rather than a literal now
 * that Claude can own a run: narrowing it here would make a real Claude start
 * a type error instead of a supported route.
 */
export interface CodexMissionStartData extends MissionRouteSummary {
  /** Set when this run continued an earlier mission's conversation. */
  /**
   * The turn this one continues. `runtimeThreadId` is absent when that turn
   * left no session to resume -- the conversation still continues, the model
   * just does not carry it.
   */
  readonly followsUp?: { readonly missionId: string; readonly runtimeThreadId?: string }
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

/**
 * Picking a stopped mission back up. Named by MISSION rather than by run,
 * because the run it continues is over -- that is the whole case.
 */
export interface MissionResumeRequest {
  readonly missionId: string
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
   * The host started a run this renderer did not ask for: a teammate
   * replying on their own. Carries everything a start response would, so
   * the renderer adopts it exactly as it adopts its own.
   */
  | {
      readonly kind: 'mission-started'
      readonly runId: string
      readonly missionId: string
      readonly teammateId: string
      readonly prompt: string
      readonly data: CodexMissionStartData
      /**
       * Who started it: a relay hop of an exchange, one step of a routine
       * being replayed, or a person's post to a room. The room kind lives
       * only in this live update and the window -- the ledger records a
       * room post's missions as ordinary missions of their teammates.
       */
      readonly startedBy:
        | { readonly kind: 'relay'; readonly hop: number }
        | { readonly kind: 'routine'; readonly routineId: string; readonly step: number }
        | { readonly kind: 'room'; readonly roomId: string; readonly postId: string }
    }
  /**
   * A room's board moved because a teammate's reply moved it. The window
   * re-reads the room; `message` is the host's one-line account, for the
   * room screen and, later, a toast.
   */
  | {
      readonly kind: 'room-changed'
      readonly roomId: string
      readonly roomName: string
      readonly message: string
    }
  /** A teammate's reply changed the team's memory; the Memory screen and sidebar re-read it. */
  | {
      readonly kind: 'memory-changed'
      readonly by: string
      readonly kept: readonly string[]
      readonly proposed: readonly string[]
      readonly forgotten: readonly string[]
    }
  /** Why a teammate did NOT reply on their own, said in the thread that shared. */
  | {
      readonly kind: 'relay-notice'
      readonly runId: string
      readonly missionId: string
      readonly message: string
    }
  | {
      /**
       * A scheduled routine that would not start. It has no run and no
       * mission -- nothing was created -- so it cannot travel as a run's
       * notice, which is why it went unsaid: the runner held it off for an
       * hour and tried again, silently, for as long as the refusal lasted
       * (QA, 2026-09-06; `index.ts` already had a comment admitting it).
       */
      readonly kind: 'routine-blocked'
      readonly routineId: string
      readonly name: string
      readonly message: string
      /** When it will be tried again, so the notice can say so. */
      readonly retryAt: string
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
  /** The folder the mission ran in, as a stable id derived from its path. */
  readonly workspaceId: string
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
  readonly sandbox: 'read-only' | 'workspace-write' | 'full-access'
  /** What was asked for. Absent on missions recorded before schema 15. */
  readonly mode?: MissionMode
  readonly checkpoints: readonly PublicMissionCheckpoint[]
  /** Workroom messages this mission received or posted, in ledger order. */
  readonly peerMessages: readonly PublicPeerMessage[]
  /**
   * Set when this mission continued another after a route switch. The
   * renderer uses it to draw the pair as one thread under a divider -- and to
   * show the ROOT mission's prompt, because this mission's own recorded prompt
   * is the machine-written briefing.
   */
  readonly continuesFrom?: {
    readonly missionId: string
    readonly checkpointEpoch: number
    /** `route-switch` is a handoff; `follow-up` is the next turn of one conversation. */
    readonly reason: 'route-switch' | 'follow-up'
  }
  /**
   * Set when the HOST started this run rather than a person -- today, one
   * teammate answering another. Its `prompt` is then instructions the host
   * wrote to a runtime, not a sentence anybody would recognise as their own,
   * which is why the renderer must never title a mission with it.
   */
  readonly startedBy?:
    | {
        readonly kind: 'relay'
        /** Which automatic turn of the exchange this is, counting from 1. */
        readonly hop: number
      }
    | {
        /** Picking a mission back up from a checkpoint after an interruption. */
        readonly kind: 'resume'
        readonly epoch: number
      }
    | {
        /** One step of a routine a person saved, replayed by the host. */
        readonly kind: 'routine'
        readonly routineId: string
        readonly step: number
      }
}

export type MissionHistoryResponse =
  | {
      readonly ok: true
      readonly data: {
        readonly missions: readonly PublicRecoveredMission[]
        /** The folder this window is working in; missions elsewhere are not its own. */
        readonly currentWorkspaceId: string
        readonly issueCount: number
        /**
         * Runtimes whose most recent word, across every mission in the
         * ledger, was that the account is out of quota -- with that word.
         * Derived here rather than remembered by the window, because the
         * window forgets on reload and the ledger does not: the 0.21.2 QA
         * pass reloaded past a Codex limit and watched AT LIMIT turn back
         * into READY with no successful run in between.
         */
        readonly limitedRuntimes: Readonly<Record<string, string>>
        /** The latest still-allowed rate-limit reading per runtime ("5-hour window 35% used · resets …"). */
        readonly usageWindows: Readonly<Record<string, string>>
      }
    }
  | {
      readonly ok: false
      readonly error: {
        readonly code: 'HISTORY_UNAVAILABLE'
        readonly message: string
      }
    }

export type MissionDeleteResponse =
  | { readonly ok: true }
  | {
      readonly ok: false
      readonly error: {
        /** `LIVE` is the only refusal with a remedy: stop the run, then delete. */
        readonly code: 'LIVE' | 'NOT_FOUND' | 'INTERNAL_ERROR'
        readonly message: string
      }
    }

export interface DesktopApi {
  readonly platform: string
  minimize(): void
  toggleMaximize(): void
  close(): void
  getAppInfo(): Promise<AppInfo>
  readStorageReport(): Promise<StorageReportResponse>
  checkForUpdate(): Promise<AppUpdateResponse>
  installUpdate(): Promise<AppUpdateResponse>
  onUpdateState(listener: (state: AppUpdateState) => void): () => void
  pruneMissions(request: MissionPruneRequest): Promise<MissionPruneResponse>
  getLocalRuntimes(): Promise<RuntimeDiscoveryResponse>
  getMissionHistory(): Promise<MissionHistoryResponse>
  /** Remove a finished mission's record for good. Refused while it is live. */
  deleteMission(missionId: string): Promise<MissionDeleteResponse>
  listTeammates(): Promise<TeammateListResponse>
  createTeammate(request: TeammateCreateRequest): Promise<TeammateMutationResponse>
  updateTeammate(request: TeammateUpdateRequest): Promise<TeammateMutationResponse>
  removeTeammate(teammateId: string): Promise<TeammateMutationResponse>
  assignMission(teammateId: string, missionId: string): Promise<TeammateMutationResponse>
  listRoutines(): Promise<RoutineListResponse>
  createRoutine(request: RoutineCreateRequest): Promise<RoutineMutationResponse>
  updateRoutine(request: RoutineUpdateRequest): Promise<RoutineMutationResponse>
  removeRoutine(routineId: string): Promise<RoutineMutationResponse>
  /** Replay a routine: its first step starts now, each later step when the one before completes. */
  runRoutine(routineId: string): Promise<RoutineRunResponse>
  /** Answer a pending approval. Unknown or already-answered ids are ignored. */
  listModels(): Promise<ModelCatalogResponse>
  /** Run the install the screen showed, for a runtime that comes from npm. */
  installRuntime(runtime: string): Promise<RuntimeInstallResponse>
  /** npm output while an install runs. Returns the unsubscribe. */
  onRuntimeInstallProgress(listener: (progress: RuntimeInstallProgress) => void): () => void
  readWorkspaceSettings(): Promise<WorkspaceSettings>
  /** Pick the folder the teammates work in. Reopens the app there on success. */
  chooseWorkspace(): Promise<WorkspaceChooseResponse>
  listRooms(): Promise<RoomListResponse>
  createRoom(request: RoomCreateRequest): Promise<RoomMutationResponse>
  removeRoom(roomId: string): Promise<RoomMutationResponse>
  postToRoom(request: RoomPostRequest): Promise<RoomPostResponse>
  updateRoomTask(request: RoomTaskRequest): Promise<RoomTaskResponse>
  listMemories(): Promise<MemoryListResponse>
  /** Each runtime's own MCP servers and hooks, read-only. */
  readRuntimeSetup(): Promise<RuntimeSetupResponse>
  /** The teammates' own worktrees under the folder, and whether the folder can have them. */
  listWorktrees(): Promise<WorktreeListResponse>
  /** Remove a teammate's worktree. The branch stays. Refused while a run is live in it. */
  removeWorktree(teammateId: string): Promise<WorktreeListResponse>
  addMemory(request: MemoryAddRequest): Promise<MemoryListResponse>
  updateMemory(request: MemoryUpdateRequest): Promise<MemoryListResponse>
  removeMemory(memoryId: string): Promise<MemoryListResponse>
  clearMemories(request: MemoryClearRequest): Promise<MemoryListResponse>
  writeWorkspaceSettings(settings: WorkspaceSettings): Promise<WorkspaceSettings>
  decideMissionApproval(answer: MissionApprovalAnswer): Promise<{ readonly ok: boolean }>
  onMissionApproval(listener: (request: MissionApprovalRequest) => void): () => void
  startCodexMission(request: CodexMissionStartRequest): Promise<CodexMissionStartResponse>
  cancelCodexMission(request: CodexMissionCancelRequest): Promise<CodexMissionCancelResponse>
  handOffMission(request: MissionHandoffRequest): Promise<MissionHandoffResponse>
  resumeMission(request: MissionResumeRequest): Promise<MissionHandoffResponse>
  onCodexMissionUpdate(listener: (update: CodexMissionUpdate) => void): () => void
}

/** The words for what a teammate does: their own for a Custom role, the role's name otherwise. */
export function roleLabelOf(teammate: Pick<PublicTeammate, 'role' | 'roleTitle'>): string {
  const title = teammate.roleTitle?.trim() ?? ''
  return teammate.role === 'Custom' && title.length > 0 ? title : teammate.role
}
