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
  /**
   * The slug this memory is filed under, when it has one.
   *
   * A named memory is REPLACEABLE: remembering the same name in the same
   * place rewrites this one instead of adding a near-copy beside it. Absent
   * on every memory written before 0.242 and on every unnamed one since,
   * which keeps matching by text exactly as it was.
   */
  readonly name?: string
  /** When a named memory was last rewritten. Absent if it never has been. */
  readonly updatedAt?: string
  /**
   * Who wrote its CURRENT wording, when it has been rewritten (A1.6). `by`
   * is who first kept it. A rewrite used to leave only `by`, so Booty's
   * "Deploys go out on Thursdays" was credited to the person who had
   * written "Fridays" -- on the Memory screen, on the card, in every brief.
   */
  readonly updatedBy?: { readonly teammateId?: string; readonly name: string }
  /**
   * On a PROPOSAL only: the kept memory this one would REPLACE, or REMOVE,
   * once the person keeps it. "Ask me first" covers rewrites and forgets
   * (0.315); the kept memory stays as it is, and briefed, until then.
   */
  readonly replaces?: string
  readonly forgets?: string
  /** When a teammate was last given it in a brief (A1.4); written at most once a day. */
  readonly lastBriefedAt?: string
  /** On a PROPOSAL only: the kept memories this one would MERGE into one, the first keeping its place (A1.2). */
  readonly merges?: readonly string[]
  /** Why a proposal asks what it asks, when its writer said -- a tidy pass's reason to retire (A1.2). */
  readonly reason?: string
  /**
   * The words of what a proposal would change, as they were when it was
   * made, as a fingerprint. Keeping it after any of them changed is refused
   * (A1.2, agent-native's hash gate): the suggestion was about words that
   * are no longer there.
   */
  readonly basis?: string
  /**
   * What this memory said before it was last rewritten.
   *
   * One step, not a chain: these are single lines of at most 300 characters,
   * and the file has a size cliff that a full history would walk into. It is
   * enough to see what changed and to put it back by hand, which is what a
   * person actually does with a note.
   */
  readonly previousText?: string
}

/**
 * A kept memory that was forgotten, held for a Restore (A1.8): 7 days, then
 * gone for good. Wrapped rather than flattened, so nothing that takes a live
 * memory can be handed a forgotten one by accident.
 */
export interface PublicForgottenMemory {
  readonly memory: PublicMemory
  readonly forgottenAt: string
  /** "you", or the teammate who forgot it -- or asked to, and was agreed with. */
  readonly forgottenBy: { readonly teammateId?: string; readonly name: string }
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
      readonly data: {
        readonly memories: readonly PublicMemory[]
        /** Recently forgotten, newest first (A1.8). */
        readonly forgotten?: readonly PublicForgottenMemory[]
        /** By memory id: the files it names that changed after it was written (A1.3). */
        readonly changedSince?: Readonly<Record<string, readonly string[]>>
        /** When Locust began counting which memories teammates are given (A1.4). */
        readonly briefTrackingSince?: string
        readonly workspaceId: string
        readonly workspaceName: string
      }
    }
  | { readonly ok: false; readonly error: { readonly code: 'MEMORY_REJECTED'; readonly message: string } }

export const RUNTIME_DISCOVERY_CHANNEL = 'runtime-discovery:get'
/** Incremental discovery, pushed as it happens rather than answered once. */
export const RUNTIME_DISCOVERY_EVENT_CHANNEL = 'runtime-discovery:event'
/** The backlog, for a renderer that mounts mid-sweep. */
export const RUNTIME_DISCOVERY_LOG_CHANNEL = 'runtime-discovery:log'
/** The loading window saying it is finished, so the app may open. */
export const SPLASH_DONE_CHANNEL = 'splash:done'

/**
 * What discovery is doing, while it is doing it.
 *
 * The boot screen is a view of THESE, not of a timer: nothing on it is
 * invented and no line is typed out that the app already has in full.
 *
 * `probe.started` is emitted before the subprocess is spawned. That is the
 * contract, not an implementation detail -- the screen exists to show the
 * gap between issuing a command and hearing back, and if both arrive
 * together there is nothing to show during the wait.
 */
export type DiscoveryEvent =
  | { readonly kind: 'started'; readonly at: number }
  /*
   * Named runtimes asked again on their own -- a return to the window, or a
   * run starting on a runtime whose answer had gone stale. Not a sweep, and
   * not narrated by the boot screen; recorded so the log says what was asked.
   */
  | { readonly kind: 'reasked'; readonly ids: readonly string[]; readonly at: number }
  | {
      readonly kind: 'context'
      readonly version: string
      readonly platform: string
      readonly workspace: string
      readonly branch?: string
      readonly clean?: boolean
      readonly ledgerPath: string
      readonly ledgerOk: boolean
    }
  /*
   * `id` is the KEY and `bin` is what is shown.
   *
   * They are not the same string and that cost a real defect: `started`
   * carried the command name and `finished` carried the runtime id, so for
   * every runtime where those differ -- `cursor-agent` against `cursor` --
   * the result never found its row. Colin watched Cursor sit on "still
   * waiting" and then appear green in the table underneath (2026-09-14).
   * One key, named once, on both events.
   */
  | {
      readonly kind: 'probe.started'
      readonly id: string
      readonly bin: string
      readonly product: string
      readonly at: number
    }
  | {
      readonly kind: 'probe.finished'
      readonly id: string
      readonly at: number
      readonly outcome: 'missing' | 'needs-signin' | 'ready' | 'error'
      readonly version?: string
      readonly detail?: string
    }
  | { readonly kind: 'finished'; readonly at: number; readonly ready: number; readonly needsYou: number }
export const CODEX_MISSION_START_CHANNEL = 'codex-mission:start'
export const CODEX_MISSION_CANCEL_CHANNEL = 'codex-mission:cancel'
export const MISSION_HANDOFF_CHANNEL = 'mission:hand-off'
export const MISSION_RESUME_CHANNEL = 'mission:resume'
export const CODEX_MISSION_UPDATE_CHANNEL = 'codex-mission:update'
export const MISSION_HISTORY_CHANNEL = 'mission-history:list'
export const MISSION_DELETE_CHANNEL = 'mission:delete'
export const APP_INFO_CHANNEL = 'app:info'
export const APP_CHANGELOG_CHANNEL = 'app:changelog'
/** The banner was drawn: this version is seen. Not when the changelog was read. */
export const APP_CHANGELOG_SEEN_CHANNEL = 'app:changelog-seen'

/** One group of a build's changes -- "New", "Improved", "Fixed" -- or, before the groups, the whole entry. */
export interface AppChangelogGroup {
  readonly label?: string
  /** Markdown. */
  readonly text: string
}

/** One build in What's new. */
export interface AppChangelogEntry {
  readonly version: string
  readonly date?: string
  readonly groups: readonly AppChangelogGroup[]
}

/** What changed in the build that is running. */
export interface AppChangelog {
  readonly version: string
  /** The entry's markdown, without its heading; absent when the file has none for this build. */
  readonly body?: string
  readonly date?: string
  /**
   * This is the first launch on this version -- so the window may say what
   * changed unprompted. Decided by the host, once per launch, against a
   * version it remembers; the window has nowhere durable to keep that.
   */
  readonly firstRun: boolean
  /** Every build the changelog that shipped with this one describes, newest first. */
  readonly entries?: readonly AppChangelogEntry[]
  /**
   * The builds marked big since the one this person last saw -- the home
   * screen's splash, once. Empty on most updates, and on a first install.
   */
  readonly splash?: readonly AppChangelogEntry[]
}
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
  /** Every build as it is published, or only the one a day testers get (main/update-lane.ts). */
  readonly everyBuild?: boolean
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
/** Switch between every build and the one a day testers get; answers with the update state. */
export const APP_UPDATE_LANE_CHANNEL = 'app-update:lane'
export const MISSION_PRUNE_CHANNEL = 'mission:prune'
export const MISSION_TRASH_LIST_CHANNEL = 'mission:trash:list'
export const MISSION_RESTORE_CHANNEL = 'mission:restore'
export const MISSION_TRASH_EMPTY_CHANNEL = 'mission:trash:empty'

/**
 * A conversation that was deleted and is being kept until the trash is
 * emptied. Deleting takes it out of every listing at once; this is what is
 * still on disk behind that.
 */
export interface PublicTrashedMission {
  readonly missionId: string
  readonly deletedAt: string
  readonly bytes: number
  /** The first line of what was asked, so the list can name it. */
  readonly prompt?: string
  readonly createdAt?: string
}

export type TrashListResponse =
  | { readonly ok: true; readonly data: { readonly missions: readonly PublicTrashedMission[] } }
  | { readonly ok: false; readonly error: { readonly code: 'STORAGE_UNAVAILABLE'; readonly message: string } }

export type TrashMutationResponse =
  | { readonly ok: true; readonly data: { readonly count: number } }
  | {
      readonly ok: false
      readonly error: { readonly code: 'RESTORE_REFUSED' | 'INTERNAL_ERROR'; readonly message: string }
    }

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
  /**
   * Where the durable receipts are written. Carried so that the one card
   * about a ledger that cannot be written can offer to open the folder;
   * nothing else in the renderer needs it.
   */
  readonly ledgerPath: string
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
/**
 * Give a conversation a name of your own.
 *
 * It rides with the roster rather than the ledger on purpose: the ledger is
 * an append-only record of what was asked and what happened, and a title
 * someone changed afterwards is neither. An empty name clears it, and the
 * conversation falls back to the first line that was typed -- which was
 * never overwritten, so nothing is lost by renaming and nothing is lost by
 * undoing it.
 */
export const TEAMMATE_RENAME_MISSION_CHANNEL = 'teammates:renameMission'
export const ROUTINE_LIST_CHANNEL = 'routines:list'
export const ROUTINE_CREATE_CHANNEL = 'routines:create'
export const ROUTINE_UPDATE_CHANNEL = 'routines:update'
export const ROUTINE_REMOVE_CHANNEL = 'routines:remove'
export const ROUTINE_RUN_CHANNEL = 'routines:run'
export const MODEL_CATALOG_CHANNEL = 'models:list'
/**
 * What the person set up inside the CLIs themselves -- agents, commands and
 * automations they wrote for Claude Code, Codex or Cursor. Locust neither
 * creates nor runs these; it lists them, because a machine with nine of them
 * on it read "Nothing saved yet" (Colin, 2026-09-07).
 */
export const RUNTIME_ARTIFACTS_CHANNEL = 'runtime-artifacts:list'
export interface PublicRuntimeArtifact {
  readonly runtime: string
  readonly kind: 'agent' | 'command' | 'automation'
  readonly name: string
  readonly description?: string
  readonly path: string
}

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

/**
 * Keeping the coding agents current (main/runtime-updates.ts).
 *
 * Colin, 2026-09-23: "is there a way to make it so the models will
 * automatically update without messing up load times or interfering with the
 * app". The models are read live from each agent; the agents that never update
 * themselves -- Codex and Copilot, from npm -- are updated here, after launch
 * and only when nothing is using them.
 */
export const RUNTIME_UPDATES_CHANNEL = 'runtime-updates:read'
export const RUNTIME_UPDATES_SET_CHANNEL = 'runtime-updates:set'
/** The person pressed Update on a runtime's row. */
export const RUNTIME_UPDATES_NOW_CHANNEL = 'runtime-updates:now'
/** Pushed when an update starts, lands or fails. */
export const RUNTIME_UPDATES_EVENT_CHANNEL = 'runtime-updates:changed'

export type RuntimeUpdateStatus =
  | { readonly kind: 'current' }
  /**
   * Newer is out and waits: for the person to press Update (updating on its
   * own is off), for nothing to be using it, or -- updating on its own -- for
   * it to have been out long enough to trust.
   */
  | { readonly kind: 'waiting'; readonly version: string; readonly why: 'ask' | 'in use' | 'too new' }
  | { readonly kind: 'updating'; readonly version: string }
  | { readonly kind: 'updated'; readonly from: string; readonly to: string; readonly at: string }
  | { readonly kind: 'failed'; readonly version: string; readonly what: string; readonly at: string }

export interface RuntimeUpdateView {
  readonly runtime: string
  readonly installed: string
  readonly latest: string | undefined
  readonly status: RuntimeUpdateStatus
}

export interface RuntimeUpdatesState {
  /** Updates without being asked: off unless the person turned it on. */
  readonly automatic: boolean
  /** When npm was last asked; undefined before the first look. */
  readonly checkedAt: string | undefined
  readonly agents: readonly RuntimeUpdateView[]
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
      /**
       * The command to show INSTEAD of the one Locust ran, when the remedy is
       * a different command. A permission failure is the case: re-running the
       * same `npm install -g` fails identically, because the global prefix is
       * what is unwritable.
       */
      readonly command?: string
    }
/**
 * Open a runtime's own sign-in in a window of its own. The renderer sends the
 * runtime id only; main runs the command the install facts name, against the
 * executable discovery found. See `main/runtime-sign-in.ts`.
 */
export const RUNTIME_SIGN_IN_CHANNEL = 'runtime:sign-in'

export type RuntimeSignInResponse =
  | { readonly ok: true }
  | { readonly ok: false; readonly what: string; readonly next: string }
export const WORKSPACE_SETTINGS_READ_CHANNEL = 'workspace-settings:read'
export const WORKSPACE_SETTINGS_WRITE_CHANNEL = 'workspace-settings:write'
export const WORKSPACE_CHOOSE_CHANNEL = 'workspace:choose'
/**
 * Show a file a teammate wrote, in the operating system's file manager.
 *
 * The renderer sends a path it already holds; the host honours it only if it
 * resolves inside a workspace the host knows about. See `main/reveal-file.ts`
 * for why that check is the whole point of the channel.
 */
export const WORKSPACE_REVEAL_CHANNEL = 'workspace:reveal'
/**
 * Save a COPY of a file a teammate wrote, wherever the person says.
 *
 * Colin, 2026-09-20, looking at a handover card: give it the little download
 * icon Claude Code has, in case the user wants to easily move it to another
 * folder.
 *
 * It is the same containment as a reveal on the way IN -- the source must
 * resolve inside a folder the host already knows a mission ran in, so a model
 * cannot hand over C:/Windows/something and have the app copy it out. The way
 * OUT is a native save dialog, so the destination is the person's own choice
 * and never a path the renderer named.
 *
 * And it is still not opening. Bytes are copied; nothing is executed, and the
 * rule in reveal-file.ts is untouched.
 */
export const WORKSPACE_SAVE_COPY_CHANNEL = 'workspace:save-copy'

/**
 * Show the diagnostics log, so a person can send it.
 *
 * Takes NO path. `workspace:reveal` has to check the renderer's path against
 * the folders a mission ran in, because the renderer proposes the
 * destination; here the host already knows the only answer -- its own profile
 * -- so there is nothing to propose and nothing to check. The rule the app
 * runs under is that the renderer names no destinations, and the strongest
 * form of that is a channel with no argument at all.
 */
export const DIAGNOSTICS_REVEAL_CHANNEL = 'diagnostics:reveal'

/**
 * Send feedback: the words from the Send feedback box, and the conversation
 * it was sent from when there was one (main/report-problem.ts). The renderer
 * hands over WORDS; the host builds the one address itself, so nothing here
 * can name a destination.
 */
export const FEEDBACK_CHANNEL = 'diagnostics:feedback'

/** What the Send feedback box hands the host. */
export interface FeedbackReport {
  /** What the person wrote. */
  readonly description: string
  /** The conversation it was sent from, as plain text, when it was sent from one. */
  readonly conversation?: string
}

/** Where the log is and whether anything has been written to it yet. */
export interface DiagnosticsReport {
  readonly path: string
  /** False before the first run has written its opening line. */
  readonly exists: boolean
  readonly byteTotal: number
}
export const DIAGNOSTICS_REPORT_CHANNEL = 'diagnostics:report'
/**
 * Choose files to attach to the next message.
 *
 * The host opens the picker and returns only paths INSIDE the workspace --
 * the same containment `main/reveal-file.ts` enforces on the way out, applied
 * on the way in. The renderer never names a folder to open.
 */
/**
 * Attach what is on the clipboard, as bytes.
 *
 * A pasted screenshot has no path -- the clipboard holds a bitmap, not a file
 * -- so there is nothing for the picker's path-based route to take. The
 * renderer sends the bytes and a suggested name; the host decides where they
 * land, exactly as it does for a file chosen from outside the folder.
 */
export const WORKSPACE_PASTE_CHANNEL = 'workspace:paste'
export const WORKSPACE_ATTACH_CHANNEL = 'workspace:attach'

/** Files chosen to attach, workspace-relative, or why none were. */
export type AttachFilesResponse =
  /**
   * `copied` names the paths that were brought in from outside the workspace,
   * a subset of `paths`. Writing into someone's project folder is not
   * something to do quietly, and this is how the composer says so.
   *
   * It used to be a `message` -- one sentence for the whole batch, drawn as a
   * full-width bordered box above the composer, directly above an actual text
   * input and shaped exactly like one. Two objects for one event, and the
   * transient one was carrying a permanent fact: the file STAYS copied for as
   * long as the tile exists, so dismissing the notice lost information that
   * was still true. The tile is the durable object, so the fact goes there
   * (design, 2026-09-08).
   *
   * A subset, not a flag, because a multi-select can copy some files and not
   * others -- one already inside the folder needs no mark, and marking it
   * would claim something that did not happen.
   */
  | { readonly ok: true; readonly paths: readonly string[]; readonly copied?: readonly string[] }
  | { readonly ok: false; readonly message: string }

export const WORKSPACE_IMAGE_CHANNEL = 'workspace:image'
/**
 * Read a text file a teammate wrote, to show beside the conversation.
 *
 * The same containment as the reveal and the image reader: the path is a
 * REQUEST, honoured only inside a folder the host already knows a mission ran
 * in. Bounded, and a refusal rather than a truncation -- see
 * `shared/text-files.ts` for what is readable and why the list is an
 * allowlist.
 */
export type WorkspaceTextResponse =
  | { readonly ok: true; readonly path: string; readonly text: string; readonly mode: 'markdown' | 'code' }
  | { readonly ok: false; readonly message: string }

export const WORKSPACE_TEXT_CHANNEL = 'workspace:text'

/**
 * An attached image, as a `data:` URL the renderer can put in an `<img>`.
 *
 * A refusal is not an error state worth drawing: the file row is already
 * there and already says the file's name, so a preview that cannot be built
 * simply is not drawn. `message` exists for a log, not for a card.
 */
export type WorkspaceImageResponse =
  | { readonly ok: true; readonly dataUrl: string }
  | { readonly ok: false; readonly message: string }

/** What came of a reveal. A refusal names why, in words a card can show. */
export type RevealFileResponse =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string }
export const OPEN_LINK_CHANNEL = 'shell:open-link'
/**
 * What came of opening a link. A refusal names why, the same as a reveal.
 *
 * The host opens only the addresses on its own list; a URL that is not one
 * of them is refused rather than opened, which is what keeps `openExternal`
 * from being a hole through the packaged build's egress rules.
 */
export type OpenLinkResponse =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string }
export const ROOM_LIST_CHANNEL = 'rooms:list'
export const ROOM_CREATE_CHANNEL = 'rooms:create'
export const ROOM_REMOVE_CHANNEL = 'rooms:remove'
/** Name a room that was made from an ask, and so began as `Untitled room`. */
export const ROOM_RENAME_CHANNEL = 'rooms:rename'
export const ROOM_POST_CHANNEL = 'rooms:post'
export const ROOM_TASK_CHANNEL = 'rooms:task'
export const MEMORY_LIST_CHANNEL = 'memory:list'
export const MEMORY_ADD_CHANNEL = 'memory:add'
export const MEMORY_UPDATE_CHANNEL = 'memory:update'
export const MEMORY_REMOVE_CHANNEL = 'memory:remove'
export const MEMORY_CLEAR_CHANNEL = 'memory:clear'
export const MEMORY_RESTORE_CHANNEL = 'memory:restore'
export const RUNTIME_SETUP_CHANNEL = 'runtime:setup'
/** Every connector the person's Claude Code reports, and which each teammate may use. */
export const CONNECTOR_LIST_CHANNEL = 'connectors:list'
export const TEAMMATE_CONNECTORS_CHANNEL = 'teammates:connectors'
/** Pick, or clear, the folder one teammate works in. The host names the path. */
export const TEAMMATE_FOLDER_CHANNEL = 'teammates:folder'
export const WORKTREE_LIST_CHANNEL = 'worktrees:list'
export const WORKTREE_REMOVE_CHANNEL = 'worktrees:remove'
export const MISSION_APPROVAL_CHANNEL = 'mission-approval:request'
export const MISSION_APPROVAL_DECIDE_CHANNEL = 'mission-approval:decide'
/** An approval answered somewhere else -- a question answered in Antigravity's own window. */
export const MISSION_APPROVAL_WITHDRAWN_CHANNEL = 'mission-approval:withdrawn'

export type LocalRuntimeId = 'codex' | 'claude' | 'cursor' | 'gemini' | 'opencode' | 'copilot' | 'antigravity' | 'muse' | 'omniroute'

export type TeammateHue = 'lime' | 'blue' | 'violet' | 'clay' | 'teal' | 'butter' | 'rose' | 'slate' | 'pearl'

export type TeammateRole =
  | 'Code & Migrations'
  | 'Research & Briefs'
  | 'Ops & Scheduling'
  | 'Docs & QA'
  | 'Data & Reporting'
  | 'Chief of Staff'
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
   * The folder THIS teammate works in, when it is not the project folder.
   *
   * Colin, 2026-09-09: "it should only change the folder for that chat/
   * teammate not the entire app." Switching the project folder reopens
   * Locust, because the ledger, the memory store and the worktrees are all
   * scoped by it; a teammate's own folder is a narrower thing that needs
   * none of that, because it only decides where that teammate's runs stand.
   *
   * It is also the only way to reach a local MCP server, which Claude Code
   * registers under a PROJECT KEY in `~/.claude.json`: a server declared for
   * `C:/Users/<home>/claude` exists in that folder and nowhere else, so a
   * teammate that needs it has to be standing there.
   *
   * Written by the HOST from a folder dialog, never named by the renderer.
   * History stays filed under the project folder either way.
   */
  readonly folder?: string
  /**
   * The connectors THIS teammate may use, by the name the CLI prints.
   *
   * Absent means every connector the person's own Claude Code can reach --
   * Colin's ruling, and the ordinary state. Present, it NARROWS: only these
   * are allowed without asking, and a call to any other stops the run and
   * asks through the permission host. Never a grant of something the person
   * does not have: a name that is not on the machine is simply a rule for a
   * server that never appears.
   *
   * Written from the teammate dialog, from a list the host read off
   * `claude mcp list`; never typed.
   */
  readonly connectors?: readonly string[]
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
  /**
   * The latest turn of this teammate's HUB: the one conversation their
   * replies to other teammates land in.
   *
   * Colin, 2026-09-21: "its kind of messy that each time a teammate messages
   * another that it spawns a new chat in ungrouped ... each teammate has
   * their own isolated chat where the replies go to on the sidebar." A
   * reply inside an exchange continues the recipient's own mission in that
   * exchange; a reply that has no such predecessor used to start a brand-new
   * root, and every one of those was another Ungrouped row. Now it continues
   * the hub, and the hub is the row a face opens.
   *
   * Written by the host from the relay, never by the renderer. Absent until
   * the teammate first replies on their own.
   */
  readonly hubMissionId?: string
}

export interface TeammateRoute {
  readonly runtime: MissionRuntimeId
  /** A model id from the catalog, or `account-default`. */
  readonly model: string
  readonly mode: MissionMode
  /**
   * The reasoning effort this route runs at, when its model reports levels.
   *
   * A routine replays the turns you typed, and how hard the model was asked to
   * think is part of how it ran -- one saved while set to `high` that replays
   * at the runtime's default is not the same routine. Absent on every runtime
   * whose models report no levels, which is also every runtime whose command
   * builder refuses an effort outright.
   */
  readonly effort?: string
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
  /**
   * `missionId` is the sender's own mission -- the work that produced this
   * message. The store has always carried it (`WorkroomSender.missionId`);
   * the public shape dropped it, so the receiving side could name the
   * teammate and not reach them. Carried now, because a message is
   * attributable to exactly one piece of work and the reader should be able
   * to go there.
   */
  readonly from: { readonly teammateId: string; readonly name: string; readonly missionId?: string }
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
  /** The model picked on the dialog's Model row; omitted, their first mission's is kept. */
  readonly route?: TeammateRoute
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
  /**
   * The model picked on the dialog's Model row (0.311). Colin, 2026-09-24:
   * "do we have the ability to switch a teammates model? like not when
   * youre in the chat but the actual designated teammate". Omitted, the
   * route stays what it was.
   */
  readonly route?: TeammateRoute
}

export type TeammateListResponse =
  | {
      readonly ok: true
      readonly data: {
        readonly teammates: readonly PublicTeammate[]
        readonly missionOwners: Readonly<Record<string, string>>
        /** Names people typed for conversations, by mission id. */
        readonly missionTitles: Readonly<Record<string, string>>
      }
    }
  | { readonly ok: false; readonly error: { readonly code: 'TEAMMATES_UNAVAILABLE'; readonly message: string } }

export type TeammateMutationResponse =
  | { readonly ok: true; readonly data: { readonly teammate?: PublicTeammate } }
  | { readonly ok: false; readonly error: { readonly code: 'TEAMMATE_REJECTED'; readonly message: string } }

/** One MCP server the CLI reported, as the person would recognise it. */
export interface PublicConnector {
  readonly name: string
  /** A URL for a remote connector, a command for a local one. */
  readonly location: string
  /** `needs-auth` is a real connector the person has not finished signing into. */
  readonly status: 'connected' | 'needs-auth' | 'failed'
}

export type ConnectorListResponse =
  | { readonly ok: true; readonly data: { readonly connectors: readonly PublicConnector[] } }
  | { readonly ok: false; readonly error: { readonly code: 'CONNECTORS_UNAVAILABLE'; readonly message: string } }

/**
 * The answer to a folder request for one teammate.
 *
 * `CANCELLED` is the ordinary outcome -- the person closed the dialog -- and
 * is never drawn as trouble.
 */
export type TeammateFolderResponse =
  | { readonly ok: true; readonly data: { readonly teammate: PublicTeammate } }
  | {
      readonly ok: false
      readonly error: {
        readonly code: 'CANCELLED' | 'REJECTED'
        readonly message: string
      }
    }

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
  readonly execution?: import('./routine-recovery.js').RoutineExecution
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
  /**
   * Who is still waiting for a slot, in the order they will get one.
   *
   * A post asks everyone in the room, but only `MAX_LIVE_MISSIONS` can run
   * at once and a teammate already working cannot take a second mission. A
   * member in that position is not refused -- waiting fixes it -- so they
   * wait here and start when a slot frees.
   *
   * Before this existed they were simply never asked, and the room said so
   * and moved on. That cost was permanent and it was paid by the RECORD:
   * a teammate who never started left no mission at all, so the next day
   * nothing showed they had been asked.
   *
   * A name leaves this list the moment its mission starts, and appears in
   * `missions` instead. Absent on posts written before this existed.
   */
  readonly queued?: readonly string[]
  /**
   * Why a member was not asked at all, by teammate id, in the host's own
   * words. Only reasons waiting cannot fix -- gone from the roster, a
   * runtime a room cannot post to. Anything retryable queues instead.
   *
   * Recorded because the reason is a fact about the PAST. It used to live
   * only in the response to the post -- shown once in the composer note,
   * then overwritten by the next thing the room had to say -- so a reload,
   * or simply waiting for the room to finish, left the absence with no
   * explanation at all. Absent on posts written before this existed.
   */
  readonly refused?: Readonly<Record<string, string>>
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

/**
 * A named set of conversations, in this folder.
 *
 * More than a folder, by Colin's ruling of 2026-09-15: a group carries
 * standing instructions and a default route, so filing a conversation into
 * one buys something. `instructions` and `route` are part of the shape from
 * the start even while nothing writes them yet -- a group that learned about
 * them later would mean migrating a file people already had.
 *
 * The route is a SEED, not an override: it applies once, when a conversation
 * is created in the group, and the conversation owns its route from then on.
 * So changing a group's default can never reach back and silently rewrite
 * the route of work that has already run.
 */
export interface PublicGroup {
  readonly groupId: string
  readonly name: string
  readonly createdAt: string
  /** What every conversation started in this group is briefed with. */
  readonly instructions: string
  /** What a conversation started here begins on. Absent means no default. */
  readonly route?: TeammateRoute
}

export const GROUP_LIST_CHANNEL = 'groups:list'
export const GROUP_CREATE_CHANNEL = 'groups:create'
export const GROUP_RENAME_CHANNEL = 'groups:rename'
export const GROUP_REMOVE_CHANNEL = 'groups:remove'
/** Move a conversation into a group, or out of one with no group id. */
export const GROUP_ASSIGN_CHANNEL = 'groups:assign'
/** Set what every conversation in a group is briefed with. Empty clears it. */
export const GROUP_INSTRUCTIONS_CHANNEL = 'groups:instructions'
export const GROUP_ROUTE_CHANNEL = 'groups:route'

/**
 * Which group a conversation is in, and when it joined.
 *
 * The moment matters: instructions brief from joining onward and never
 * retroactively, so the thread marks the boundary rather than claiming the
 * turns above it were briefed too.
 */
export interface GroupMembership {
  readonly groupId: string
  readonly at?: string
}

/**
 * A membership that ended: the conversation left the group, was moved to
 * another, or the group was removed. The group's name and words are kept AS
 * THEY WERE, because the line in the thread ("Trading's instructions no
 * longer apply from here") has to stay true after the group is renamed,
 * edited or gone.
 */
export interface LeftMembership {
  readonly groupId: string
  readonly name: string
  readonly instructions: string
  /** When it joined, if that was recorded. */
  readonly at?: string
  /** When it left, ISO. */
  readonly until: string
}

export type GroupListResponse =
  | {
      readonly ok: true
      readonly data: {
        readonly groups: readonly PublicGroup[]
        readonly members: Readonly<Record<string, GroupMembership>>
        /** Memberships that ended, by conversation, oldest first. */
        readonly left: Readonly<Record<string, readonly LeftMembership[]>>
      }
    }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

export type GroupMutationResponse =
  | { readonly ok: true; readonly data: Record<string, never> }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

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
        /**
         * Whether npm can be run at all.
         *
         * Four of the five runtimes install through it, so its absence is a
         * PRECONDITION, not a failure: a button that cannot work is worse
         * than the truth. This was designed, built into the screen, and then
         * never computed -- so the state could not occur, and a machine
         * without Node got "npm stopped with an error after 1s" from the
         * command the app had just offered to run for it (drive, 2026-09-06,
         * pressing the button for the first time).
         */
        readonly npmPresent?: boolean
        /**
         * True when the npm that will run is the one this app carries, not
         * one on the machine. The buttons work either way; what differs is
         * that a CLI installed this way is reachable from Locust and not
         * from the person's own terminal, which is worth saying on screen
         * rather than leaving to be discovered.
         */
        readonly npmIsBundled?: boolean
        /**
         * npm IS on this machine and did not answer its version check in five
         * seconds -- nvm-windows with no version picked, a corporate wrapper
         * waiting on a proxy.
         *
         * Carried apart from `npmIsBundled` because they are the same VALUE
         * and different SENTENCES: both select the app's own npm, correctly,
         * but only one of them means "Node.js is not on this machine". Fable
         * measured the wrong sentence on a box with Node on PATH and only npm
         * hanging (pass 2, finding 3). The host knew; it stopped saying.
         */
        readonly npmDidNotAnswer?: boolean
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
  /**
   * On RUN_ALREADY_ACTIVE only: `pool` when every run slot is taken rather
   * than this teammate being mid-run. Same code, because a person's message
   * waits either way; the relay has to know which, because a reply held for
   * an IDLE teammate never sees that teammate's run end (harness review,
   * 2026-09-24).
   */
  readonly busy?: 'pool'
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
  /**
   * The level the runtime itself starts this model at, when it says one.
   * Cursor lists that variant under the model's bare name -- "Kimi K3" is
   * `kimi-k3-max` -- and a new route starts there rather than on Locust's
   * own guess (`defaultEffort` in status.ts).
   */
  readonly defaultEffort?: string
  /** The runtime this model belongs to; a model is never offered under another. */
  readonly runtime: MissionRuntimeId
  readonly displayName: string
  readonly description: string
  readonly supportedEfforts: readonly string[]
  /**
   * An older, fixed version -- offered folded under the runtime's current
   * models rather than beside them. Colin, 2026-09-22: "folded claude models
   * is great, accessible but not crowding".
   */
  readonly older?: boolean
}

export type ModelCatalogResponse =
  | { readonly ok: true; readonly data: { readonly models: readonly PublicModel[] } }
  | { readonly ok: false; readonly error: { readonly code: 'MODELS_UNAVAILABLE'; readonly message: string } }

/**
 * Workspace-wide settings. `swarm` runs every mission at its model's MAXIMUM
 * supported effort -- which is only meaningful because the catalog reports
 * effort per model, so "maximum" is a real value rather than a guess.
 */
/** The shell layout a person has asked for. `auto` follows the window width. */
export type LayoutPreference = 'auto' | 'compact' | 'wide'
/** How much theatre the boot screen is allowed. */
export type TubePreference = 'full' | 'subtle' | 'off'

/**
 * How big a teammate's reply is set.
 *
 * A real preference, and it exists because I got this wrong on Colin's own
 * screen. 0.198.0 moved the reply from 15px to 18px off a character count --
 * the count was right that 15px rendered 111-character lines, and it could not
 * answer the question it was used to settle, which is how big the type should
 * be. Colin, seeing it on his monitor: "go back to the old text size, this
 * shit looks insane, or you can have it be changeable in settings".
 *
 * So the default is what he had, and the size is his rather than mine.
 * Absent or malformed reads as `standard`, which is 15px.
 */
export type ReplyTextSize = 'standard' | 'large' | 'largest'

/**
 * The metal on the send button.
 *
 * Every option the design agent put forward, on screen rather than in a
 * constant, because Colin asked to see them all before a default is chosen
 * (2026-09-20: *"we can have use all the options the design agent threw at
 * us, we can pick a default soon once we see them all"*). The library ships
 * exactly `chromatic`, `silver` and `gold`; `off` is this app's own.
 *
 * `off` is not only taste. The effect is WebGL, and a person on a tired
 * machine — or one who simply does not want a shader in their composer —
 * should be able to say so without editing anything.
 */
export type MetalPreset = 'off' | 'chromatic' | 'silver' | 'gold'

/**
 * How strong, as words rather than a float.
 *
 * The three the brief and Colin actually named: 0.35 was his starting point,
 * 0.55 the design agent's recommendation, and 1.0 the "aggressive glow to
 * avoid" — so the top of this scale stops short of it.
 */
export type MetalStrength = 'subtle' | 'standard' | 'strong'

/**
 * When it moves.
 *
 * `hover` is the design agent's proposal and the reason is the app's own
 * rule: motion means work is happening, so a permanently shimmering button
 * says "running" on a screen where nothing is. `always` is the version it
 * asked to reject — kept here because a rejection is easier to agree with
 * after seeing it.
 */
export type MetalMotion = 'hover' | 'always'

export interface WorkspaceSettings {
  readonly swarm: boolean
  /** The metal on the send button; `off` removes it entirely. */
  readonly metal?: MetalPreset
  readonly metalStrength?: MetalStrength
  readonly metalMotion?: MetalMotion
  /** The cursor bend — the "gooey" dent that rides the ring. */
  readonly metalBend?: boolean
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
  /**
   * Whether a teammate may INTERRUPT another rather than wait their turn.
   *
   * A teammate runs one mission at a time, so a message that arrives mid-run
   * waits for that run to end. Usually right. Sometimes far too late: the
   * common urgent message is "stop, I am editing that file", and delivering
   * it after the conflicting work is done delivers it after the damage.
   *
   * Off until a person turns it on, because it SPENDS and DISCARDS: the
   * recipient's turn is stopped where it stands. On, a share that carries
   * `when="now"` stops the recipient's run so the message is taken next;
   * anything else still waits. Read when a message is relayed, never cached.
   */
  readonly interrupt: boolean
  /** What happens to a memory a teammate writes. Absent or malformed reads as the default. */
  readonly memoryMode: MemoryMode
  /**
   * Whether the Auto mode may be chosen at all. Off until a person turns it
   * on, and the host checks it again when a run starts -- a mode that lets a
   * runtime change files anywhere on the machine is not something a stale
   * window or a saved routine gets to decide.
   */
  readonly autoMode: boolean
  /**
   * Ask before every connector call, instead of allowing the ones the person
   * already has.
   *
   * Off is Colin's ruling and the ordinary state: a connector the person's
   * Claude Code can reach is allowed without asking. On sends no allow rules,
   * so every connector call stops the run and raises the approval card --
   * the way every other client behaves -- with "always" remembered per
   * connector until the mission ends. Checked when a run starts, never
   * cached; absent or malformed reads as off.
   */
  readonly askConnectors: boolean
  /**
   * Ask the teammate to keep a todo list as it works, so the board fills in
   * while the mission runs.
   *
   * Off by default and opt in, because it spends tokens on bookkeeping and
   * changes how a runtime narrates itself -- worth it when you are watching,
   * noise when you are not. Only ever sent to a runtime that HAS such a tool
   * (`RUNTIMES_THAT_KEEP_A_TODO_LIST`); Claude Code has none, so the sentence
   * is never added to its briefing whatever this says. Absent or malformed
   * reads as off.
   */
  readonly keepATodoList: boolean
  /**
   * Which shell layout to draw: the full sidebar, the compact avatar rail, or
   * whichever the window width calls for. Colin asked for the layout to be a
   * choice as well as a consequence of window size (2026-09-07). Absent or
   * malformed reads as `auto`, which is what it did before the choice existed.
   */
  readonly layout: LayoutPreference
  /**
   * How much of the boot screen to draw while runtimes are found.
   *
   * A real preference because a person will see this on every launch --
   * hundreds of times. `full` is the phosphor tube, `subtle` keeps the wash
   * and drops the flicker and glare, `off` skips the ceremony entirely and
   * goes straight to the pane. Absent or malformed reads as `full`.
   */
  readonly tube: TubePreference
  /**
   * How big to set a teammate's reply. Absent or malformed reads as
   * `standard` -- see `ReplyTextSize`, which carries the reason this is a
   * setting at all.
   */
  readonly replySize: ReplyTextSize
}

/*
 * The budget is a BACKSTOP, not a conversation length.
 *
 * It was six, and six was firing as the ordinary way an exchange ended: five
 * runs of a one-word question went 6, 6, 3, 6, 7 hops (MEASURED 2026-09-11).
 * A limit that fires in the normal case is not a backstop, it is a timer, and
 * a teammate cut off mid-thought is the worse failure of the two.
 *
 * Colin, the same day: "I honestly think we should just let the teammates talk
 * until it comes to a natural end. That just seems like the smoothest
 * integration." Right about the goal. The thing that stopped it being true was
 * that exchanges were not ENDING -- the brief now names what a reply costs,
 * and three runs after it went 2, 5, 3.
 *
 * So: generous enough that a person never meets it while the work is real,
 * small enough that two models stuck in a loop at three in the morning do not
 * empty an account. Twelve is roughly four times the observed median, and the
 * spend it bounds is now the WHOLE exchange rather than one chain of it.
 */
export const DEFAULT_RELAY_HOP_CAP = 12
export const MIN_RELAY_HOP_CAP = 1
export const MAX_RELAY_HOP_CAP = 24

/** What the runtime is asking permission to do. */
/**
 * `connector` is a Claude Code run asking to use one of the person's MCP
 * tools. It arrives through Locust's own permission host rather than the
 * app-server protocol, but it is answered by the same card, with the same
 * three decisions -- and "always" is remembered for that connector on that
 * run, the way every other client does it.
 */
export type MissionApprovalKind = 'command' | 'file-change' | 'question' | 'connector'

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
   * Who is asking. The card used to print "Codex CLI" as a constant, which
   * was true for as long as Codex was the only runtime that could ask; a
   * Claude Code connector permission wore the wrong name in its first drive
   * (2026-09-10). Absent on a record from before this field: read as Codex.
   */
  readonly runtime?: MissionRuntimeId
  /**
   * For a file change: the unified diff Codex attached to the item the
   * approval is about, bounded like a ledger patch. Absent when the runtime
   * sent none -- the card then says what it was told and no more.
   */
  readonly patch?: ApprovalPatch
  /**
   * For a question: what was actually asked, structured.
   *
   * Present only on `kind: 'question'`. A command or a file change is
   * authorized, not answered, so it carries none.
   */
  readonly questions?: readonly MissionQuestion[]
  /**
   * Whether the runtime is waiting on this before it can go on.
   *
   * The protocol says so per request and Locust assumed it of every one. A
   * non-blocking question is one the run continues past, and drawing it as a
   * stop-everything card would be a claim about the run that is not true.
   */
  readonly blocking?: boolean
  /**
   * Where the question has to be answered, when it cannot be answered here.
   *
   * Antigravity's questions are answered through its own server; when Locust
   * could not find the waiting step there, the card still shows the question
   * and says to answer it in this app's window, with no buttons that would
   * pretend otherwise.
   */
  readonly answerIn?: string
  /** A question the person may decline, as Antigravity's own card offers. */
  readonly skippable?: boolean
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

/** One choice a question offers. The protocol gives a label and a description, and no id. */
export interface MissionQuestionOption {
  readonly label: string
  readonly description: string | null
}

/**
 * One question a runtime asked, as the protocol actually sends it.
 *
 * `item/tool/requestUserInput` carries a `questions` ARRAY, each entry with its
 * own id, header, text, flags and nullable options. Locust read singular
 * `params.question` / `prompt` / `message` and found none of them, so the card
 * showed "Answer a question" with no question -- verified against the schema
 * codex-cli 0.153.0 generates for itself (Astra, 2026-09-09).
 */
export interface MissionQuestion {
  /** The key an answer is filed under. Not an index, not the request id. */
  readonly id: string
  readonly header: string | null
  readonly question: string
  /** Absent or empty means free text only. */
  readonly options: readonly MissionQuestionOption[]
  /** The person may answer with something not offered. */
  readonly isOther: boolean
  /** The answer is sensitive: never logged, never persisted in the clear. */
  readonly isSecret: boolean
}

/**
 * What the person said back.
 *
 * A question is NOT an authorization, and this is where that stops being a
 * comment and becomes a type. A command or a file change is answered with a
 * decision; a question is answered with ANSWERS, keyed by question id, each a
 * list of strings -- a chosen option's literal label, or free text, or both.
 *
 * Locust used to send `{ decision: 'accept' }` for all three buttons on a
 * question card. The server cannot deserialize that as an answer, logs the
 * failure, and submits an EMPTY answer map -- so the person's selection was
 * discarded and the model was told they had said nothing. "Always allow this
 * session" was the worst of the three, because there is no session-grant field
 * for a question at all: it promised something the protocol has no way to mean.
 */
export type MissionApprovalAnswer =
  | { readonly approvalId: string; readonly decision: MissionApprovalDecision }
  | {
      readonly approvalId: string
      /** Keyed by `MissionQuestion.id`; each value is that question's answers. */
      readonly answers: Readonly<Record<string, readonly string[]>>
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
  /** Raw picker identity before an effort choice expands a model variant. */
  readonly modelChoice?: string
  /** Only a person's picker change this session, addressed to this teammate. */
  readonly routeOverrideFor?: string
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
  /**
   * Set when this reply went to ANOTHER runtime than the turn it answers: the
   * host reconciled that turn and briefed this runtime from it (a
   * 'route-switch' continuation). Without it the window could not tell a
   * switch from an ordinary reply, and drew no seam until the conversation
   * was rebuilt from the record (drive-runtime-switch, packaged 0.309).
   */
  readonly switchedFrom?: {
    readonly missionId: string
    readonly runtime: MissionRuntimeId
    /** Actions that had started and never reported back when that turn ended. */
    readonly unsettledCount: number
    /** Sections of the briefing dropped to fit the prompt bound, if any. */
    readonly omittedBriefing: readonly string[]
  }
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
   * The host has decided on a reply and is starting it.
   *
   * Sent BEFORE the runtime exists, and paired with `relay-start-settled`.
   * `mission-started` cannot carry this: it needs a run id, which means
   * waiting for a cold runtime to boot -- and for those seconds the window
   * was told nothing at all, so every row read idle and a room in the middle
   * of an argument looked finished (MEASURED 2026-09-11).
   *
   * One per teammate at a time, because a teammate runs one mission at a
   * time; `teammateId` is therefore the whole key.
   */
  | {
      readonly kind: 'relay-starting'
      readonly teammateId: string
      readonly name: string
      /** The mission whose message this will answer, so a room can place the turn. */
      readonly answering: string
      readonly hop: number
    }
  /** That start finished, however it finished. The placeholder goes. */
  | {
      readonly kind: 'relay-start-settled'
      readonly teammateId: string
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
      /**
       * Present when this run is the newest turn of the teammate's hub (see
       * `PublicTeammate.hubMissionId`), so the roster on screen learns it
       * without a refresh -- the face has to open the hub from this moment.
       */
      readonly hubMissionId?: string
    }
  /**
   * A post was written to a room, before anybody has been asked.
   *
   * The post has existed before the first run since the queue landed, but
   * nothing SAID so: the window learned about it either from the first
   * `mission-started` -- which waits for a cold runtime to boot -- or from
   * the post's own response, which lands after every member has been tried.
   * So a person pressed Post and watched "Nothing posted yet" with their own
   * words still in the box (Colin, 2026-09-11).
   */
  | {
      readonly kind: 'room-posted'
      readonly roomId: string
      readonly postId: string
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
      /**
       * Memories that REPLACED an earlier one filed under the same name.
       * Separate from `kept` on purpose: adding a fact and changing one a
       * person may already have acted on are different events, and folding
       * them together lets a memory move under them without a word.
       */
      readonly rewritten?: readonly string[]
      /**
       * In ask mode, a CHANGE to a kept memory waiting for the person: the
       * new wording of a rewrite, the words of a memory it wants forgotten
       * (0.315). Not `proposed`: "wants to remember" would misname both.
       */
      readonly proposedChanges?: readonly string[]
      readonly proposedForgets?: readonly string[]
      /** A tidy pass's suggestions made proposals, and the ones refused with why (A1.2). */
      readonly proposedTidy?: number
      readonly tidyRefused?: readonly string[]
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
  | { readonly kind: 'routine-recovery-changed' }

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
  /**
   * A fingerprint of this record exactly as it was sent, on a record that came
   * with its events. The window hands it back on its next history read, and a
   * record that has not changed since comes back without them (`eventsKept`).
   */
  readonly digest?: string
  /**
   * The events are the ones the window already holds under `digest`: keep
   * those. Set only on a record the window said it had.
   */
  readonly eventsKept?: boolean
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
         * Ledger files that raised an issue and produced no mission at all.
         *
         * Separate from `issueCount` because the screen needs a count of
         * FILES, not of issues: one badly damaged file raises several. And
         * separate from the per-mission counts because these files have no
         * mission to hang a count on -- which is exactly why the Missions
         * header used to read "ledger verified" for a ledger it could not
         * read (Astra, 2026-09-08).
         */
        readonly unreadableCount: number
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
  /** What changed in the running build, and whether this is its first launch. */
  getChangelog(): Promise<AppChangelog>
  /**
   * Called when the "what changed" banner is actually on screen. Reading the
   * changelog used to mark the version seen, so a banner held at launch
   * (nothing connected yet) was never shown on the next launch either
   * (Fable, pass 1, finding 7).
   */
  markChangelogSeen(): Promise<void>
  readStorageReport(): Promise<StorageReportResponse>
  checkForUpdate(): Promise<AppUpdateResponse>
  installUpdate(): Promise<AppUpdateResponse>
  /** Every build, or only the one a day testers get; checks again on the new lane. */
  setUpdateLane(everyBuild: boolean): Promise<AppUpdateResponse>
  onUpdateState(listener: (state: AppUpdateState) => void): () => void
  pruneMissions(request: MissionPruneRequest): Promise<MissionPruneResponse>
  /**
   * Ask the machine what it has. `fresh` drops every cached answer first --
   * including whether npm is there, which is otherwise decided once per
   * session. That is the Check again path: the one repair the app offers
   * should be able to repair the npm reading too (Fable, pass 2, finding 3b).
   *
   * `only` asks just those runtimes again and keeps every other answer: the
   * window's re-asks name the runtimes they are waiting on.
   */
  getLocalRuntimes(fresh?: boolean, only?: readonly string[]): Promise<RuntimeDiscoveryResponse>
  /**
   * The mission history. `known` is what this window already holds, as
   * `missionId -> digest`: a whole record that has not changed since comes
   * back as `eventsKept` with no events, so an unchanged history is not sent
   * again on every run end.
   */
  getMissionHistory(known?: Readonly<Record<string, string>>): Promise<MissionHistoryResponse>
  /** Remove a finished mission's record for good. Refused while it is live. */
  deleteMission(missionId: string): Promise<MissionDeleteResponse>
  /** What is in the trash, newest deletion first. */
  listTrashedMissions(): Promise<TrashListResponse>
  /** Put a deleted conversation back, whole. */
  restoreMission(missionId: string): Promise<TrashMutationResponse>
  /** Delete the trash for good. */
  emptyTrash(): Promise<TrashMutationResponse>
  listTeammates(): Promise<TeammateListResponse>
  createTeammate(request: TeammateCreateRequest): Promise<TeammateMutationResponse>
  updateTeammate(request: TeammateUpdateRequest): Promise<TeammateMutationResponse>
  removeTeammate(teammateId: string): Promise<TeammateMutationResponse>
  assignMission(teammateId: string, missionId: string): Promise<TeammateMutationResponse>
  /** Name a conversation. An empty name clears it back to what was typed. */
  renameMission(missionId: string, title: string): Promise<TeammateMutationResponse>
  listGroups(): Promise<GroupListResponse>
  createGroup(name: string): Promise<GroupMutationResponse>
  renameGroup(groupId: string, name: string): Promise<GroupMutationResponse>
  removeGroup(groupId: string): Promise<GroupMutationResponse>
  /** Pass no group id to take a conversation out of its group. */
  assignGroup(missionId: string, groupId: string | undefined): Promise<GroupMutationResponse>
  setGroupInstructions(groupId: string, instructions: string): Promise<GroupMutationResponse>
  /** Pass no route to clear the group's default. */
  setGroupRoute(groupId: string, route: TeammateRoute | undefined): Promise<GroupMutationResponse>
  listRoutines(): Promise<RoutineListResponse>
  createRoutine(request: RoutineCreateRequest): Promise<RoutineMutationResponse>
  updateRoutine(request: RoutineUpdateRequest): Promise<RoutineMutationResponse>
  removeRoutine(routineId: string): Promise<RoutineMutationResponse>
  /** Replay a routine: its first step starts now, each later step when the one before completes. */
  runRoutine(routineId: string): Promise<RoutineRunResponse>
  /** Answer a pending approval. Unknown or already-answered ids are ignored. */
  listModels(): Promise<ModelCatalogResponse>
  /** Read-only: what the installed CLIs already have set up. */
  listRuntimeArtifacts(): Promise<readonly PublicRuntimeArtifact[]>
  /** Run the install the screen showed, for a runtime that comes from npm. */
  installRuntime(runtime: string): Promise<RuntimeInstallResponse>
  /** npm output while an install runs. Returns the unsubscribe. */
  onRuntimeInstallProgress(listener: (progress: RuntimeInstallProgress) => void): () => void
  /** The coding agents Locust keeps current, and what it has done about them. */
  readRuntimeUpdates(): Promise<RuntimeUpdatesState>
  /** Update them without being asked, or not. */
  setRuntimeUpdates(automatic: boolean): Promise<RuntimeUpdatesState>
  /** Update this one now: the person pressed Update on its row. */
  updateRuntimeNow(runtime: string): Promise<RuntimeUpdatesState>
  /** An update started, landed or failed. Returns the unsubscribe. */
  onRuntimeUpdates(listener: (state: RuntimeUpdatesState) => void): () => void
  /** Open the runtime's sign-in in its own window. */
  signInRuntime(runtime: string): Promise<RuntimeSignInResponse>
  readWorkspaceSettings(): Promise<WorkspaceSettings>
  /** Pick the folder the teammates work in. Reopens the app there on success. */
  chooseWorkspace(): Promise<WorkspaceChooseResponse>
  /**
   * Show a file in the file manager. Answers whether it was shown, so the
   * card can say something rather than appear to do nothing.
   */
  revealFile(path: string): Promise<RevealFileResponse>
  /** Save a copy of a file a teammate wrote, to a place the person picks. */
  saveCopy(path: string): Promise<RevealFileResponse>
  /** Read a workspace text file for the viewer. */
  readTextFile(path: string): Promise<WorkspaceTextResponse>
  /** Show the diagnostics log in the file manager. Names no path. */
  revealDiagnostics(): Promise<void>
  /** Open the feedback report, filled in, in the person's browser. Names no address. */
  sendFeedback(report: FeedbackReport): Promise<OpenLinkResponse>
  /** Where the log is, for the sentence that tells a person what to send. */
  diagnosticsReport(): Promise<DiagnosticsReport>
  /** Open one of the addresses the host allows, in the person's browser. */
  openLink(url: string): Promise<OpenLinkResponse>
  /** Open the picker for files to attach; answers workspace-relative paths. */
  attachFiles(): Promise<AttachFilesResponse>
  /**
   * Attach one thing from the clipboard. `bytes` is the file's contents; the
   * name is a suggestion the host sanitises and may change to avoid a
   * collision.
   */
  attachPasted(name: string, bytes: Uint8Array): Promise<AttachFilesResponse>
  readWorkspaceImage(path: string): Promise<WorkspaceImageResponse>
  listRooms(): Promise<RoomListResponse>
  createRoom(request: RoomCreateRequest): Promise<RoomMutationResponse>
  removeRoom(roomId: string): Promise<RoomMutationResponse>
  /** Give a room a name. A room made from an ask starts as `Untitled room`. */
  renameRoom(roomId: string, name: string): Promise<RoomMutationResponse>
  postToRoom(request: RoomPostRequest): Promise<RoomPostResponse>
  updateRoomTask(request: RoomTaskRequest): Promise<RoomTaskResponse>
  listMemories(): Promise<MemoryListResponse>
  /** Each runtime's own MCP servers and hooks, read-only. */
  readRuntimeSetup(): Promise<RuntimeSetupResponse>
  /**
   * Choose the folder one teammate works in, or clear it back to the project
   * folder. Nothing reopens: only that teammate's next run moves.
   */
  chooseTeammateFolder(teammateId: string, clear?: boolean): Promise<TeammateFolderResponse>
  /** Every connector the person's Claude Code reports. Cached by the host; slow to refresh. */
  listConnectors(): Promise<ConnectorListResponse>
  /**
   * Which connectors one teammate may use without asking. The WHOLE list every
   * time; an empty list means every connector, which is the default.
   */
  setTeammateConnectors(teammateId: string, names: readonly string[]): Promise<TeammateFolderResponse>
  /** The teammates' own worktrees under the folder, and whether the folder can have them. */
  listWorktrees(): Promise<WorktreeListResponse>
  /** Remove a teammate's worktree. The branch stays. Refused while a run is live in it. */
  removeWorktree(teammateId: string): Promise<WorktreeListResponse>
  addMemory(request: MemoryAddRequest): Promise<MemoryListResponse>
  updateMemory(request: MemoryUpdateRequest): Promise<MemoryListResponse>
  removeMemory(memoryId: string): Promise<MemoryListResponse>
  clearMemories(request: MemoryClearRequest): Promise<MemoryListResponse>
  /** Put a recently forgotten memory back, as it was. */
  restoreMemory(memoryId: string): Promise<MemoryListResponse>
  writeWorkspaceSettings(settings: WorkspaceSettings): Promise<WorkspaceSettings>
  decideMissionApproval(answer: MissionApprovalAnswer): Promise<{ readonly ok: boolean }>
  onMissionApproval(listener: (request: MissionApprovalRequest) => void): () => void
  onMissionApprovalWithdrawn(listener: (approvalId: string) => void): () => void
  startCodexMission(request: CodexMissionStartRequest): Promise<CodexMissionStartResponse>
  cancelCodexMission(request: CodexMissionCancelRequest): Promise<CodexMissionCancelResponse>
  handOffMission(request: MissionHandoffRequest): Promise<MissionHandoffResponse>
  resumeMission(request: MissionResumeRequest): Promise<MissionHandoffResponse>
  onCodexMissionUpdate(listener: (update: CodexMissionUpdate) => void): () => void
  /**
   * Discovery, as it happens. Replays whatever has already been emitted
   * before this launch's sweep, so a renderer that subscribes late still
   * sees the whole log rather than joining halfway.
   */
  onDiscoveryEvent(listener: (event: DiscoveryEvent) => void): () => void
  /**
   * Everything discovery has said so far this launch.
   *
   * Pushing alone is not enough and this was measured: the host replays its
   * log the moment the window is created, and the renderer has not mounted
   * yet, so those messages arrive at a page with no listener and are gone.
   * Push carries what happens next; this carries what already happened.
   */
  discoveryLog(): Promise<readonly DiscoveryEvent[]>
  /**
   * Said by the loading window when its sequence has finished.
   *
   * The app window is built but not shown until this arrives, so the
   * runtimes are already answered by the time anybody sees the workspace --
   * which is the whole point of a loading screen (Colin, 2026-09-14: "have
   * just that monitor screen be the loading screen and once its done, THEN
   * go to our app").
   */
  splashDone(): void
  recoverRoutine(request: import('./routine-recovery.js').RoutineRecoveryRequest): Promise<import('./routine-recovery.js').RoutineRecoveryResponse>
}

/** The words for what a teammate does: their own for a Custom role, the role's name otherwise. */
export function roleLabelOf(teammate: Pick<PublicTeammate, 'role' | 'roleTitle'>): string {
  const title = teammate.roleTitle?.trim() ?? ''
  return teammate.role === 'Custom' && title.length > 0 ? title : teammate.role
}
