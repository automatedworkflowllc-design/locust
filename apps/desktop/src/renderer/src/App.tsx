import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'

import type { MissionRuntimeId, NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

import type { AvatarSpec } from '../../shared/avatar.js'

import type {
  RuntimeUpdatesState,
  LayoutPreference,
  TubePreference,
  ReplyTextSize,
  MetalPreset,
  MetalStrength,
  MetalMotion,
  CodexMissionUpdate,
  MissionRouteSummary,
  GroupMembership,
  LeftMembership,
  PublicGroup,
  PublicRecoveredMission,
  PublicRuntimeStatus,
  PublicStorageReport,
  MissionPruneResponse,
  AppChangelog,
  TrashListResponse,
  TrashMutationResponse,
  AppUpdateResponse,
  AppUpdateState,
  MissionApprovalDecision,
  MissionApprovalRequest,
  MissionApprovalAnswer,
  MissionHistoryResponse,
  MissionMode,
  PublicModel,
  PublicRuntimeArtifact,
  PublicPeerMessage,
  PublicRoutine,
  PublicTeammate,
  TeammateHue,
  TeammateRole,
  TeammateRoute, PublicRoom, RoomTaskRequest,
  RoutineSchedule,
  MemoryListResponse,
  MemoryMode,
  MemoryScope,
  MemoryUpdateRequest,
  PublicMemory,
  PublicRuntimeSetup,
  PublicWorkspaceBrief,
  PublicWorktree,
  PublicConnector
} from '../../shared/ipc.js'
import { roleLabelOf } from '../../shared/ipc.js'
import { routineDraft, routineStepPhrase } from './routines.js'
import { combineQueued, queuedIn, queuedVerdict, requeuedRows, retriedAfterBusy, takeNext, withoutQueueOf } from './steering.js'
import type { QueuedRow } from './steering.js'
import type { RoutineDraft } from './routines.js'
import { RoutineDialog } from './components/RoutineDialog.js'
import { AutomationsScreen } from './components/AutomationsScreen.js'
import { memoriesOfConversation, turnsOfConversation } from './conversationMemories.js'
import { createFrameBatcher } from './streamFrames.js'
import { heldDigests, mergeHistory } from './historyMerge.js'
import { savableMissionId } from './savableConversations.js'
import { MemoryScreen } from './components/MemoryScreen.js'
import { isMissionRuntime, runtimeDisplayName } from '../../shared/runtimes.js'
import { imageMediaType } from '../../shared/image-files.js'
import { signInCommand } from '../../shared/runtime-install.js'
import { SIGN_IN_OPENED_EVENT } from './signInEvents.js'
import { DEFAULT_RELAY_HOP_CAP, DEFAULT_MEMORY_MODE } from '../../shared/ipc.js'
import { stripTaskBlocks } from '../../shared/room-task.js'
import { stripMemoryBlocks } from '../../shared/memory.js'
import { stripDecisionBlocks } from '../../shared/decision.js'
import { stripShareBlocks } from '../../shared/peer-share.js'
import { stripFileBlocks } from '../../shared/handover.js'
import { Composer } from './components/Composer.js'
import { ExchangeStrip } from './components/ExchangeStrip.js'
import { RoomScreen } from './components/RoomScreen.js'
import type { RoomAnswer } from './components/RoomScreen.js'
import { refusalNotice } from './components/RoomScreen.js'
import { exchangeAcross, exchangeOf } from './exchange.js'
import type { ExchangeMission } from './exchange.js'
import { FirstLaunch } from './components/FirstLaunch.js'
import { CommandPalette } from './components/CommandPalette.js'
import type { PaletteAction } from './components/CommandPalette.js'
import { IdleTeammate } from './components/IdleTeammate.js'
import { Inspector } from './components/Inspector.js'
import { FileViewer } from './components/FileViewer.js'
import { MissionsScreen, SettingsScreen, TeammatesScreen, UpdateBanner } from './components/Screens.js'
import { WhatsNewSplash } from './components/WhatsNew.js'
import type { SettingsPageId } from './settingsPages.js'
import type { RouteChoice } from './components/RoutePicker.js'
import { composerRouteFor } from '../../shared/route-at-start.js'
import type { Screen } from './components/Screens.js'
import { Icon } from './components/Icon.js'
import { NewTeammateDialog } from './components/NewTeammateDialog.js'
import { GroupSettingsDialog } from './components/GroupSettingsDialog.js'
import { TeammateBot } from './components/TeammateBot.js'
import { Sidebar } from './components/Sidebar.js'
import type { SidebarMission } from './components/Sidebar.js'
import { ContextMenu } from './components/ContextMenu.js'
import type { ContextMenuItem, ContextMenuState } from './components/ContextMenu.js'
import { Thread } from './components/Thread.js'
import { AgentAvatar, REGISTER_WORD } from './components/ThreadItems.js'
import { TitleBar } from './components/TitleBar.js'
import {
  conversationTurns,
  failureMessage,
  recentlyUsedRoutes,
  resolvedModelNames,
  resumableSessionOf,
  relayedTitle,
  peerRunFor,
  rootMission,
  startedLabel,
  stitchedHandoff,
  runtimeNeverStarted, typedPrompt, buildThread, lastActivityAt, relativePath, fileTurns, shellCommandText, turnText, groupBoundary, groupJoins, groupLeavings, latestSetupNotes } from './missionView.js'
import type { LiveStarter } from './missionView.js'
import { folderName, ranOnLine } from './ranOn.js'
import { reviewBrief } from './reviewBrief.js'
import type { ReviewMaterial } from './reviewBrief.js'
import { conversationCostLine, costLine, latestContext, missionCostTail } from './cost.js'
import { sequenceOfPost } from './roomExchange.js'
import type { LiveTurn, RoomExchange, StartingReply } from './roomExchange.js'
import { isStoppable, stopPress } from './stopPress.js'
import { isLayoutPreference, resolveLayout } from './layout.js'
import { decisionReply } from '../../shared/decision.js'
import { installCommand } from '../../shared/runtime-install.js'
import { splitAttachments } from '../../shared/attachments.js'
// Only `heldFor`: this file has its own `ownerOf` for live runs, which is a
// different question from who owns a recorded mission.
import { heldFor, routineOf } from './conversationList.js'
import { collapseConversations, defaultEffort, defaultRoute, effortAfterRouteChange, effortIsInModelId, modelFamily, listedAsMission, modeRunsOn, modesFor, ownerToSelect, facePresenceFor, keepWhatWasKnown, runtimeOfTeammate, runtimeIsUsable, shortMissionId, teammateStatusView, startRoute, freeStartStillFree, freeStartModel, integrationOf, ACCOUNT_DEFAULT_MODEL} from './status.js'
import { modelDisplayName } from './routeName.js'
import { FeedbackDialog } from './components/FeedbackDialog.js'
import { conversationText } from './feedback.js'
import { withMessageDelta } from '../../shared/messageFragments.js'
import { DONE_HOP_MS, RECEIVED_GLANCE_MS, liveActivityOf } from './faceState.js'
import type { Handoff } from './glances.js'
import type { LiveActivity } from './faceState.js'
import type { TeammateStatusView } from './status.js'

/**
 * The Locust shell.
 *
 * Missions run side by side now, one per teammate. Every run the shell knows
 * about -- live, finished this session, or reopened from the ledger -- lives
 * in one map keyed by its runId, and ONE of them is on screen. Host updates
 * are addressed by runId, so a run keeps receiving them whether or not it is
 * the one being looked at; that is what makes switching threads mid-run safe.
 *
 * Carried over unchanged from the single-run shell: persist-before-emit
 * ordering, queued updates for a run whose start receipt has not arrived
 * yet, and a restored receipt that becomes live again on any update.
 */

type LiveRunPhase =
  | 'starting'
  | 'running'
  | 'cancelling'
  | 'completed'
  | 'cancelled'
  | 'failed'
  | 'interrupted'

interface LiveRunState {
  readonly prompt: string
  readonly data?: MissionRouteSummary
  readonly phase: LiveRunPhase
  readonly events: readonly NormalizedRuntimeEvent[]
  readonly error?: string
  readonly errorIsPersistence?: boolean
  /**
   * True when this turn continues the conversation on screen but the runtime
   * had no session to resume -- the previous turn failed before one existed.
   * The exchange is still one thread; the model just starts without it, and
   * the thread says so rather than letting a person assume it remembers.
   */
  readonly coldStart?: boolean
  readonly restored?: boolean
  readonly restoredMission?: PublicRecoveredMission
  /** Who the run was messaged to, known before the host has even assigned a missionId. */
  readonly teammateId?: string
  /**
   * The runtime the message was sent to, known before the host answers. A
   * run that fails before it starts has no route summary, and the header
   * was naming Codex for an Antigravity refusal (Colin's screenshot,
   * 2026-09-05).
   */
  readonly runtime?: MissionRuntimeId
  /**
   * Earlier turns of this conversation, oldest first. Held in renderer state
   * so a reply shows the exchange immediately rather than after a history
   * refresh; recovered missions rebuild the same list from the ledger.
   */
  readonly earlierTurns?: readonly {
    readonly missionId: string
    readonly prompt: string
    readonly events: readonly NormalizedRuntimeEvent[]
    /** That turn's own workroom exchange, so the thread can draw it in place. */
    readonly peerMessages?: readonly PublicPeerMessage[]
  }[]
  /**
   * What this run continues, when it was started by a route switch. Held in
   * renderer state rather than re-read from the ledger because the thread has
   * to show the seam the moment it happens, not after a history refresh.
   */
  readonly handoff?: {
    readonly from: MissionRuntimeId
    readonly to: MissionRuntimeId
    readonly at: string | undefined
    readonly unsettledCount: number
    readonly omittedBriefing: readonly string[]
    readonly priorEvents: readonly NormalizedRuntimeEvent[]
  }
  /**
   * Set when the HOST started this run -- the relay, answering for a teammate.
   * Its prompt is a briefing written to a runtime, so nothing may show it as a
   * mission title while this is set.
   */
  /** Who started it. The room kind is the window's own -- a person's post, filed under a room. */
  readonly startedBy?: LiveStarter
  /** This run was asked to PLAN rather than do, so the offer after it is the build step. */
  readonly plan?: boolean
  /**
   * When the person pressed send, ISO. The thread's waiting line clocks the
   * launch from here -- before the first event there is nothing else to time,
   * and no clock meant no line at all.
   */
  readonly startedAtIso?: string
  /** Workroom messages this run received or posted, as the host reported them. */
  readonly peerMessages?: readonly PublicPeerMessage[]
  /** Shares the host could not honour, in the host's words. */
  readonly peerNotices?: readonly string[]
}

type RuntimeDiscoveryState =
  | { readonly phase: 'loading' }
  | {
      readonly phase: 'ready'
      readonly runtimes: readonly PublicRuntimeStatus[]
      readonly npmPresent?: boolean
      /** The npm that will run is this app's own, because the machine has none. */
      readonly npmIsBundled?: boolean
      readonly npmDidNotAnswer?: boolean
      /**
       * Discovery asked three more times and something installed still never
       * answered. Grok, pass 11: five CLIs on PATH that hang forever left
       * every row CHECKING with the Install buttons gone and no way past it.
       * CHECKING is a moment; after the fourth sweep it is a verdict.
       */
      readonly gaveUp?: boolean
    }
  | { readonly phase: 'error' }

type RunMap = ReadonlyMap<string, LiveRunState>

function liveRunIsActive(run: LiveRunState | undefined): boolean {
  // The same set `stopPress` reads. Kept in one place because the button and
  // the press disagreeing is exactly how a stop came to do nothing.
  return run !== undefined && isStoppable(run.phase)
}

function isTerminal(phase: LiveRunPhase): boolean {
  return phase === 'completed' || phase === 'failed' || phase === 'cancelled'
}

function applyMissionUpdate(run: LiveRunState, update: CodexMissionUpdate): LiveRunState {
  // Any update for this runId proves the host still owns the run: a receipt
  // restored from the ledger stops being "restored" and becomes live again, so
  // the stop control and live status reflect the real process.
  let live: LiveRunState = run
  if (run.restored === true) {
    const { error: _staleError, restoredMission: _staleMission, ...rest } = run
    live = { ...rest, restored: false, phase: 'running' }
  }
  if (update.kind === 'transport-error' || update.kind === 'persistence-error') {
    return {
      ...live,
      phase: 'failed',
      error: update.error.message,
      errorIsPersistence: update.kind === 'persistence-error'
    }
  }
  if (update.kind === 'peer-message') {
    return { ...live, peerMessages: [...(live.peerMessages ?? []), update.message] }
  }
  if (update.kind === 'peer-share-failed' || update.kind === 'relay-notice') {
    return { ...live, peerNotices: [...(live.peerNotices ?? []), update.message] }
  }
  // A host-started run is adopted by the listener, never applied to a run.
  if (update.kind === 'mission-started') return live
  // A hop being started belongs to a teammate, not to any one run.
  if (update.kind === 'relay-starting' || update.kind === 'relay-start-settled') return live
  // A room's board moving is the room's business, not this run's.
  if (update.kind === 'room-changed') return live
  if (update.kind === 'room-posted') return live
  // Memory moving is the Memory screen's business, not this run's.
  if (update.kind === 'memory-changed') return live
  // A scheduled routine that would not start has no run to belong to.
  if (update.kind === 'routine-blocked') return live
  if (update.kind === 'routine-recovery-changed') return live

  /*
   * The cap is on THINGS THAT HAPPENED, and a reply is one of them.
   *
   * This was `[...live.events, update.event].slice(-500)`, and a reply
   * arrives as hundreds of fragments -- so a long answer pushed its own
   * beginning out of the window while it was still being written. Colin
   * watched it, 2026-09-11: "im currently watching it eat text from the
   * beginning", and then the other half of the symptom, which is the proof:
   * "the text seems to go back to normal after they are done". It did,
   * because a finished run is re-read from the record, where the fragments
   * are joined. Now they are joined here too, as they arrive.
   */
  const events = withMessageDelta(live.events, update.event).slice(-500)
  if (update.event.type === 'run.completed') return { ...live, events, phase: 'completed' }
  if (update.event.type === 'run.cancelled') return { ...live, events, phase: 'cancelled' }
  if (update.event.type === 'run.failed') {
    // The payload's own sentence plus whatever the runtime actually said.
    return { ...live, events, phase: 'failed', error: failureMessage(update.event.payload) }
  }
  return { ...live, events, phase: live.phase === 'starting' ? 'running' : live.phase }
}

/**
 * The turns before a host-started reply, so it renders as the next turn of
 * the conversation it continues. Read from the live run when the renderer
 * still holds it, else from history; empty when neither knows the mission,
 * in which case the thread shows this turn alone rather than nothing.
 */
function earlierTurnsOf(
  missionId: string,
  runs: RunMap,
  byId: ReadonlyMap<string, PublicRecoveredMission>
): LiveRunState['earlierTurns'] {
  const live = [...runs.values()].find((run) => run.data?.missionId === missionId)
  if (live !== undefined) {
    return [
      ...(live.earlierTurns ?? []),
      // With what that turn exchanged: the message this reply answers was
      // SENT on it. Rebuilt without it (as this was until 0.18.2) the thread
      // drew the answer and never the question, the same omission the
      // person-typed follow-up path fixed on 2026-09-04. relay-smoke run 5.
      {
        missionId,
        prompt: live.prompt,
        events: live.events,
        ...(live.peerMessages === undefined ? {} : { peerMessages: live.peerMessages }),
        ...(live.startedBy === undefined ? {} : { startedBy: live.startedBy })
      }
    ]
  }
  const held = byId.get(missionId)
  if (held === undefined) return []
  return conversationTurns(held, byId).map((turn) => {
    const record = byId.get(turn.missionId)
    return {
      missionId: turn.missionId,
      prompt: record === undefined ? turn.prompt : typedPrompt(record, byId),
      events: turn.events,
      peerMessages: turn.peerMessages
    }
  })
}

function reopenedRun(
  mission: PublicRecoveredMission,
  byId: ReadonlyMap<string, PublicRecoveredMission>
): LiveRunState {
  const restored = restoredLiveRun(mission)
  const handoff = stitchedHandoff(mission, byId)
  const earlier = conversationTurns(mission, byId).slice(0, -1)
  return {
    ...restored,
    // The words a PERSON typed for this turn: a route switch's own prompt is
    // the host's briefing, a follow-up's is what was just typed.
    prompt: typedPrompt(mission, byId),
    ...(earlier.length === 0
      ? {}
      : {
          earlierTurns: earlier.map((turn) => {
            const held = byId.get(turn.missionId)
            return {
              missionId: turn.missionId,
              prompt: held === undefined ? turn.prompt : typedPrompt(held, byId),
              events: turn.events,
              peerMessages: turn.peerMessages
            }
          })
        }),
    ...(handoff === undefined ? {} : { handoff })
  }
}

function restoredLiveRun(mission: PublicRecoveredMission): LiveRunState {
  const terminalError = mission.events.filter((event) => event.type === 'run.failed').at(-1)
  const error =
    mission.hostFailureMessage ??
    (terminalError?.type === 'run.failed' ? terminalError.payload.message : undefined) ??
    (mission.phase === 'interrupted'
      ? 'This run has no terminal receipt and was recovered as interrupted.'
      : undefined)
  return {
    prompt: mission.prompt,
    data: {
      runId: mission.runId,
      missionId: mission.missionId,
      runtime: mission.runtime,
      model: mission.model,
      resolvedRouteId: mission.resolvedRouteId,
      cliVersion: mission.cliVersion,
      sandbox: mission.sandbox
    },
    phase: mission.phase,
    events: mission.events,
    ...(error === undefined ? {} : { error }),
    restored: true,
    restoredMission: mission,
    peerMessages: mission.peerMessages,
    // A plan is a plan after a restart too. The ledger records what a run was
    // ALLOWED, and `ask` and `plan` are both read-only -- so until the mode
    // was recorded (schema 15) a reopened plan lost its "Build this plan"
    // offer and was told instead that its change was only in the reply, which
    // is the wrong thing to say about a plan (QA, 2026-09-06). A mission
    // recorded before 15 carries no mode and keeps the old behaviour.
    ...(mission.mode === 'plan' ? { plan: true } : {})
  }
}

/** A map with one entry replaced, or unchanged when the key is absent. */
function withRun(runs: RunMap, key: string, next: (run: LiveRunState) => LiveRunState): RunMap {
  const current = runs.get(key)
  if (current === undefined) return runs
  const copy = new Map(runs)
  copy.set(key, next(current))
  return copy
}

function withNewRun(runs: RunMap, key: string, run: LiveRunState): RunMap {
  const copy = new Map(runs)
  copy.set(key, run)
  return copy
}

function withoutRun(runs: RunMap, key: string): RunMap {
  if (!runs.has(key)) return runs
  const copy = new Map(runs)
  copy.delete(key)
  return copy
}

/**
 * The effort a mission should actually be started with. Swarm means this
 * model's maximum, so it is the last effort THIS model reported rather than a
 * fixed name some models do not have.
 */
export function swarmEffortFor(
  models: readonly PublicModel[],
  modelId: string,
  swarm: boolean,
  chosen: string | undefined,
  runtime?: MissionRuntimeId
): string | undefined {
  const family = models.find((model) => model.id === modelId && (runtime === undefined || model.runtime === runtime))
  const supported = family?.supportedEfforts ?? []
  if (swarm) return supported[supported.length - 1]
  // The SAME fallback the chip renders (`effort ?? defaultEffort(...)` in
  // Composer.tsx), so the level on screen and the level the run is given are
  // one expression rather than two that agree by luck.
  //
  // They did not agree. `effort` starts undefined and is only assigned when
  // someone opens the dropdown, so from every launch the chip stated a level
  // -- "medium" -- while this returned undefined and the run was started with
  // no effort argument at all. The comment in status.ts claiming otherwise
  // ("because it is SET rather than merely displayed") was wrong when I wrote
  // it. Found by auditing 0.38.7's own release note, 2026-09-07.
  //
  // And the chip reads a Cursor family's level from its id before any default
  // (`effortOfShownId`): the family stands on one of its own variants, so its
  // id already names a level. Without the same step here the chip said the
  // variant's level and the run was sent `medium`.
  const ownLevel = Object.entries(family?.variants ?? {}).find(([, id]) => id === modelId)?.[0]
  return chosen ?? ownLevel ?? defaultEffort(supported, family?.defaultEffort)
}

function missionTitle(prompt: string): string {
  // The first line of a message sent with a file is the host's own "Read this
  // file in the workspace before you answer:", so every mission started with
  // an attachment was titled that -- identically, in the sidebar, in search,
  // and in the header. The title is what the person typed.
  const { text } = splitAttachments(prompt)
  const trimmed = text.trim().split('\n')[0] ?? text
  /*
   * NOT cut here. The column does the cutting.
   *
   * This used to stop at 44 characters, which CSS then ellipsised again down
   * to whatever the column was -- about 22 in the nested layout. The second
   * cut was invisible and the first one was a ceiling: widening the column
   * could never show more than 44 characters however much room it had, which
   * is why the flat list's extra 47px would have bought nothing on its own.
   *
   * The first line and the attachment split stay, because those are about
   * WHAT the title is rather than how long it may be.
   */
  return trimmed
}

/** Discovery is asked again while a runtime is still CHECKING, and on focus after this gap. */
const RUNTIME_RECHECK_MS = 15_000
const RUNTIME_RECHECK_MIN_GAP_MS = 10_000
/**
 * Whether a sweep could learn anything: an installed runtime that is not
 * ready -- signed out, or not yet answered. A machine where everything
 * installed is ready has nothing a sign-in in another window could change,
 * so the sweep that ran on EVERY focus (6 s here, measured 2026-09-21) and
 * the one that ran unconditionally 15 s after launch are skipped. Check
 * again still sweeps everything.
 */
/**
 * The runtimes a re-ask is for: installed, runnable here, and not ready.
 *
 * NAMED, so the host asks only these and keeps every other answer. A re-ask
 * used to sweep everything whenever anything was unready, which with one
 * signed-out CLI was ~16 processes on every return to the window, all
 * session (main-process audit, 2026-09-22). A runtime Locust only lists
 * (`planned`) is never waited on.
 */
function unreadyRuntimes(runtimes: readonly PublicRuntimeStatus[]): readonly string[] {
  return runtimes
    .filter((entry) => entry.installed && entry.status !== 'ready' && integrationOf(entry.id) !== 'planned')
    .map((entry) => entry.id)
}

function worthAskingAgain(runtimes: readonly PublicRuntimeStatus[]): boolean {
  return unreadyRuntimes(runtimes).length > 0
}



/**
 * How many lines of npm output to keep. Enough that the end of a failing
 * install is all there -- which is where the cause is -- without letting a
 * pathological install grow in memory without end.
 */
const INSTALL_LOG_LINES = 500

export default function App(): ReactElement {
  const [runtimeState, setRuntimeState] = useState<RuntimeDiscoveryState>({ phase: 'loading' })
  const [tube, setTube] = useState<TubePreference>('full')
  /*
   * How big a reply is set. Colin's, not mine.
   *
   * 0.198.0 moved it to 18px off a character count and he saw it on his own
   * monitor: "go back to the old text size, this shit looks insane, or you
   * can have it be changeable in settings". Both, so the default is what he
   * had and the choice is on the screen.
   */
  const [replySize, setReplySize] = useState<ReplyTextSize>('standard')
  /*
   * The send button's metal, and how it behaves. Every option the design
   * agent offered is a setting rather than a constant, because Colin asked to
   * see them all before a default is picked. He picked after seeing them:
   * `silver` at `standard`, which is also what the brief asked for.
   */
  const [metal, setMetal] = useState<MetalPreset>('silver')
  const [metalStrength, setMetalStrength] = useState<MetalStrength>('standard')
  const [metalMotion, setMetalMotion] = useState<MetalMotion>('hover')
  const [metalBend, setMetalBend] = useState(true)
  // Declared HERE, right under its state, not a thousand lines down: a
  // helper above it closed over `runtimes` and was called during render,
  // which is a ReferenceError at boot -- and it fired only on a profile
  // that opens a finished mission from another runtime on launch (room
  // smoke, 2026-09-05), which is exactly a person's profile after an update.
  const runtimes = runtimeState.phase === 'ready' ? runtimeState.runtimes : []
  const [build, setBuild] = useState<{ readonly version: string; readonly packaged: boolean; readonly platform: string }>()
  const [storage, setStorage] = useState<PublicStorageReport>()
  const [update, setUpdate] = useState<AppUpdateState>()
  const [rowMenu, setRowMenu] = useState<ContextMenuState>()
  const [rowMenuArmed, setRowMenuArmed] = useState<string>()

  /**
   * The right-click menu for a mission row. Reaching an action faster is not
   * the same as skipping the question it asks, so Delete still confirms in
   * place, and a running mission cannot be deleted at all -- the host would
   * refuse it anyway, and saying so here beats an error card afterwards.
   */
  /**
   * The routine this conversation would make, if any. Read through the refs
   * because the row menu is built before the memoised history exists, and a
   * menu item that promises an action the app cannot perform is worse than
   * one that says why it is unavailable.
   */
  const routineDraftFor = (missionId: string): RoutineDraft | undefined => {
    const mission = historyByIdRef.current.get(missionId)
    if (mission === undefined) return undefined
    return routineDraft(mission, historyByIdRef.current)
  }
  /**
   * Who owns a conversation: the owner recorded on this turn, or on the
   * nearest earlier turn that has one. A conversation started with nobody
   * picked and assigned afterwards carries its owner on the turn that was
   * assigned; a follow-up typed after that is still theirs. Grok's pass 14:
   * the menu on such a follow-up said "Nothing here was typed by you" to the
   * person who had just typed it.
   */
  const conversationOwnerOf = (missionId: string): string | undefined => {
    let current: string | undefined = missionId
    for (let hop = 0; current !== undefined && hop < 64; hop += 1) {
      const owner: string | undefined = missionOwnersRef.current[current]
      if (owner !== undefined) return owner
      current = historyByIdRef.current.get(current)?.continuesFrom?.missionId
    }
    return undefined
  }

  /**
   * Right-click on a teammate. Removing one is destructive in a way a mission
   * is not -- their routines go with them -- so it asks in place like every
   * other destructive item here, and says what else it takes.
   */
  const openTeammateMenu = (teammateId: string, at: { readonly x: number; readonly y: number }): void => {
    const teammate = teammatesRef.current.find((entry) => entry.teammateId === teammateId)
    if (teammate === undefined) return
    const theirRoutines = routinesRef.current.filter((routine) => routine.teammateId === teammateId).length
    setRowMenuArmed(undefined)
    setRowMenu({
      x: at.x,
      y: at.y,
      title: teammate.name,
      items: [
        { label: 'Message them', shortcut: 'm', onSelect: () => selectTeammate(teammateId) },
        { label: 'Edit', shortcut: 'e', onSelect: () => setEditingTeammate(teammate) },
        {
          label: 'Remove teammate',
          dividerAbove: true,
          confirmLabel:
            theirRoutines === 0
              ? 'Remove for good?'
              : `Remove, with ${String(theirRoutines)} routine${theirRoutines === 1 ? '' : 's'}?`,
          danger: true,
          onSelect: () => removeTeammate(teammateId)
        }
      ]
    })
  }

  const assignMissionTo = (missionId: string, teammateId: string): void => {
    const bridge = window.desktop
    if (bridge === undefined) return
    void bridge
      .assignMission(teammateId, missionId)
      .then((response) => {
        if (!response.ok) {
          setDeleteError(response.error.message)
          return
        }
        setDeleteError(undefined)
        setRowNotice(`Moved to ${teammatesRef.current.find((mate) => mate.teammateId === teammateId)?.name ?? 'that teammate'}.`)
        setMissionOwners((current) => ({ ...current, [missionId]: teammateId }))
        // The run on screen, if it is this one, is now theirs too.
        setRuns((current) => {
          let next = current
          for (const [key, run] of current) {
            if (run.data?.missionId === missionId && run.teammateId !== teammateId) {
              next = withRun(next, key, (entry) => ({ ...entry, teammateId }))
            }
          }
          return next
        })
      })
      .catch(() => setDeleteError('That mission could not be assigned. It still belongs to whoever had it.'))
  }

  /** Which conversation is being renamed in place, if any. */
  const [renamingMissionId, setRenamingMissionId] = useState<string>()
  /** The Send feedback box, and the conversation it was opened from. */
  const [feedbackFor, setFeedbackFor] = useState<{ readonly conversation: string }>()

  /**
   * Name a conversation, or clear the name with an empty one.
   *
   * Keyed by the conversation -- `rootId` where there is one -- so a reply
   * cannot carry a different name from the exchange it belongs to.
   */
  const renameMission = async (missionId: string, title: string): Promise<void> => {
    const row = sidebarMissionsRef.current.find((entry) => (entry.memberIds ?? [entry.missionId]).includes(missionId))
    const key = row?.rootId ?? row?.missionId ?? missionId
    const trimmed = title.trim()
    // Optimistic, and corrected by the roster read if the host refuses: the
    // input has already closed by the time the answer lands, and a row that
    // snapped back to its old name with no word would read as a lost edit.
    setMissionTitles((current) => {
      if (trimmed.length === 0) {
        const { [key]: _gone, ...rest } = current
        return rest
      }
      return { ...current, [key]: trimmed }
    })
    const answer = await window.desktop?.renameMission(key, trimmed)
    if (answer !== undefined && !answer.ok) {
      const roster = await window.desktop?.listTeammates()
      if (roster?.ok === true) setMissionTitles(roster.data.missionTitles)
    }
  }

  /** Which group is being renamed in place, if any. */
  const [renamingGroupId, setRenamingGroupId] = useState<string>()
  /** Whether the sidebar is asking for a new group's name. */
  const [namingGroup, setNamingGroup] = useState(false)
  /**
   * A conversation waiting for the group about to be made.
   *
   * Set only by `New group…` on a conversation's own menu, where creating a
   * group and not putting that conversation in it would be a menu item that
   * did half of what it said.
   */
  const [newGroupFor, setNewGroupFor] = useState<string>()

  const openGroupMenu = (groupId: string, at: { readonly x: number; readonly y: number }): void => {
    const group = groupsRef.current.find((entry) => entry.groupId === groupId)
    if (group === undefined) return
    setRowMenuArmed(undefined)
    setRowMenu({
      x: at.x,
      y: at.y,
      title: group.name,
      items: [
        /*
         * A menu holds actions; a dialog holds what a thing carries. The
         * group's two properties -- instructions and default route -- used to
         * be menu rows, and the route row did four jobs in one 560px strip
         * (there is a default / here it is / replace it / with this). Design
         * agent, 2026-09-16: 556px -> 208px, widest item 94px of ink.
         */
        { label: 'Group settings…', shortcut: 's', onSelect: () => setInstructingGroupId(groupId) },
        { label: 'Rename', shortcut: 'r', onSelect: () => setRenamingGroupId(groupId) },
        {
          label: 'Remove group',
          confirmLabel: 'Remove for good?',
          danger: true,
          dividerAbove: true,
          // Worth saying on the control itself: removing a container must
          // never read as removing its contents.
          onSelect: () => {
            void window.desktop?.removeGroup(groupId).then(refreshGroups)
          }
        }
      ]
    })
  }

  const openMissionMenu = (missionId: string, at: { readonly x: number; readonly y: number }): void => {
    const live = [...runsRef.current.values()].some(
      (run) => liveRunIsActive(run) && run.data?.missionId === missionId
    )
    // A run that is still STARTING has no mission id -- the host has not
    // answered with one -- so the sidebar lists it under its PENDING KEY
    // instead, deliberately, "so the teammate reads as working from the first
    // moment". Right-clicking that row and pressing Delete therefore sent a
    // key like `pending:3` to the host, which answered, correctly and
    // uselessly, "That mission does not exist" -- in a strip at the bottom of
    // the screen, far from the menu that was clicked. It read as the menu
    // doing nothing at all: Colin's third report of delete not working
    // (2026-09-06), reproduced by `_tools/drive-mission-menu.mjs` pressing it
    // and watching the row stay put.
    //
    // There is nothing to delete or hand over yet, so neither is offered, and
    // the row says which of the two it is rather than failing afterwards.
    const stillStarting = missionId.startsWith('pending:')
    const notYet = stillStarting
      ? 'This conversation is still starting. It can be changed once its first receipt lands.'
      : undefined
    const title = sidebarMissionsRef.current.find((row) => row.missionId === missionId)?.title ?? 'Mission'
    setRowMenuArmed(undefined)
    setRowMenu({
      x: at.x,
      y: at.y,
      title,
      /*
       * Four kinds of action, a hairline between each, the way Claude's own
       * menu reads (Colin, 2026-09-22, with the two side by side): open or
       * rename it; move it or hand it over, each a list behind `›`; keep a
       * copy of it; delete it. A letter at the end of a row is a real key
       * while the menu is open.
       */
      items: [
        { label: 'Open', shortcut: 'o', onSelect: () => openMission(missionId) },
        {
          label: 'Rename',
          shortcut: 'r',
          onSelect: () => setRenamingMissionId(missionId)
        },
        /*
         * ONE row that opens the list, not one row per group.
         *
         * This was a flat `Move to <name>` per group plus `Take out of
         * group`, which is the shape the menu already used for `Assign to
         * <teammate>`. It does not survive many groups: five of them buried
         * Open, Rename and Delete under five near-identical lines.
         *
         * Colin's reference, 2026-09-15, is Claude's own: one **Move to
         * group** row opening a list with a tick on the one it is already
         * in, `Ungrouped` to take it out, and `New group...` at the bottom.
         * The tick matters as much as the moving -- it makes the list answer
         * "where is this?" as well as offering to change it.
         */
        /*
         * Shown even with NO groups yet, because `New group...` lives inside
         * it -- which is the case where a person most needs it. Suppressing
         * the row until a group existed meant the only way to make a first
         * one was the `+` beside the logo, which is the Rooms
         * discoverability problem with a different noun.
         */
        ...[
              {
                label: 'Move to group',
                dividerAbove: true,
                submenu: [
                  ...groupsRef.current.map((group) => ({
                    label: group.name,
                    checked: groupOfConversation(missionId)?.groupId === group.groupId,
                    onSelect: () => {
                      void window.desktop
                        ?.assignGroup(conversationKeyOf(missionId), group.groupId)
                        .then((moved) => {
                          refreshGroups()
                          // Only the conversation on screen: seeding a route
                          // for one you are not looking at would change the
                          // composer under you.
                          const shown = liveRun?.data?.missionId ?? liveRun?.restoredMission?.missionId
                          if (moved?.ok === true && shown !== undefined && conversationKeyOf(shown) === conversationKeyOf(missionId)) {
                            seedRouteFromGroup(group)
                          }
                        })
                    }
                  })),
                  {
                    label: 'Ungrouped',
                    checked: groupMembersRef.current[conversationKeyOf(missionId)] === undefined,
                    onSelect: () => {
                      void window.desktop?.assignGroup(conversationKeyOf(missionId), undefined).then(refreshGroups)
                    }
                  },
                  {
                    /*
                     * Makes the group AND puts this conversation in it,
                     * which is the only reading of choosing it from here.
                     * The name is asked for in the sidebar, where a new
                     * group is named anyway -- one naming affordance, not
                     * two that drift.
                     */
                    label: 'New group…',
                    onSelect: () => {
                      setNewGroupFor(conversationKeyOf(missionId))
                      setNamingGroup(true)
                    }
                  }
                ]
              }
            ],
        /*
         * Hand a conversation to a teammate after the fact: ONE row opening
         * the roster, the shape `Move to group` already has.
         *
         * It was one `Assign to <name>` row per teammate, up to six, which
         * is what made this menu tall enough to run off the bottom of the
         * window (Colin, 2026-09-22: "right click folding under window").
         * As a list it holds the whole roster at any size, and the tick on
         * whoever has it now answers "whose is this?" too.
         */
        ...(teammatesRef.current.length === 0
          ? []
          : [
              {
                label: 'Assign to',
                ...(notYet !== undefined
                  ? { disabledReason: notYet }
                  : live
                    ? { disabledReason: 'Wait for the run to finish before handing it over.' }
                    : {}),
                submenu: teammatesRef.current.map((teammate) => {
                  const owns = missionOwnersRef.current[missionId] === teammate.teammateId
                  return {
                    label: teammate.name,
                    checked: owns,
                    // Choosing whoever already has it changes nothing.
                    onSelect: () => {
                      if (!owns) assignMissionTo(missionId, teammate.teammateId)
                    }
                  }
                })
              }
            ]),
        {
          /*
           * "Save CONVERSATION as routine", because that is what it does.
           *
           * Sol's beta review of 0.225.0: opening this from one conversation
           * built a routine with TWO steps, the second being a stress task
           * that had been cancelled. The dialog was honest about it -- it
           * said "STEPS 2 OF 12", labelled the behaviour "replayed step by
           * step", and offered Remove on each -- so nothing was saved by
           * accident. But the ACTION had promised one mission and delivered
           * the thread, which is a promise the dialog then has to talk the
           * person out of.
           *
           * One word fixes the promise. Marking a cancelled step inside the
           * editor is the other half and is still open.
           */
          label: 'Save conversation as routine',
          shortcut: 's',
          dividerAbove: true,
          // Only where there is something to replay: a conversation whose
          // turns were all written by the host has no words of the person's
          // in it, and one still running has not finished the work yet.
          ...(notYet !== undefined
            ? { disabledReason: notYet }
            : live
            ? { disabledReason: 'This mission is still running. It can be saved when it finishes.' }
            : routineDraftFor(missionId) === undefined
              ? { disabledReason: 'Nothing here was typed by you, so there are no steps to replay.' }
              : {}),
          onSelect: () => openSaveRoutine(missionId)
        },
        {
          label: 'Copy mission id',
          shortcut: 'c',
          onSelect: () => {
            void navigator.clipboard.writeText(missionId).catch(() => undefined)
          }
        },
        {
          label: 'Delete',
          shortcut: 'd',
          dividerAbove: true,
          confirmLabel: 'Delete for good?',
          danger: true,
          ...(notYet !== undefined
            ? { disabledReason: notYet }
            : live
              ? { disabledReason: 'This mission is still running. Stop it first.' }
              : {}),
          // Every turn the row stands for. A sidebar row is a CONVERSATION --
          // `collapseConversations` folds its turns into one line titled by
          // the first -- so deleting the id under the cursor removed only the
          // last turn and left the row on screen, which reads as the menu
          // doing nothing at all (Colin, 2026-09-05).
          onSelect: () => {
            const row = sidebarMissionsRef.current.find((entry) => entry.missionId === missionId)
            for (const turn of row?.memberIds ?? [missionId]) deleteMissionById(turn)
          }
        }
      ]
    })
  }

  const checkUpdate = async (): Promise<AppUpdateResponse> => {
    const bridge = window.desktop
    if (!bridge) return { ok: false, error: { code: 'INTERNAL_ERROR', message: 'The host is not available.' } }
    const response = await bridge.checkForUpdate()
    if (response.ok) setUpdate(response.data)
    return response
  }

  const installUpdate = async (): Promise<AppUpdateResponse> => {
    const bridge = window.desktop
    if (!bridge) return { ok: false, error: { code: 'INTERNAL_ERROR', message: 'The host is not available.' } }
    return bridge.installUpdate()
  }

  /** Ask the host what a prune would do. Nothing is deleted by this. */
  const previewPrune = async (days: number): Promise<MissionPruneResponse> => {
    const bridge = window.desktop
    if (!bridge) {
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: 'The host is not available.' } }
    }
    return bridge.pruneMissions({ olderThanDays: days, dryRun: true })
  }

  const prune = async (days: number): Promise<MissionPruneResponse> => {
    const bridge = window.desktop
    if (!bridge) {
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: 'The host is not available.' } }
    }
    const response = await bridge.pruneMissions({ olderThanDays: days, dryRun: false })
    if (response.ok) {
      // A deleted mission has to leave the SCREEN as well as the disk. One
      // left open kept showing a durable receipt for a record that no longer
      // existed, and a reply to it was answered with "the earlier mission did
      // not record a session" -- which is not what happened, and the person's
      // message was never sent at all.
      const gone = new Set(response.data.deleted)
      setRuns((current) => {
        const next = new Map(current)
        for (const [key, run] of current) {
          if (run.data !== undefined && gone.has(run.data.missionId)) next.delete(key)
        }
        return next
      })
      setShownKey((current) => {
        if (current === undefined) return current
        const shown = runsRef.current.get(current)
        return shown?.data !== undefined && gone.has(shown.data.missionId) ? undefined : current
      })
      // The history and the roster changed with it. Re-read them from the
      // host rather than adjusting counts here, where they could drift.
      const [next, listed, roster] = await Promise.all([
        bridge.readStorageReport(),
        bridge.getMissionHistory(heldDigests(historyRef.current)),
        bridge.listTeammates()
      ])
      if (next.ok) setStorage(next.data)
      applyHistory(listed)
      seedLimitsFrom(listed)
      noteStore('teammates', roster.ok)
      if (roster.ok) setMissionOwners(roster.data.missionOwners)
      if (roster.ok) setMissionTitles(roster.data.missionTitles)
    }
    return response
  }
  /** Every run the shell knows about, keyed by runId (or a pending key until the receipt arrives). */
  const [runs, setRuns] = useState<RunMap>(() => new Map())
  /** Which run's thread is on screen; undefined shows the addressed teammate's idle state. */
  const [shownKey, setShownKey] = useState<string>()
  const [history, setHistory] = useState<readonly PublicRecoveredMission[]>([])
  /** What each CLI last said about its own setup, for its row in Settings (not the conversations). */
  const setupNotes = useMemo(() => latestSetupNotes(history), [history])
  /** The history as last committed, for a read to say what it already holds (historyMerge.ts). */
  const historyRef = useRef<readonly PublicRecoveredMission[]>([])
  useEffect(() => {
    historyRef.current = history
  }, [history])
  /** Ledger files that raised an issue and yielded no mission. See the history read. */
  const [unreadableLedgers, setUnreadableLedgers] = useState(0)
  /** The ledger could not be read AT ALL -- not the same as having no missions. */
  const [ledgerUnreadable, setLedgerUnreadable] = useState(false)

  /**
   * Apply a history response to ALL of what it decides, in one place.
   *
   * Three separate reads call this: the initial load, `refreshHistory`, and
   * the re-read after a storage prune. Each of them used to call `setHistory`
   * on its own, and only the first was taught about the two damage states -- so
   * pruning the damaged mission, or any later refresh, left a warning on
   * screen that its own data no longer supported, and a ledger that BECAME
   * unreadable after launch would never have said so.
   *
   * Raised by Astra as a source-only concern, 2026-09-09: "App's other history
   * reads update missions but not these two new damage states." Not
   * live-reproduced, and it does not need to be -- three call sites deciding
   * two related things independently is the shape of the bug, not evidence of
   * one.
   */
  const applyHistory = (response: MissionHistoryResponse): void => {
    if (!response.ok) {
      // A failed read is not an empty ledger. `history` is deliberately left
      // as it was: replacing known missions with [] on a transient read
      // failure would erase the record from the screen.
      setLedgerUnreadable(true)
      return
    }
    setLedgerUnreadable(false)
    // What the host kept back is what this window already holds: the same
    // objects, so nothing built from them is built again.
    setHistory((current) => mergeHistory(current, response.data.missions))
    setUnreadableLedgers(response.data.unreadableCount)
  }
  const [teammates, setTeammates] = useState<readonly PublicTeammate[]>([])
  const [missionOwners, setMissionOwners] = useState<Readonly<Record<string, string>>>({})
  const [missionTitles, setMissionTitles] = useState<Readonly<Record<string, string>>>({})
  const [groups, setGroups] = useState<readonly PublicGroup[]>([])
  const [groupMembers, setGroupMembers] = useState<Readonly<Record<string, GroupMembership>>>({})
  const [groupLeft, setGroupLeft] = useState<Readonly<Record<string, readonly LeftMembership[]>>>({})
  const [changelog, setChangelog] = useState<AppChangelog | undefined>(undefined)
  /**
   * Local files that exist and refused to read, by store name. Held apart
   * from "empty" so the sidebar can say so -- an unreadable roster used to
   * look exactly like a fresh install.
   */
  const [unreadableStores, setUnreadableStores] = useState<readonly string[]>([])
  /**
   * A group's default route becomes the composer's pending selection when a
   * conversation joins it -- the ruling's "seeding it on join rewrites
   * nothing": a route is recorded per mission, so this is the selection for
   * the NEXT turn and nothing about any turn already run.
   */
  const seedRouteFromGroup = (group: PublicGroup): void => {
    if (group.route === undefined) return
    const next = { runtime: group.route.runtime, model: group.route.model }
    /*
     * The same three writes the composer's own route picker makes, or the
     * seed does not show. MEASURED 2026-09-16 driving 0.161.0 before release:
     * `setRoute` alone left the composer reading "Codex / Account Default"
     * after the join, because what the composer draws is
     * `composerRouteFor(route, pickedTeammate, pickerRoutes)` -- the picked
     * teammate's own entry wins over the bare route state. A seed that only
     * wrote the bare state was overruled on the next render.
     */
    routeChosen.current = true
    setRoute(next)
    if (pickedTeammate !== undefined) {
      setPickerRoutes((current) => new Map(current).set(pickedTeammate.teammateId, next))
    }
    setMode(group.route.mode)
    // Named, not spread: `undefined` clears an effort the group's runtime has no levels for.
    setEffort(group.route.effort)
  }
  const noteStore = (name: string, ok: boolean): void => {
    setUnreadableStores((held) => (ok ? held.filter((entry) => entry !== name) : held.includes(name) ? held : [...held, name]))
  }
  const refreshGroups = (): void => {
    void window.desktop
      ?.listGroups()
      .then((response) => {
        noteStore('groups', response.ok)
        if (!response.ok) return
        setGroups(response.data.groups)
        setGroupMembers(response.data.members)
        setGroupLeft(response.data.left)
      })
      .catch(() => undefined)
  }
  /**
   * Replies the host has decided on and is still starting, by teammate.
   *
   * The seconds between deciding on a hop and the runtime existing used to be
   * silent: `mission-started` needs a run id, so a cold start left every row
   * idle and a room mid-argument looked finished. One entry per teammate,
   * because a teammate runs one mission at a time.
   */
  const [relayStarting, setRelayStarting] = useState<Readonly<Record<string, StartingReply>>>({})
  const [newTeammateOpen, setNewTeammateOpen] = useState(false)
  /** The group whose settings -- instructions and default route -- are open, if any. */
  const [instructingGroupId, setInstructingGroupId] = useState<string>()
  const [routines, setRoutines] = useState<readonly PublicRoutine[]>([])
  /** Rooms: a named set of teammates a person writes to at once (vision #2). */
  const [rooms, setRooms] = useState<readonly PublicRoom[]>([])
  const [currentRoomId, setCurrentRoomId] = useState<string>()
  const [roomNotice, setRoomNotice] = useState<string>()
  /** What the team remembers, as the host last listed it. */
  const [memories, setMemories] = useState<readonly PublicMemory[]>([])
  const [memoryWorkspace, setMemoryWorkspace] = useState<{ readonly id: string; readonly name: string }>({ id: '', name: '' })
  const [memoryMode, setMemoryMode] = useState<MemoryMode>(DEFAULT_MEMORY_MODE)
  /**
   * Which shell layout to draw, and how wide the window is.
   *
   * The width is tracked because `auto` -- the default -- answers with it, and
   * a resize has to redraw. `resolveLayout` is the only place the two are
   * combined; see `layout.ts` for why this is not a media query any more.
   */
  const [layout, setLayout] = useState<LayoutPreference>('auto')
  const [windowWidth, setWindowWidth] = useState<number>(() =>
    typeof window === 'undefined' ? 1440 : window.innerWidth
  )
  useEffect(() => {
    const onResize = (): void => setWindowWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const layoutMode = resolveLayout(layout, windowWidth)
  /** The boot screen's own setting, persisted the way the layout one is. */
  const chooseTube = (next: TubePreference): void => {
    const before = tube
    setTube(next)
    void window.desktop
      ?.writeWorkspaceSettings({ swarm, relay, relayHopCap, interrupt, memoryMode, autoMode, askConnectors, keepATodoList, replySize, layout, tube: next })
      .then((settings) => setTube(settings.tube))
      .catch(() => setTube(before))
  }
  /**
   * One writer for all four, because they are one decision in four parts and
   * writing them separately would mean four round trips to change a look.
   */
  const chooseMetal = (next: {
    readonly metal?: MetalPreset
    readonly metalStrength?: MetalStrength
    readonly metalMotion?: MetalMotion
    readonly metalBend?: boolean
  }): void => {
    const before = { metal, metalStrength, metalMotion, metalBend }
    const wanted = { ...before, ...next }
    setMetal(wanted.metal)
    setMetalStrength(wanted.metalStrength)
    setMetalMotion(wanted.metalMotion)
    setMetalBend(wanted.metalBend)
    void window.desktop
      ?.writeWorkspaceSettings({ swarm, relay, relayHopCap, interrupt, memoryMode, autoMode, askConnectors, keepATodoList, replySize, layout, tube, ...wanted })
      .then((settings) => {
        setMetal(settings.metal ?? wanted.metal)
        setMetalStrength(settings.metalStrength ?? wanted.metalStrength)
        setMetalMotion(settings.metalMotion ?? wanted.metalMotion)
        setMetalBend(settings.metalBend ?? wanted.metalBend)
      })
      // Put it back rather than leave the screen claiming a setting the disk
      // never took -- the same rule every other writer here follows.
      .catch(() => {
        setMetal(before.metal)
        setMetalStrength(before.metalStrength)
        setMetalMotion(before.metalMotion)
        setMetalBend(before.metalBend)
      })
  }
  const chooseReplySize = (next: ReplyTextSize): void => {
    const before = replySize
    setReplySize(next)
    void window.desktop
      ?.writeWorkspaceSettings({ swarm, relay, relayHopCap, interrupt, memoryMode, autoMode, askConnectors, keepATodoList, replySize: next, layout, tube })
      .then((settings) => setReplySize(settings.replySize))
      .catch(() => setReplySize(before))
  }
  /*
   * APPLIED ON THE ROOT, because the size it changes is a token and tokens
   * live on :root. One attribute, read by two rules in tokens.css -- the
   * same shape the shell class for the inspector uses, and nothing here
   * computes a pixel value: the stylesheet owns what each choice means.
   */
  useEffect(() => {
    document.documentElement.dataset.replysize = replySize
  }, [replySize])
  const chooseLayout = (next: LayoutPreference): void => {
    const before = layout
    setLayout(next)
    void window.desktop
      ?.writeWorkspaceSettings({ swarm, relay, relayHopCap, interrupt, memoryMode, autoMode, askConnectors, keepATodoList, replySize, layout: next, tube })
      .then((settings) => setLayout(isLayoutPreference(settings.layout) ? settings.layout : 'auto'))
      .catch(() => setLayout(before))
  }
  const [memoryNotice, setMemoryNotice] = useState<string>()
  /**
   * The last scheduled routine that would not start, and why. Kept until it
   * is read: a routine that stops happening on a schedule is exactly the
   * thing a person is not watching for.
   */
  const [automationNotice, setAutomationNotice] = useState<string>()
  /** Each runtime's own MCP servers and hooks, read once at boot and again when Settings opens. */
  const [runtimeSetup, setRuntimeSetup] = useState<Readonly<Record<string, PublicRuntimeSetup>>>()
  const [workspaceBrief, setWorkspaceBrief] = useState<PublicWorkspaceBrief | null>()
  const [worktrees, setWorktrees] = useState<{ readonly list: readonly PublicWorktree[]; readonly reason: string | undefined }>()
  /**
   * What a person typed while a mission was running, waiting to go as the
   * next turn. Kept against the RUN it was typed at, not the teammate, so it
   * can never be sent into some other conversation: if that run is no longer
   * the one on screen, it waits and says so rather than guessing.
   */
  /*
   * Everything typed while a teammate is working, in order.
   *
   * One slot until 2026-09-13, so a second thought REPLACED the first -- the
   * person watched their own words disappear. It is a list now, and the
   * leading run of plain follow-ups is folded into one turn when it goes, so
   * three thoughts reach the teammate as one instruction it can answer
   * knowing all three, rather than as three turns it answers blind. Gates and
   * reasoning in `steering.ts`; grok-build does the same thing and Colin
   * asked for it by name.
   */
  const [queued, setQueued] = useState<readonly QueuedRow[]>([])
  /** The save/edit dialog, open on a draft taken from a conversation or on a routine already saved. */
  const [routineDialog, setRoutineDialog] = useState<{
    /** Undefined for a conversation nobody owns: the dialog asks who will run it. */
    readonly teammateId: string | undefined
    readonly routineId?: string
    readonly name: string
    readonly steps: readonly string[]
    readonly learnedFrom: readonly string[]
    readonly truncated: boolean
    readonly route?: TeammateRoute
    readonly schedule?: RoutineSchedule
    readonly busy: boolean
    readonly error?: string
  }>()
  /** The teammate being edited in the same dialog, when it is open for editing. */
  const [editingTeammate, setEditingTeammate] = useState<PublicTeammate>()
  /** Why a folder request for one teammate did nothing. */
  const [folderNotice, setFolderNotice] = useState<string>()
  const [inspectorOpen, setInspectorOpen] = useState(false)
  /*
   * The file open beside the conversation, if any.
   *
   * It shares the inspector's REGION and not its state: somebody reading a
   * report does not want the mission inspector's tabs underneath it, and the
   * inspector's own toggle should not close their file. The slot below draws
   * whichever is open, with the file winning -- it was opened by a press on a
   * specific thing, which is a more specific intent than a toggle.
   */
  const [viewingFile, setViewingFile] = useState<{
    readonly path: string
    /** The file's text, or a `data:` URL when the mode is `image`. */
    readonly text: string
    readonly mode: 'markdown' | 'code' | 'image'
  }>()
  /** What the host said when a file could not be opened. Shown where the press was. */
  const [viewerRefusal, setViewerRefusal] = useState<string>()
  const openFileInViewer = (path: string): void => {
    const bridge = window.desktop
    setViewerRefusal(undefined)
    if (bridge === undefined || workspacePath === undefined) return
    /*
     * Two callers, two shapes of path.
     *
     * A handed file is relative by construction -- `handover.ts` drops any
     * absolute path a model writes. An activity row's file is absolute,
     * because that is what the runtime reported acting on, and it is not
     * always inside the workspace. Joining the workspace onto an already
     * absolute path produces `C:/ws/C:/elsewhere/notes.md`, which the host
     * then refuses for the wrong reason: the panel would say the file is
     * outside the folder about a file that is simply named twice.
     */
    const absolute = /^([a-z]:)?[\\/]/i.test(path)
    // Resolve ONCE and keep the resolved path. The head's reveal and save
    // buttons used to join the workspace on again, so whichever caller had
    // already passed a whole path got it joined twice at the moment it was
    // pressed -- a panel showing the right file with two controls pointing at
    // a path that does not exist.
    const full = absolute ? path : `${workspacePath}/${path}`
    /*
     * A PICTURE IS SHOWN AS A PICTURE.
     *
     * A teammate that makes a chart, a diagram or a screenshot produces a
     * PNG, and until now pressing it got "Locust does not open that kind of
     * file here" -- a refusal, about a file the teammate had just made for
     * you. `isViewableText` is an allowlist of text, correctly, and an image
     * is simply not text.
     *
     * This is the half of "artifact support" that costs nothing to give
     * (`docs/DECISION-2026-09-20-LOCUST-NEVER-RUNS-MODEL-CODE.md`): drawing a
     * raster image executes nothing. The plumbing is the attachments'
     * already, including the part that matters -- **SVG is deliberately not
     * painted**, because an SVG is a document that can carry script. It stays
     * text, and opens as code, which is the honest way to show one.
     */
    if (imageMediaType(full) !== undefined) {
      void bridge
        .readWorkspaceImage(relativePath(full, workspacePath))
        .then((answer) => {
          if (answer.ok) {
            setViewingFile({ path: full, text: answer.dataUrl, mode: 'image' })
            return
          }
          setViewingFile(undefined)
          setViewerRefusal(answer.message)
        })
        .catch(() => setViewerRefusal('Locust could not read that image. Nothing was changed.'))
      return
    }
    void bridge
      .readTextFile(full)
      .then((answer) => {
        if (answer.ok) {
          setViewingFile({ path: full, text: answer.text, mode: answer.mode })
          return
        }
        setViewingFile(undefined)
        setViewerRefusal(answer.message)
      })
      .catch(() => setViewerRefusal('Locust could not read that file. Nothing was changed.'))
  }
  const [screen, setScreen] = useState<Screen>('workroom')
  const [paletteOpen, setPaletteOpen] = useState(false)
  // Accept edits, not Ask. A person who opens a workroom and says "add a
  // discount function" means it; under Ask the sandbox refuses the write and
  // the model pastes its patch into the reply instead, with nothing on screen
  // saying the MODE is why. That was the first run of the app, measured
  // 2026-09-03. Ask stays one click away and a teammate who has run keeps
  // whatever they last ran on.
  const [mode, setMode] = useState<MissionMode>('accept-edits')
  // Runtimes whose last run ended on the account's usage limit, with the
  // runtime's own words, until a run on them completes. Session-only on
  // purpose: the limit is on the provider's clock, and a note that outlived
  // it would be the false claim in the other direction.
  const [limitedRuntimes, setLimitedRuntimes] = useState<ReadonlyMap<string, string>>(new Map())
  /** The latest still-allowed rate-limit reading per runtime, by words. */
  const [usageWindows, setUsageWindows] = useState<ReadonlyMap<string, string>>(new Map())
  const [route, setRoute] = useState<RouteChoice>({ runtime: 'codex', model: 'account-default' })
  // Intent belongs to the addressed teammate, not to discovery or the last
  // thread visited. Session-only state deliberately clears on app restart.
  const [pickerRoutes, setPickerRoutes] = useState<ReadonlyMap<string, RouteChoice>>(new Map())
  /**
   * Whether the route on screen is the person's own choice.
   *
   * Until they pick one it is a guess, and a guess that names a runtime this
   * machine does not have is the wall the whole first run hits: install
   * exactly what the app told you to, come back, type, press Enter, nothing
   * (QA, 2026-09-06). So an unchosen route follows discovery. A CHOSEN one
   * never moves on its own -- picking Codex deliberately and watching the app
   * change it back would be worse than the original defect.
   */
  const routeChosen = useRef(false)
  /**
   * Installing a runtime from inside the app.
   *
   * One at a time -- the host refuses a second, and the panel disables every
   * other button while one runs -- so a single output line belongs to a
   * single install and nobody loses track of whose error is whose.
   */
  const [installing, setInstalling] = useState<string>()
  const [installLine, setInstallLine] = useState<string>()
  /** Every line npm printed for the install now running, newest last. */
  const [installLog, setInstallLog] = useState<readonly string[]>([])
  const [installFailure, setInstallFailure] = useState<{
    readonly what: string
    readonly next: string
    readonly restart?: boolean
    readonly command?: string
  }>()
  const installStartedAt = useRef(0)
  /**
   * Ask discovery again, from outside the effect that owns it.
   *
   * Main drops its cache and re-probes the moment an install exits cleanly --
   * that is how "npm said fine but there is nothing to run" is detected. The
   * RENDERER was never told, so a successful install left the row saying
   * "Install", the sidebar saying "0 runtimes connected", and the composer
   * still pointed at a runtime that was not there. Pressing the button for
   * the first time is what showed it: `opencode.cmd` on disk, and the app
   * insisting nothing had happened (drive, 2026-09-06).
   */
  const askDiscoveryAgain = useRef<(everything?: boolean) => void>(() => undefined)
  /*
   * Keeping the coding agents current (main/runtime-updates.ts): what it has
   * done, for Settings -- and when an agent has just been updated, the
   * machine is asked again and the models re-read, so what the new version
   * brings (GPT-6-Sol and -Luna, the day this was written) is in the picker
   * without a restart.
   */
  const [runtimeUpdates, setRuntimeUpdates] = useState<RuntimeUpdatesState>()
  useEffect(() => {
    const bridge = window.desktop
    if (bridge === undefined) return undefined
    void bridge.readRuntimeUpdates().then(setRuntimeUpdates).catch(() => undefined)
    const heard = new Set<string>()
    return bridge.onRuntimeUpdates((state) => {
      setRuntimeUpdates(state)
      const landed = state.agents.flatMap((agent) =>
        agent.status.kind === 'updated' ? [`${agent.runtime}@${agent.status.to}`] : []
      )
      if (landed.some((key) => !heard.has(key))) {
        for (const key of landed) heard.add(key)
        askDiscoveryAgain.current(true)
        readModels()
      }
    })
    // Once: the listener reads the state it is handed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  /** Check again starts the count of sweeps over; see the discovery effect. */
  const resetDiscoveryBudget = useRef<() => void>(() => undefined)
  const [installElapsed, setInstallElapsed] = useState(0)

  useEffect(() => {
    const bridge = window.desktop
    if (!bridge) return
    return bridge.onRuntimeInstallProgress(({ line }) => {
      setInstallLine(line)
      // Everything npm said, not just the last thing. The design asks for a
      // disclosure that opens onto the whole transcript, and a person who
      // cannot read an npm trace can still hand the whole thing to someone
      // who can. Bounded so a pathological install cannot grow without end.
      setInstallLog((held) => [...held, line].slice(-INSTALL_LOG_LINES))
    })
  }, [])

  // The elapsed count, which is the honest substitute for a progress bar: npm
  // reports nothing that can become a percentage, so the screen shows the one
  // number it actually has.
  useEffect(() => {
    if (installing === undefined) return
    const tick = window.setInterval(() => {
      setInstallElapsed(Math.max(1, Math.round((Date.now() - installStartedAt.current) / 1000)))
    }, 1000)
    return () => window.clearInterval(tick)
  }, [installing])

  const installRuntime = (runtime: string): void => {
    const bridge = window.desktop
    if (!bridge || installing !== undefined) return
    setInstallFailure(undefined)
    setInstallLine(undefined)
    setInstalling(runtime)
    installStartedAt.current = Date.now()
    setInstallElapsed(0)
    void bridge
      .installRuntime(runtime)
      .then((response) => {
        setInstalling(undefined)
        if (response.ok) {
          // Nothing announces success -- the row simply becomes the ready
          // state. But it has to be ASKED: main re-probes on its side, and
          // without this the renderer waits for a timer or a focus event
          // while the screen says nothing was installed.
          setInstallLine(undefined)
          setInstallLog([])
          askDiscoveryAgain.current()
          return
        }
        setInstallFailure({
          what: response.what,
          next: response.next,
          ...(response.restart === true ? { restart: true } : {}),
          // The failure's own command wins when it has one: a permission
          // failure's remedy is not the command that just failed, and showing
          // that one again is what left a first tester stuck (2026-09-07).
          ...(response.command !== undefined
            ? { command: response.command }
            : installCommand(runtime) === undefined
              ? {}
              : { command: installCommand(runtime)! })
        })
      })
      .catch(() => {
        setInstalling(undefined)
        setInstallFailure({
          what: 'The install could not be started. Nothing was installed or changed.',
          next: 'Run the command shown in Settings from a terminal.'
        })
      })
  }
  // Not only at launch: the focus re-probe is what finds a runtime installed
  // mid-session, and that is exactly when this matters -- the person has just
  // come back from installing it.
  /*
   * FOLLOWS THE START ORDER, not only when the placeholder cannot run (0.307).
   * The route starts as `codex / account-default` -- a placeholder nobody
   * chose -- and this used to replace it only when Codex could NOT run. So
   * on any machine where Codex worked, defaultRoute was never asked: 0.303
   * and the first 0.307 package both started a fresh profile on Codex with
   * Claude Code signed in and ready (drive-start-and-lane), and the old
   * "OpenCode first" had never applied there either. Until the person picks
   * a route, it is whatever defaultRoute says now.
   */
  useEffect(() => {
    if (runtimeState.phase !== 'ready' || routeChosen.current) return
    const next = defaultRoute(runtimes)
    if (next.runtime === route.runtime) return
    setRoute(next)
  }, [runtimeState.phase, runtimes, route.runtime])
  // Keyed on WHICH runtimes are usable, not on the array identity: discovery
  // re-runs every few seconds and hands back a new array each time, and
  // re-reading the catalogue on every sweep would be a request per tick.
  const usableKey = runtimes.filter((runtime) => runtimeIsUsable(runtime)).map((runtime) => runtime.id).join(',')

  useEffect(() => {
    if (runtimeState.phase !== 'ready') return
    readModels()
    // Same trigger as the catalogue: both are gated on which runtimes are
    // actually installed, so both are meaningless until discovery settles and
    // both want re-reading when that set changes.
    window.desktop
      ?.listRuntimeArtifacts()
      .then((found) => setCliArtifacts(found))
      .catch(() => setCliArtifacts([]))
  }, [runtimeState.phase, usableKey])
  const [approvals, setApprovals] = useState<readonly MissionApprovalRequest[]>([])
  const [decidingIds, setDecidingIds] = useState<readonly string[]>([])
  const [models, setModels] = useState<readonly PublicModel[]>([])
  /*
   * An unchosen route lands on a NAMED FREE model once the catalogue says
   * there is one. Sol's beta finding 1, the only one of the nine that can
   * spend money: after installing the runtime we recommend BECAUSE it needs
   * no account, the composer read `OpenCode / Account Default` -- an unnamed
   * route behind the first Enter a new person presses.
   *
   * Gated on `routeChosen` exactly like the runtime half above it: a route
   * the person picked never moves on its own, and pinning Account Default
   * deliberately has to stay possible. This only ever fires on a profile that
   * has not picked yet, which is the profile the finding is about.
   */
  useEffect(() => {
    if (runtimeState.phase !== 'ready' || routeChosen.current) return
    if (route.model !== ACCOUNT_DEFAULT_MODEL) return
    const free = freeStartModel(route.runtime, models)
    if (free === undefined) return
    setRoute((current) =>
      current.model === ACCOUNT_DEFAULT_MODEL ? { ...current, model: free } : current
    )
  }, [runtimeState.phase, route.runtime, route.model, models])
  // What the CLIs already have set up. Read once discovery has settled: the
  // list is gated on which runtimes are installed, so asking earlier would
  // report an empty machine.
  const [cliArtifacts, setCliArtifacts] = useState<readonly PublicRuntimeArtifact[]>([])
  /**
   * Re-read the model catalogue when the runtimes change, and when the picker
   * is opened.
   *
   * It used to be read ONCE, at mount, and never again. The catalogue is
   * built from discovery -- `claudeModelsFrom` returns nothing at all unless
   * Claude's readiness is already `ready` -- and readiness is a probe that
   * finishes whenever it finishes. So if that single read landed before the
   * probe did, the picker offered Claude one row, `account-default`, for the
   * rest of the session, and only a relaunch fixed it. Colin, 2026-09-06:
   * "the claude models aren't showing up anymore, it just says claude account
   * default." Intermittent by timing, which is why it reads as "anymore".
   *
   * The same shape hid OpenCode's models from anyone who installed it
   * mid-session (QA, 2026-09-06): eleven models on the machine, one row in
   * the picker.
   *
   * Main already re-sweeps discovery every ten seconds and serves the
   * catalogue from that sweep, so this asks a question that is cheap and
   * already answered.
   */
  const readModels = (): void => {
    const bridge = window.desktop
    if (!bridge) return
    void bridge
      .listModels()
      .then((response) => {
        if (response.ok) setModels(response.data.models)
      })
      .catch(() => {
        // Optional, as it always was: without it the picker offers the
        // account default, which is what a run is launched with anyway.
      })
  }
  /**
   * Ask again while a usable runtime still has no models.
   *
   * Discovery calls a runtime READY as soon as it is installed and signed in,
   * which happens well before its `--list-models` probe answers. So the first
   * catalogue read can legitimately come back with nothing for it -- and
   * `usableKey` above never changes afterwards, because the runtime was
   * already usable, so nothing ever asks again. The picker then offers only
   * `account-default` for that runtime until the app is restarted.
   *
   * Colin, 2026-09-08: "cursor agent is only showing account default now on my
   * end" ... "nvm it fixed it on reset". The same shape was diagnosed for
   * Claude Code's aliases in the 0.36.5 QA pass and never fixed, because the
   * fix looked like re-reading on a timer and nobody wanted a poll.
   *
   * This is a poll, but a self-limiting one: it stops the moment every usable
   * runtime has at least one model, and it gives up after a handful of tries
   * so a runtime that will never report a catalogue (Antigravity has none)
   * cannot keep it running.
   */
  const awaitingModels = runtimes.some(
    (runtime) =>
      runtimeIsUsable(runtime) &&
      isMissionRuntime(runtime.id) &&
      !models.some((model) => model.runtime === runtime.id)
  )
  const modelRetries = useRef(0)
  useEffect(() => {
    if (runtimeState.phase !== 'ready') return
    if (!awaitingModels || modelRetries.current >= 6) return
    const again = window.setTimeout(() => {
      modelRetries.current += 1
      readModels()
    }, 3_000)
    return () => window.clearTimeout(again)
  }, [awaitingModels, runtimeState.phase, models])
  const [effort, setEffort] = useState<string>()
  const [swarm, setSwarm] = useState(false)
  /*
   * How many times the person has turned swarm on this session. The title
   * screen flies the swarm across for each new one (HomeCover's SwarmRun) --
   * a count, not the setting, because the setting also turns on by itself
   * at launch, read back from disk, and that is not a moment.
   */
  const [swarmCalls, setSwarmCalls] = useState(0)
  // Off until the workspace says otherwise, and re-read from the host rather
  // than remembered: this is the switch that decides whether a mode which can
  // write anywhere on the machine is offered at all.
  const [autoMode, setAutoMode] = useState(false)
  /** Ask before every connector call. See WorkspaceSettings.askConnectors. */
  const [askConnectors, setAskConnectors] = useState(false)
  /** Ask teammates that can to keep a todo list. See WorkspaceSettings.keepATodoList. */
  const [keepATodoList, setKeepATodoList] = useState(false)

  // Switching Auto off takes it away from a window that was sitting on it,
  // rather than leaving a choice the host would refuse at the next send.
  /*
   * Only once the answer is KNOWN. Before the settings have been read,
   * `autoMode` is its initial false, and a conversation reopened at
   * startup on Auto was being knocked down to Accept edits in the gap --
   * the other half of "the next time it will be accept edits".
   */
  const [autoModeKnown, setAutoModeKnown] = useState(false)
  useEffect(() => {
    if (autoModeKnown && !autoMode && mode === 'auto') setMode('accept-edits')
  }, [autoModeKnown, autoMode, mode])
  const [relay, setRelay] = useState(true)
  /** The autonomy budget: automatic replies one exchange may use. */
  const [relayHopCap, setRelayHopCap] = useState(DEFAULT_RELAY_HOP_CAP)
  /** Whether a teammate may stop another's run to be heard now. Off until asked for. */
  const [interrupt, setInterrupt] = useState(false)
  const [stoppingExchange, setStoppingExchange] = useState(false)
  // Which folder this window works in. Every mission runs here; a person
  // with two projects open needs the title to say which is which.
  const [workspaceName, setWorkspaceName] = useState('Local workspace')
  /** The folder itself, so activity rows can show paths the way a person writes them. */
  const [workspacePath, setWorkspacePath] = useState<string | undefined>(undefined)
  // Only the ledger-failure card reads this: it offers to open the folder.
  const [ledgerPath, setLedgerPath] = useState<string | undefined>(undefined)
  const [workspaceMade, setWorkspaceMade] = useState(false)
  // A word about the folder, at shell level: a refused start, a refused
  // choice, or the reopen that follows a successful one.
  const [workspaceNotice, setWorkspaceNotice] = useState<string>()
  /** The folder id the host reports with history, so the sidebar can keep to it. */
  const [workspaceId, setWorkspaceId] = useState<string | undefined>(undefined)
  // Faces that just finished or just heard something: a hop and a glance, each
  // for a moment, then still. Keyed by teammate; cleared by their own timers.
  const [recentlyDone, setRecentlyDone] = useState<readonly string[]>([])
  const [recentlyReceived, setRecentlyReceived] = useState<readonly string[]>([])
  // And a message just handed from one to another: the two look at each
  // other where both faces are in one line (glances.ts), for the same moment.
  const [handoffs, setHandoffs] = useState<readonly Handoff[]>([])
  const missionOwnersRef = useRef<Readonly<Record<string, string>>>({})
  const groupsRef = useRef<readonly PublicGroup[]>([])
  const groupMembersRef = useRef<Readonly<Record<string, GroupMembership>>>({})
  /**
   * The id a group membership is keyed by: the conversation, not the turn.
   *
   * The same key `renameMission` uses. A sidebar row stands for an exchange,
   * and filing one reply of it somewhere else would be a group that lies
   * about what it holds.
   */
  /** What group this conversation is in, under any id it has worn. */
  const groupOfConversation = (missionId: string): GroupMembership | undefined => {
    const row = sidebarMissionsRef.current.find((entry) =>
      (entry.memberIds ?? [entry.missionId]).includes(missionId)
    )
    return row === undefined ? groupMembersRef.current[missionId] : heldFor(row, groupMembersRef.current)
  }

  const conversationKeyOf = (missionId: string): string => {
    const row = sidebarMissionsRef.current.find((entry) =>
      (entry.memberIds ?? [entry.missionId]).includes(missionId)
    )
    return row?.rootId ?? row?.missionId ?? missionId
  }
  // Read inside the update listener, which is bound once.
  const historyByIdRef = useRef<ReadonlyMap<string, PublicRecoveredMission>>(new Map())
  const [teammateError, setTeammateError] = useState<string>()
  const [handingOff, setHandingOff] = useState(false)
  /**
   * Who the composer is talking to. A mission is started by messaging a
   * teammate, so this decides who the next mission belongs to, whose waiting
   * workroom messages it is shown, and under whose name it may share.
   */
  const [selectedTeammateId, setSelectedTeammateId] = useState<string>()
  /**
   * Stops pressed before the run had a name, by the key it had at the time.
   *
   * A run is `starting` from the moment the person presses send until the
   * host answers with its run id, and the box draws the stop button for the
   * whole of it -- correctly, because the runtime is already going. But there
   * was nothing to cancel BY: `cancelMission` reads the run id off the shown
   * run, found none, and returned without a word.
   *
   * MEASURED 2026-09-10, on the second turn of a conversation: `shownKey`
   * was still `pending:2` six seconds after send, so the press did nothing at
   * all and the mission ran to completion -- 200 of 200 numbers, on both
   * Claude Code and Codex, which is how it was told apart from the transport
   * change that day. A first turn resolves fast enough to hide it.
   *
   * A ref rather than state: it is read inside the async start that is
   * already in flight, where a re-render would not reach it.
   */
  const cancelWhenNamedRef = useRef(new Set<string>())
  const pendingUpdatesRef = useRef(new Map<string, CodexMissionUpdate[]>())
  const pendingKeyCounter = useRef(0)

  const liveRun = shownKey === undefined ? undefined : runs.get(shownKey)
  /**
   * The shown run as of the LAST render, for handlers that run after an
   * await. A handoff is decided inside an async callback, and reading state
   * from that callback's closure can hand it the value from whichever render
   * created the callback -- often the render before the mission had a runId.
   */
  const liveRunRef = useRef<LiveRunState | undefined>(undefined)
  liveRunRef.current = liveRun
  const runsRef = useRef<ReadonlyMap<string, LiveRunState>>(runs)
  runsRef.current = runs

  /**
   * Re-read what the local history costs.
   *
   * Deleting a mission changes it, and so does running one -- but this was
   * called only on a delete, so Settings kept its launch reading: two
   * missions in, and with both listed in the sidebar and two files on disk,
   * it still said `0 missions · 0 B` (QA pass, 2026-09-05). Stale display,
   * not lost data, and the cheapest honest fix is to read it again whenever
   * the screen that shows it is opened.
   */
  const refreshWorktrees = (): void => {
    void window.desktop
      ?.listWorktrees()
      .then((response) => {
        if (response.ok) setWorktrees({ list: response.data.worktrees, reason: response.data.reason })
      })
      .catch(() => undefined)
  }
  const removeWorktree = async (teammateId: string): Promise<string | undefined> => {
    const bridge = window.desktop
    if (bridge === undefined) return 'Worktrees are not available here.'
    try {
      const response = await bridge.removeWorktree(teammateId)
      if (!response.ok) return response.error.message
      setWorktrees({ list: response.data.worktrees, reason: response.data.reason })
      return undefined
    } catch {
      return 'That worktree could not be removed. It is still on disk with its files intact.'
    }
  }

  const refreshRuntimeSetup = (): void => {
    void window.desktop
      ?.readRuntimeSetup()
      .then((response) => {
        if (!response.ok) return
        setRuntimeSetup(response.data.runtimes)
        setWorkspaceBrief(response.data.workspaceBrief)
      })
      .catch(() => undefined)
  }

  const refreshStorage = (): void => {
    const bridge = window.desktop
    if (!bridge) return
    void bridge
      .readStorageReport()
      .then((response) => {
        if (response.ok) setStorage(response.data)
      })
      .catch(() => undefined)
  }

  /**
   * What the ledger knows about the accounts, before any live event arrives:
   * a runtime that was at its limit when the window closed is still at its
   * limit when it opens (0.21.2 QA, P2 -- a reload turned AT LIMIT back into
   * READY with no successful run in between). Every read of history seeds
   * from it, the boot read included; the first version of this seeded only
   * the refresh path and the live check caught it.
   */
  const seedLimitsFrom = (response: Awaited<ReturnType<NonNullable<typeof window.desktop>['getMissionHistory']>>): void => {
    if (!response.ok) return
    const windows = Object.entries(response.data.usageWindows ?? {})
    if (windows.length > 0) setUsageWindows((current) => { const next = new Map(current); for (const [runtime, said] of windows) if (!next.has(runtime)) next.set(runtime, said); return next })
    const remembered = Object.entries(response.data.limitedRuntimes)
    if (remembered.length === 0) return
    setLimitedRuntimes((current) => {
      const next = new Map(current)
      for (const [runtime, said] of remembered) if (!next.has(runtime)) next.set(runtime, said)
      return next
    })
  }

  const refreshHistory = (): void => {
    const bridge = window.desktop
    if (!bridge) return
    void bridge
      .getMissionHistory(heldDigests(historyRef.current))
      .then((response) => {
        seedLimitsFrom(response)
        applyHistory(response)
      })
      .catch(() => undefined)
  }

  /**
   * One commit for every update held in a frame, in the order they came.
   * See streamFrames.ts, and the note where updates are pushed into it.
   */
  const frameBatcher = useRef(
    createFrameBatcher<Extract<CodexMissionUpdate, { readonly runId: string }>>((updates) => {
      setRuns((current) => {
        let next = current
        for (const update of updates) {
          if (next.has(update.runId)) {
            next = withRun(next, update.runId, (run) => applyMissionUpdate(run, update))
            continue
          }
          // A run whose start receipt has not come back yet: hold its updates
          // until the receipt names its runId, then replay them in order.
          const queued = pendingUpdatesRef.current.get(update.runId) ?? []
          pendingUpdatesRef.current.set(update.runId, [...queued, update].slice(-500))
        }
        return next
      })
    })
  )

  useEffect(() => {
    let active = true
    const bridge = window.desktop
    if (!bridge) {
      setRuntimeState({ phase: 'error' })
      return () => {
        active = false
      }
    }

    const removeApprovalListener = bridge.onMissionApproval((request) => {
      // Append rather than replace: the runtime can have more than one action
      // waiting, and dropping an earlier one would strand its turn.
      setApprovals((current) =>
        current.some((entry) => entry.approvalId === request.approvalId) ? current : [...current, request]
      )
    })
    // A question answered somewhere else -- in Antigravity's own window --
    // or whose run ended leaves the card with nothing to ask.
    const removeWithdrawnListener = bridge.onMissionApprovalWithdrawn((approvalId) => {
      setApprovals((current) => current.filter((entry) => entry.approvalId !== approvalId))
    })

    const removeMissionListener = bridge.onCodexMissionUpdate((update) => {
      // A finished mission hops once; a message that just arrived earns a
      // glance. Both are moments, so both clear themselves.
      if (update.kind === 'event') {
        const runtime = update.event.sourceAdapter
        if (update.event.type === 'adapter.diagnostic' && /\.usage_window$/.test(update.event.payload.code)) {
          const said = update.event.payload.message
          setUsageWindows((current) => (current.get(runtime) === said ? current : new Map(current).set(runtime, said)))
        }
        if (update.event.type === 'route.limit_detected' && update.event.payload.kind === 'quota-exhausted') {
          const said = update.event.payload.message
          setLimitedRuntimes((current) => (current.get(runtime) === said ? current : new Map(current).set(runtime, said)))
        }
        if (update.event.type === 'run.completed') {
          setLimitedRuntimes((current) => {
            if (!current.has(runtime)) return current
            const next = new Map(current)
            next.delete(runtime)
            return next
          })
        }
      }
      if (update.kind === 'event' && update.event.type === 'run.completed') {
        const owner = missionOwnersRef.current[update.missionId]
        if (owner !== undefined) {
          setRecentlyDone((current) => [...current.filter((id) => id !== owner), owner])
          setTimeout(() => setRecentlyDone((current) => current.filter((id) => id !== owner)), DONE_HOP_MS)
        }
      }
      if (update.kind === 'peer-message' && update.message.direction === 'posted') {
        const to = update.message.to.teammateId
        setRecentlyReceived((current) => [...current.filter((id) => id !== to), to])
        setTimeout(() => setRecentlyReceived((current) => current.filter((id) => id !== to)), RECEIVED_GLANCE_MS)
        const handoff: Handoff = { key: update.message.messageId, from: update.message.from.teammateId, to }
        setHandoffs((current) => [...current.filter((held) => held.key !== handoff.key), handoff])
        setTimeout(() => setHandoffs((current) => current.filter((held) => held.key !== handoff.key)), RECEIVED_GLANCE_MS)
      }
      if (update.kind === 'room-posted') {
        refreshRooms()
        return
      }
      if (update.kind === 'room-changed') {
        /*
         * A teammate's reply moved a board. Re-read the rooms so the screen
         * shows the board as the host now holds it -- and say NOTHING extra.
         *
         * This used to narrate the move under the composer: "Jimothy took on
         * X. Jimothy finished X. Jimothy handed X to Yurt." -- directly below
         * a board already showing X as IN HAND beside Jimothy's face. One
         * fact in two registers, which is the thing this app refuses
         * everywhere else. Colin, 2026-09-11: "that texxt under the chat box
         * needs to go away."
         *
         * The notice itself is kept for what a person cannot read off the
         * board: a REFUSAL. Those are set where they happen.
         */
        refreshRooms()
        return
      }
      if (update.kind === 'memory-changed') {
        refreshMemories()
        const said: string[] = []
        if (update.kept.length > 0) said.push(`${update.by} remembered ${update.kept.map((text) => `"${text}"`).join('; ')}`)
        if (update.proposed.length > 0) said.push(`${update.by} wants to remember ${update.proposed.map((text) => `"${text}"`).join('; ')}`)
        if (update.forgotten.length > 0) said.push(`${update.by} forgot ${update.forgotten.map((text) => `"${text}"`).join('; ')}`)
        // A memory that CHANGED, named as a change. It replaced something the
        // person may already have read, which is worth more than a new one.
        if ((update.rewritten ?? []).length > 0) {
          said.push(`${update.by} updated ${(update.rewritten ?? []).map((text) => `"${text}"`).join('; ')}`)
        }
        // All three lists empty says nothing happened worth reporting, and
        // `[].join('. ')` is '' -- which passes `!== undefined` downstream and
        // drew an empty paragraph that then also could not be dismissed.
        setMemoryNotice(said.length === 0 ? undefined : said.join('. '))
        return
      }
      if (update.kind === 'routine-blocked') {
        // A scheduled routine that would not start. It has no run, so it is
        // its own branch rather than a run's update, and it is kept until a
        // person reads it -- nobody is watching a schedule fire.
        setAutomationNotice(
          `${update.name} did not start: ${update.message} Trying again at ${new Date(update.retryAt).toLocaleTimeString()}.`
        )
        return
      }
      if (update.kind === 'routine-recovery-changed') {
        void reloadRoutines()
        return
      }
      if (update.kind === 'relay-starting') {
        setRelayStarting((current) => ({
          ...current,
          [update.teammateId]: { teammateId: update.teammateId, answering: update.answering }
        }))
        return
      }
      if (update.kind === 'relay-start-settled') {
        setRelayStarting((current) => {
          if (current[update.teammateId] === undefined) return current
          const next = { ...current }
          delete next[update.teammateId]
          return next
        })
        return
      }
      if (update.kind === 'mission-started') {
        // A teammate replying on their own. The host started it; the renderer
        // adopts it exactly as it adopts a run it asked for, so the sidebar
        // shows them working from this moment rather than after a refresh.
        setMissionOwners((current) => ({ ...current, [update.missionId]: update.teammateId }))
        // The hub moved, or began. Mirrored so the face opens it from this
        // moment rather than after the roster is next re-read.
        if (update.hubMissionId !== undefined) {
          const hub = update.hubMissionId
          setTeammates((current) =>
            current.map((teammate) => (teammate.teammateId === update.teammateId ? { ...teammate, hubMissionId: hub } : teammate))
          )
          // And the row's NAME. The host names a hub the first time it is
          // made, but the titles here were read at launch -- so the row wore
          // its root prompt ("Wren asked: ...") until the next full refresh.
          // Measured by `_smoke/hub-smoke.mjs` on 0.234.0 before this line.
          void window.desktop?.listTeammates().then((listed) => {
            if (listed.ok) setMissionTitles(listed.data.missionTitles)
          }).catch(() => undefined)
        }
        // A routine that started on its own: the Team card's run count and
        // next run moved on disk, and nobody pressed anything to refresh them.
        if (update.startedBy?.kind === 'routine') void reloadRoutines()
        /*
         * A room start, so re-read the rooms NOW.
         *
         * The host writes the post before it asks anyone and announces each
         * run as it begins -- but the room on screen is drawn from the rooms
         * in renderer state, and those only arrived with the post's own
         * response, which lands after every member has been tried. So the
         * host could be three runs in and the room still showed nothing.
         *
         * This is the other half of the fix for the 45 seconds Astra
         * measured between a process existing and its row appearing.
         */
        if (update.startedBy?.kind === 'room') refreshRooms()
        const queued = pendingUpdatesRef.current.get(update.runId) ?? []
        pendingUpdatesRef.current.delete(update.runId)
        setRuns((current) => {
          if (current.has(update.runId)) return current
          let next: LiveRunState = {
            prompt: update.prompt,
            data: update.data,
            phase: 'running',
            events: [],
            teammateId: update.teammateId,
            peerMessages: update.data.peerMessages,
            startedBy: update.startedBy,
            ...(update.data.followsUp === undefined
              ? {}
              : {
                  earlierTurns: earlierTurnsOf(update.data.followsUp.missionId, current, historyByIdRef.current)
                })
          }
          for (const held of queued) next = applyMissionUpdate(next, held)
          return withNewRun(current, update.runId, next)
        })
        // The answer lands in the thread that asked: if that thread is the
        // one on screen, follow it to its new turn, as a person's own reply
        // would be followed. Another conversation on screen is left alone.
        const shown = liveRunRef.current
        if (update.data.followsUp !== undefined && shown?.data?.missionId === update.data.followsUp.missionId) {
          setShownKey(update.runId)
        }
        return
      }
      /*
       * Deltas land once per FRAME, not once per token.
       *
       * Each update is its own IPC message and so its own task, and React
       * batches within a task, not across them -- so every `message.delta`
       * was a full re-render of the thread, and a burst of twenty read as
       * twenty jolts. Colin, 2026-09-10: "the text seems to come out rather
       * aggressively or glitchy." Claude Code's own renderer coalesces; this
       * is that. Only deltas are held; anything else flushes at once with
       * whatever was ahead of it, so order never changes and a run finishing
       * is never a frame late. See streamFrames.ts.
       */
      // Only an update that belongs to a run goes to a run. The kinds without
      // a runId were all handled and returned above; this is the same fact
      // said where the type checker can see it.
      if (!('runId' in update)) return
      const isDelta = update.kind === 'event' && update.event.type === 'message.delta'
      frameBatcher.current.push(update, !isDelta)
    })

    const stopUpdates = bridge.onUpdateState((state) => {
      if (active) setUpdate(state)
    })

    void bridge
      .readStorageReport()
      .then((response) => {
        if (active && response.ok) setStorage(response.data)
      })
      .catch(() => undefined)

    void bridge
      .getAppInfo()
      .then((info) => {
        if (active) {
          setBuild({ version: info.version, packaged: info.packaged, platform: info.platform })
          setWorkspaceName(info.workspaceName)
          setWorkspacePath(info.workspacePath.length === 0 ? undefined : info.workspacePath)
          setWorkspaceMade(info.workspaceMade === true)
          setLedgerPath(info.ledgerPath.length === 0 ? undefined : info.ledgerPath)
        }
      })
      .catch(() => undefined)

    // When the host last actually swept. The host answers from a ten-second
    // cache, and two asks inside it are one sweep, not two.
    let lastCheckedAt: string | undefined
    // True until the first answer says otherwise: an answer that never comes
    // is exactly the case to ask again about.
    let unanswered = true
    // The latest answer, so a re-ask can name the runtimes it is for.
    let known: readonly PublicRuntimeStatus[] = []
    // A Sign in window was opened: the next return to this window asks at
    // once, whatever the gap, because that is when the answer changes.
    let signInOpened = false
    const onSignInOpened = (): void => {
      signInOpened = true
    }
    window.addEventListener(SIGN_IN_OPENED_EVENT, onSignInOpened)
    void bridge
      .getLocalRuntimes()
      .then((response) => {
        if (!active) return
        if (response.ok) {
          lastCheckedAt = response.data.checkedAt
          known = response.data.runtimes
          unanswered = worthAskingAgain(response.data.runtimes)
        }
        setRuntimeState(
          response.ok
            ? {
                phase: 'ready',
                runtimes: response.data.runtimes,
                npmPresent: response.data.npmPresent,
                npmIsBundled: response.data.npmIsBundled,
                npmDidNotAnswer: response.data.npmDidNotAnswer
              }
            : { phase: 'error' }
        )
      })
      .catch(() => {
        if (active) setRuntimeState({ phase: 'error' })
      })
    // Discovery ran once at launch and never again, so a runtime slow on
    // its first probe stayed UNAVAILABLE for the whole session (Colin,
    // 2026-09-05). Ask again while any runtime is still CHECKING -- three
    // times, fifteen seconds apart, past the host's ten-second cache -- and
    // once more whenever the window comes back into focus, so a sign-in
    // done elsewhere shows without a relaunch.
    /*
     * SWEEPS are counted, not answers. This counted answers, and two of the
     * first four came from the host's ten-second cache -- the first focus
     * event and the first re-check timer both asked inside it -- so the rows
     * said NOT ANSWERING after the SECOND real sweep while the tooltip
     * promised four, and the third sweep ran under a screen that had
     * already given up (Fable, pass 1, finding 6, with the shims' own log).
     * A cached answer carries the same `checkedAt` as the sweep it came
     * from; it reschedules and counts nothing. After the fourth sweep with
     * something still unanswered, no more are asked until Check again,
     * which starts the count over -- a hung CLI was being probed for ten of
     * every twenty-six seconds, for ever.
     */
    const SWEEPS_BEFORE_GIVING_UP = 4
    let sweeps = 1
    let gaveUp = false
    let lastAsked = Date.now()
    // `everything` drops the host's caches too, npm included. Only Check
    // again passes it: the automatic sweeps stay as cheap as they were.
    const askAgain = (everything = false): void => {
      if (!active || gaveUp) return
      lastAsked = Date.now()
      const waitingOn = unreadyRuntimes(known)
      void bridge
        .getLocalRuntimes(everything, everything || waitingOn.length === 0 ? undefined : waitingOn)
        .then((response) => {
          if (!active || gaveUp) return
          /*
           * A REFUSED ANSWER IS NOT THE END OF ASKING.
           *
           * This returned on `!response.ok` without rescheduling, so a host
           * that answered `discoveryFailed()` once ended EVERY re-check chain
           * for the session -- the screen kept whatever it had and nothing
           * asked again until the window happened to regain focus (Fable,
           * pass 2, finding 5).
           *
           * A discovery that could not run is the case where asking again
           * matters most, and it costs one more timer. Not counted as a
           * sweep, because the give-up budget is about CLIs that will not
           * answer, and this is the host not having answered at all -- a
           * failure the person cannot repair by pressing Check again four
           * times.
           */
          if (!response.ok) {
            setTimeout(askAgain, RUNTIME_RECHECK_MS)
            return
          }
          const fresh = response.data.checkedAt !== lastCheckedAt
          lastCheckedAt = response.data.checkedAt
          known = response.data.runtimes
          // A re-check must not make the screen go backwards: a probe that
          // has not answered yet keeps whatever the last sweep established.
          setRuntimeState((held) => ({
            phase: 'ready',
            runtimes: keepWhatWasKnown(held.phase === 'ready' ? held.runtimes : [], response.data.runtimes),
            npmPresent: response.data.npmPresent,
            npmIsBundled: response.data.npmIsBundled,
            npmDidNotAnswer: response.data.npmDidNotAnswer
          }))
          const stillChecking = response.data.runtimes.some(
            (entry) => entry.installed && (entry.status === 'probe-failed' || entry.status === 'offline')
          )
          unanswered = worthAskingAgain(response.data.runtimes)
          if (!stillChecking) return
          if (!fresh) {
            setTimeout(askAgain, RUNTIME_RECHECK_MS)
            return
          }
          sweeps += 1
          if (sweeps < SWEEPS_BEFORE_GIVING_UP) {
            setTimeout(askAgain, RUNTIME_RECHECK_MS)
          } else {
            // Asked, asked again, and again: the screen has to stop saying
            // "shortly" and offer a way past a CLI that will never answer.
            gaveUp = true
            setRuntimeState((held) => (held.phase === 'ready' ? { ...held, gaveUp: true } : held))
          }
        })
        // The host never answered at all -- the same case as a refusal,
        // and the same answer: ask again rather than stop for the session.
        .catch(() => {
          if (active && !gaveUp) setTimeout(askAgain, RUNTIME_RECHECK_MS)
        })
    }
    resetDiscoveryBudget.current = () => {
      sweeps = 0
      gaveUp = false
    }
    // Both gated on there being something to learn (Fable's probing review,
    // #2: measured, the 15 s re-check re-swept a machine with nothing to
    // learn, and every return to the window did the same).
    const firstRecheck = setTimeout(() => {
      if (unanswered) askAgain()
    }, RUNTIME_RECHECK_MS)
    const onFocus = (): void => {
      if (signInOpened) {
        signInOpened = false
        askAgain()
        return
      }
      if (unanswered && Date.now() - lastAsked >= RUNTIME_RECHECK_MIN_GAP_MS) askAgain()
    }
    // So an install can ask for a fresh answer the moment it finishes.
    askDiscoveryAgain.current = askAgain
    window.addEventListener('focus', onFocus)

    void bridge
      .readWorkspaceSettings()
      .then((settings) => {
        if (active) {
          setSwarm(settings.swarm === true)
          setRelay(settings.relay === true)
          setAutoMode(settings.autoMode === true)
          setAutoModeKnown(true)
          setAskConnectors(settings.askConnectors === true)
          setKeepATodoList(settings.keepATodoList === true)
          setRelayHopCap(settings.relayHopCap)
          setInterrupt(settings.interrupt)
          setMemoryMode(settings.memoryMode)
          setLayout(isLayoutPreference(settings.layout) ? settings.layout : 'auto')
          setTube(settings.tube)
          setReplySize(settings.replySize)
      if (settings.metal !== undefined) setMetal(settings.metal)
      if (settings.metalStrength !== undefined) setMetalStrength(settings.metalStrength)
      if (settings.metalMotion !== undefined) setMetalMotion(settings.metalMotion)
      if (settings.metalBend !== undefined) setMetalBend(settings.metalBend)
        }
      })
      .catch(() => undefined)

    void bridge
      .listModels()
      .then((response) => {
        if (!active || !response.ok) return
        setModels(response.data.models)
      })
      .catch(() => {
        // The catalog is optional: without it the picker offers the account
        // default, which is what the process is launched with anyway.
      })

    // What changed in this build, read from the file that shipped with it.
    void bridge
      .getChangelog()
      .then((answer) => { if (active) setChangelog(answer) })
      .catch(() => undefined)
    void bridge
      .listTeammates()
      .then((response) => {
        if (!active) return
        noteStore('teammates', response.ok)
        if (!response.ok) return
        setTeammates(response.data.teammates)
        /*
         * BOTH maps, every time, and this one is why.
         *
         * `missionTitles` shipped in 0.141.0 read by one refresh path and
         * not by this one -- the roster read that runs at startup. So a name
         * you typed was written to disk correctly and never loaded again:
         * it survived until the window reloaded and then the row went back
         * to the first line of the prompt. Colin, 2026-09-15: "i renamed
         * some of my missions and the name didnt save."
         *
         * It saved. It was never read. The drive that passed had checked
         * `listTeammates()` returned the title and had never restarted the
         * app, which is the only place the difference shows.
         */
        setMissionOwners(response.data.missionOwners)
        setMissionTitles(response.data.missionTitles)
      })
      .catch(() => {
        // The roster is optional at startup; missions still run without it.
      })

    void bridge
      .listGroups()
      .then((response) => {
        if (!active) return
        noteStore('groups', response.ok)
        if (!response.ok) return
        setGroups(response.data.groups)
        setGroupMembers(response.data.members)
        setGroupLeft(response.data.left)
      })
      .catch(() => {
        // Groups are optional at startup; every conversation is simply
        // ungrouped until they are read.
      })

    void bridge
      .listRoutines()
      .then((response) => {
        if (!active) return
        noteStore('routines', response.ok)
        if (!response.ok) return
        setRoutines(response.data.routines)
      })
      .catch(() => {
        // Routines are optional too: without them the app is what it was.
      })

    void bridge
      .listRooms()
      .then((response) => {
        if (!active) return
        noteStore('rooms', response.ok)
        if (!response.ok) return
        setRooms(response.data.rooms)
      })
      .catch(() => {
        // Rooms are optional in the same way.
      })

    void bridge
      .listMemories()
      .then((response) => {
        if (!active) return
        adoptMemories(response)
      })
      .catch(() => {
        // Memory is optional in the same way.
      })

    void bridge
      .readRuntimeSetup()
      .then((response) => {
        if (!active || !response.ok) return
        setRuntimeSetup(response.data.runtimes)
        setWorkspaceBrief(response.data.workspaceBrief)
      })
      .catch(() => {
        // A runtime's own configuration is shown when it can be read, never guessed.
      })

    void bridge
      .listWorktrees()
      .then((response) => {
        if (active && response.ok) setWorktrees({ list: response.data.worktrees, reason: response.data.reason })
      })
      .catch(() => {
        // A runtime's own configuration is shown when it can be read, never guessed.
      })

    void bridge
      .getMissionHistory()
      .then((response) => {
        seedLimitsFrom(response)
        if (!active) return
        // Everything the response decides, in one place -- see `applyHistory`.
        // This handler used to do it inline while the other two reads did not,
        // which is how they came to disagree.
        applyHistory(response)
        if (!response.ok) return
        setWorkspaceId(response.data.currentWorkspaceId)
        // The most recent mission IN THIS FOLDER opens on launch. It used to be
        // the most recent mission anywhere, so opening Locust in a new project
        // greeted you with a conversation from a different one -- measured
        // 2026-09-03. History still lists every mission; what changes is which
        // one this window opens on, and a folder with no missions opens empty.
        const latest = response.data.missions.find(
          (mission) => mission.workspaceId === response.data.currentWorkspaceId
        )
        if (latest === undefined) return
        // Only a run still under way is put on screen at launch. A finished
        // conversation is adopted (so its record is there to open) but the
        // window opens on the home screen -- what is connected, which folder,
        // the teammates to pick from -- which is what Colin asked launch to be
        // (2026-09-05, twice: "it still opens to the teammates screen with all
        // the chats").
        // The record's phase is always a finished one; what says a run is
        // still under way is the host addressing updates to it.
        const stillLive = (pendingUpdatesRef.current.get(latest.runId) ?? []).length > 0
        // Any update addressed to it (a run the host still owns) makes it live.
        setRuns((current) => {
          if (current.size > 0) return current
          const queued = pendingUpdatesRef.current.get(latest.runId) ?? []
          pendingUpdatesRef.current.delete(latest.runId)
          const byId = new Map(response.data.missions.map((mission) => [mission.missionId, mission]))
          return withNewRun(
            current,
            latest.runId,
            queued.reduce(applyMissionUpdate, reopenedRun(latest, byId))
          )
        })
        if (stillLive) setShownKey((current) => current ?? latest.runId)
      })
      .catch(() => {
        // History recovery is optional at startup; discovery remains usable.
      })

    return () => {
      active = false
      clearTimeout(firstRecheck)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener(SIGN_IN_OPENED_EVENT, onSignInOpened)
      removeMissionListener()
      frameBatcher.current.dispose()
      removeApprovalListener()
      removeWithdrawnListener()
      stopUpdates()
    }
  }, [])

  /**
   * Send one reply to a pending request, whichever kind it is.
   *
   * An authorization and an answer travel the same channel and need the same
   * care -- the card only goes when the reply was DELIVERED -- so they share
   * this and differ only in what they carry.
   */
  const replyToApproval = (approvalId: string, reply: Omit<MissionApprovalAnswer, 'approvalId'>): void => {
    const bridge = window.desktop
    if (bridge === undefined) return
    setDecidingIds((current) => [...current, approvalId])
    void bridge
      .decideMissionApproval({ approvalId, ...reply } as MissionApprovalAnswer)
      .then((response) => {
        // The card goes when the answer was DELIVERED. It used to go whatever
        // happened, so a rejected call left the person believing they had
        // denied a command while the runtime was still waiting to be told.
        // This is the one control here where a dropped answer has a real
        // consequence, so a failure keeps the card and stays clickable.
        if (response.ok) {
          setApprovals((current) => current.filter((entry) => entry.approvalId !== approvalId))
        }
        setDecidingIds((current) => current.filter((entry) => entry !== approvalId))
      })
      .catch(() => {
        setDecidingIds((current) => current.filter((entry) => entry !== approvalId))
      })
  }

  const decideApproval = (approvalId: string, decision: MissionApprovalDecision): void =>
    replyToApproval(approvalId, { decision })

  /** A question's answers, keyed by question id. Never a decision -- see the card. */
  const answerQuestion = (approvalId: string, answers: Readonly<Record<string, readonly string[]>>): void =>
    replyToApproval(approvalId, { answers })

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent): void => {
      const accel = event.ctrlKey || event.metaKey
      if (accel && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen((open) => !open)
        return
      }
      if (accel && event.key.toLowerCase() === 'i') {
        event.preventDefault()
        setInspectorOpen((open) => !open)
        return
      }
      if (!accel) return
      if (event.key === '1') { event.preventDefault(); setScreen('missions') }
      if (event.key === '2') { event.preventDefault(); setScreen('teammates') }
      // Ctrl 3 reads the storage number too, or the shortcut would be the
      // one way into Settings that still showed the launch reading.
      if (event.key === '3') { event.preventDefault(); refreshStorage(); refreshRuntimeSetup(); refreshWorktrees(); setScreen('settings') }
      if (event.key === '4') { event.preventDefault(); setScreen('rooms') }
      if (event.key === '5') { event.preventDefault(); setScreen('memory') }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // The first teammate is addressed by default, so a roster of one never
  // needs a click before the first mission; removal falls back the same way.
  const selectedTeammate =
    teammates.find((teammate) => teammate.teammateId === selectedTeammateId) ?? teammates[0]
  /**
   * The teammate the person actually picked, or nobody. `selectedTeammate`
   * falls back to the first teammate so surfaces that need a name have one;
   * a MESSAGE must not inherit that fallback. From the home screen, with no
   * one picked, a message starts a conversation of nobody's -- a plain chat
   * on the route the bar shows -- and "Assign to ..." on its row hands it
   * to a teammate afterwards (Colin, 2026-09-05: no Conversation tab; a
   * mission already is one, a teammate is a saved route with a face).
   */
  const pickedTeammate = selectedTeammateId === undefined ? undefined : selectedTeammate
  const composerRoute = composerRouteFor(route, pickedTeammate, pickerRoutes)

  /** Who a run belongs to: what it was started with, or what the host recorded. */
  const ownerOf = (run: LiveRunState): string | undefined =>
    run.teammateId ?? (run.data === undefined ? undefined : missionOwners[run.data.missionId])

  // Said before the send: a reply on another runtime continues from the
  // stopped run's checkpoint, not from its memory (0.21.2 QA, P2).
  const shownData = liveRun?.data
  const runtimeNameOf = (id: string): string => runtimes.find((entry) => entry.id === id)?.displayName ?? id
  const continuationNote =
    liveRun !== undefined
    && shownData !== undefined
    && !liveRunIsActive(liveRun)
    && shownData.runtime !== composerRoute.runtime
    && ownerOf(liveRun) === pickedTeammate?.teammateId
      ? `Continues on ${runtimeNameOf(composerRoute.runtime)} from ${runtimeNameOf(shownData.runtime)}'s checkpoint -- briefed on what was done, not handed the memory.`
      : undefined

  /**
   * The exchange the shown conversation is part of, read from what the
   * window already holds: every recovered mission plus every live run,
   * linked by the workroom messages they posted and received. Nothing is
   * bookkept twice -- the strip says what the records say.
   */
  /**
   * The turns of this conversation that changed the file now open, oldest
   * first, for the viewer's history strip.
   *
   * Memoised because it walks every turn's events through `buildThread` --
   * cheap for a conversation, wasteful on every frame of a streaming reply,
   * and the viewer is open across exactly those frames.
   */
  const viewingFileTurns = useMemo(() => {
    if (viewingFile === undefined || liveRun === undefined) return []
    const turns = [
      ...(liveRun.earlierTurns ?? []).map((turn) => ({
        missionId: turn.missionId,
        prompt: turn.prompt,
        events: turn.events
      })),
      {
        missionId: liveRun.data?.missionId ?? liveRun.restoredMission?.missionId ?? 'live',
        prompt: liveRun.prompt,
        events: liveRun.events
      }
    ]
    return fileTurns(turns, viewingFile.path, workspacePath)
  }, [viewingFile, liveRun, workspacePath])
  /**
   * Every mission the window knows, live or recorded, in one shape.
   *
   * Lifted out of the exchange memo because a ROOM needs the same thing: a
   * post's conversation is an exchange rooted at the missions that answered
   * it, and walking it needs every mission's peer messages.
   */
  const missionsForExchange = useMemo(() => {
    const byMission = new Map<string, ExchangeMission>()
    for (const mission of history) {
      byMission.set(mission.missionId, {
        missionId: mission.missionId,
        runtime: mission.runtime,
        model: mission.model,
        events: mission.events,
        peerMessages: mission.peerMessages,
        ...(mission.startedBy === undefined ? {} : { startedBy: mission.startedBy }),
        ...(missionOwners[mission.missionId] === undefined ? {} : { teammateId: missionOwners[mission.missionId] }),
        ...(teammates.find((entry) => entry.teammateId === missionOwners[mission.missionId])?.name === undefined
          ? {}
          : { teammateName: teammates.find((entry) => entry.teammateId === missionOwners[mission.missionId])!.name }),
        live: false
      })
    }
    // Live runs overlay the record: fresher events, and which are still going.
    for (const run of runs.values()) {
      if (run.data === undefined) continue
      const owner = ownerOf(run)
      const name = teammates.find((entry) => entry.teammateId === owner)?.name
      // Merge over the record rather than replace it: a run reopened from the
      // ledger carries its events but not always who started it, and the
      // strip's hop count read 0 for a relayed reply until this kept the
      // record's answer (exchange smoke, first run).
      const recorded = byMission.get(run.data.missionId)
      const startedBy = run.startedBy ?? recorded?.startedBy
      byMission.set(run.data.missionId, {
        missionId: run.data.missionId,
        runtime: run.data.runtime,
        model: run.data.model,
        events: run.events.length > 0 ? run.events : recorded?.events ?? [],
        peerMessages: run.peerMessages ?? recorded?.peerMessages ?? [],
        ...(startedBy === undefined ? {} : { startedBy }),
        ...(owner === undefined ? {} : { teammateId: owner }),
        ...(name === undefined ? {} : { teammateName: name }),
        live: liveRunIsActive(run),
        runId: run.data.runId
      })
    }
    return byMission
  }, [history, runs, missionOwners, teammates])

  const exchange = useMemo(
    () => (shownData === undefined ? undefined : exchangeOf(shownData.missionId, [...missionsForExchange.values()])),
    [shownData, missionsForExchange]
  )

  /**
   * A post, as the conversation it became -- or nothing, when it stayed a set
   * of independent answers and the grid of cards is the truth.
   *
   * Rooted at EVERY mission the post started, not the one that reaches
   * furthest: a reply is a new mission linked only to the turn it answers, so
   * two members who answer at once and then write to each other leave two
   * halves of one argument. Walking from one of them drew the argument with
   * its opening turn missing (MEASURED 2026-09-11).
   */
  const roomExchangeFor = (room: PublicRoom, postId: string): RoomExchange | undefined => {
    const post = room.posts.find((entry) => entry.postId === postId)
    if (post === undefined) return undefined
    const whole = exchangeAcross(Object.values(post.missions), [...missionsForExchange.values()])
    if (whole === undefined) return undefined
    // The newest post that is still older than nothing: anything said after
    // it, under THIS post, is the case that needs a time.
    const laterPostAt = room.posts
      .filter((entry) => entry.at > post.at)
      .map((entry) => entry.at)
      .sort()[0]
    const textOf = (missionId: string): string | undefined => {
      const live = [...runs.values()].find((run) => run.data?.missionId === missionId)
      const recorded = historyByIdRef.current.get(missionId)
      const events = live !== undefined && live.events.length > 0 ? live.events : recorded?.events ?? []
      /*
       * EVERY message of the turn, not the last one.
       *
       * This took `finals.at(-1)` -- the last message marked final -- and fell
       * back to the latest message while none was. So a teammate's progress
       * appeared as it was written and then VANISHED the moment the turn
       * finished: the fallback had been showing message three, and the final
       * replaced the lot with message four. Colin, 2026-09-13: "the agents
       * initial messages are properly appearing in rooms chat but then when
       * final message is sent out it disappears."
       *
       * The same defect the answer cards had before 0.89.0, surviving in the
       * path that kept the old shape: one string standing in for a whole
       * turn. The thread has always drawn all of them, which is why the
       * mission opened beside the room showed four messages where the room
       * showed one.
       */
      const raw = turnText(events)
      // Trimmed: a stripped share block leaves the blank lines that held it,
      // and the room drew a turn whose name and first sentence were an inch
      // apart for no reason a reader could see (MEASURED 2026-09-11).
      const said = stripFileBlocks(stripMemoryBlocks(stripTaskBlocks(stripDecisionBlocks(stripShareBlocks(raw))))).trim()
      return said.length === 0 ? undefined : said
    }
    return sequenceOfPost({
      post: { postId: post.postId, at: post.at, missions: post.missions, ...(post.queued === undefined ? {} : { waiting: post.queued }) },
      missions: missionsForExchange,
      reached: whole.missionIds,
      textOf,
      startedAtOf: (missionId) =>
        [...runs.values()].find((run) => run.data?.missionId === missionId)?.startedAtIso
        ?? historyByIdRef.current.get(missionId)?.createdAt,
      finishedOf: (missionId) => {
        const live = [...runs.values()].find((run) => run.data?.missionId === missionId)
        return live === undefined ? true : !liveRunIsActive(live)
      },
      nameOf: (teammateId) => teammates.find((entry) => entry.teammateId === teammateId)?.name ?? teammateId,
      laterPostAt,
      hops: whole.hops,
      cap: relayHopCap,
      cost: whole.cost,
      starting: Object.values(relayStarting),
      liveOf: liveTurnOf
    })
  }

  const roomExchangeCostText = (room: PublicRoom, postId: string): string | undefined => {
    const found = roomExchangeFor(room, postId)
    return found === undefined ? undefined : costLine(found.foot.cost)
  }

  /**
   * The answers under one room post, read from the missions it started:
   * the live run when the window holds it, else the record. The phase is
   * the record's own word and the text is the teammate's last final
   * message -- nothing summarised, and every card opens its mission.
   */
  const roomAnswersFor = (room: PublicRoom, postId: string): readonly RoomAnswer[] => {
    const post = room.posts.find((entry) => entry.postId === postId)
    if (post === undefined) return []
    const answers: RoomAnswer[] = []
    for (const [teammateId, missionId] of Object.entries(post.missions)) {
      const live = [...runs.values()].find((run) => run.data?.missionId === missionId)
      const recorded = historyByIdRef.current.get(missionId)
      const events = live !== undefined && live.events.length > 0 ? live.events : recorded?.events ?? []
      // Same rule as the exchange above: a turn is everything it said.
      const raw = turnText(events)
      // The words, not the blocks: what a reply shared, asked or moved on the
      // board is shown by those surfaces. The room smoke's first live run
      // drew a raw task block inside the card (2026-09-05).
      const last = raw === undefined ? undefined : stripFileBlocks(stripMemoryBlocks(stripTaskBlocks(stripDecisionBlocks(stripShareBlocks(raw)))))
      const phase = live !== undefined ? live.phase : recorded?.phase ?? 'unknown'
      const runtime = live?.data?.runtime ?? recorded?.runtime ?? 'codex'
      const model = live?.data?.model ?? recorded?.model ?? 'account-default'
      answers.push({
        teammateId,
        missionId,
        /*
         * When the asking started, so the card can say how long it has been
         * quiet. The first event is the honest mark for a run that has
         * spoken; for one that has not, the post is -- which is exactly the
         * window this is for. A queued member's clock starts when they were
         * asked, not when the post was made, and their first event is the
         * only record of that.
         */
        startedAt: events[0]?.occurredAt ?? post.at,
        phase,
        text: last === undefined || last.trim().length === 0 ? undefined : last,
        /*
         * The whole turn, drawn by the thread's own renderer.
         *
         * Built here rather than in the room because this is where the events
         * are -- live if the run is still going, from the record otherwise --
         * and because `buildThread` is the one place that decides what a turn
         * looks like. A second opinion about that in the room is how the two
         * surfaces came to disagree in the first place.
         */
        items: buildThread(events, {
          running: phase === 'running' || phase === 'starting',
          mayEdit: (live?.data?.sandbox ?? recorded?.sandbox) !== 'read-only',
          ...(workspacePath === undefined ? {} : { workspacePath })
        }),
        runtime,
        model
      })
    }
    return answers
  }

  const refreshRooms = (): void => {
    void window.desktop
      ?.listRooms()
      .then((response) => {
        noteStore('rooms', response.ok)
        if (response.ok) setRooms(response.data.rooms)
      })
      .catch(() => undefined)
  }

  /** Every memory answer carries the whole list; adopt it, or hand back the refusal. */
  const adoptMemories = (response: MemoryListResponse): string | undefined => {
    if (!response.ok) return response.error.message
    setMemories(response.data.memories)
    setMemoryWorkspace({ id: response.data.workspaceId, name: response.data.workspaceName })
    return undefined
  }
  useEffect(() => {
    if (screen === 'memory') refreshMemories()
    /*
     * And every open menu closes with the screen it belongs to.
     *
     * Grok's beta drive, 2026-09-14, finding 7: the room header's menu was
     * opened -- All rooms / Rename / Remove for good? -- and then Ctrl+2 and
     * Ctrl+3 switched screens with the keyboard. The menu floated over Team
     * and over Home, still offering to remove a room the person was no longer
     * looking at.
     *
     * Dismiss-on-click-outside cannot catch this: no click happened. A menu
     * is bound to the thing it was opened from, and that thing is gone.
     */
    setRowMenu(undefined)
    setRowMenuArmed(undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen])
  // Leaving a room is the same event as leaving a screen, as far as a menu
  // that belongs to that room is concerned.
  useEffect(() => {
    setRowMenu(undefined)
    setRowMenuArmed(undefined)
  }, [currentRoomId])
  const refreshMemories = (): void => {
    void window.desktop
      ?.listMemories()
      .then(adoptMemories)
      .catch(() => undefined)
  }
  const memoryCall = async (call: Promise<MemoryListResponse> | undefined): Promise<string | undefined> => {
    if (call === undefined) return 'Memory is not available here.'
    try {
      return adoptMemories(await call)
    } catch {
      return 'Memory could not be changed. What was saved is still saved.'
    }
  }
  const addMemory = (text: string, scope: MemoryScope): Promise<string | undefined> => memoryCall(window.desktop?.addMemory({ text, scope }))
  const updateMemory = (request: MemoryUpdateRequest): Promise<string | undefined> => memoryCall(window.desktop?.updateMemory(request))
  const removeMemory = (memoryId: string): Promise<string | undefined> => memoryCall(window.desktop?.removeMemory(memoryId))
  const clearMemories = (scope: 'workspace' | 'all'): Promise<string | undefined> => memoryCall(window.desktop?.clearMemories({ scope }))
  const changeMemoryMode = (next: MemoryMode): void => {
    const before = memoryMode
    setMemoryMode(next)
    void window.desktop
      ?.writeWorkspaceSettings({ swarm, relay, relayHopCap, interrupt, memoryMode: next, autoMode, askConnectors, keepATodoList, replySize, layout, tube })
      .then((settings) => setMemoryMode(settings.memoryMode))
      .catch(() => setMemoryMode(before))
  }

  /**
   * Make a room and say which one, because the caller usually wants to post
   * to it next.
   *
   * `createRoom` below keeps the old shape -- an error string or nothing --
   * for the Rooms screen's own form, which has nothing to do afterwards.
   */
  const makeRoom = async (
    name: string,
    teammateIds: readonly string[]
  ): Promise<{ readonly roomId: string } | { readonly message: string }> => {
    const bridge = window.desktop
    if (bridge === undefined) return { message: 'The secure desktop bridge is unavailable.' }
    const response = await bridge.createRoom({ name, teammateIds }).catch(() => undefined)
    if (response === undefined) return { message: 'The room could not be created. No room was added.' }
    if (!response.ok) return { message: response.error.message }
    refreshRooms()
    const made = response.data.room
    if (made === undefined) return { message: 'The room could not be created. No room was added.' }
    setCurrentRoomId(made.roomId)
    return { roomId: made.roomId }
  }

  const createRoom = async (name: string, teammateIds: readonly string[]): Promise<string | undefined> => {
    const made = await makeRoom(name, teammateIds)
    return 'roomId' in made ? undefined : made.message
  }

  const renameRoom = (roomId: string, name: string): void => {
    void window.desktop
      ?.renameRoom(roomId, name)
      .then((response) => {
        if (!response.ok) {
          setRoomNotice(response.error.message)
          return
        }
        setRoomNotice(undefined)
        refreshRooms()
      })
      .catch(() => setRoomNotice('That room could not be renamed. It kept the name it had.'))
  }

  const removeRoom = (roomId: string): void => {
    void window.desktop
      ?.removeRoom(roomId)
      .then((response) => {
        if (!response.ok) {
          setRoomNotice(response.error.message)
          return
        }
        setCurrentRoomId((current) => (current === roomId ? undefined : current))
        refreshRooms()
      })
      .catch(() => setRoomNotice('That room could not be removed. It and its posts are still there.'))
  }

  const postToRoom = async (roomId: string, text: string): Promise<string | undefined> => {
    const bridge = window.desktop
    if (bridge === undefined) return 'The secure desktop bridge is unavailable.'
    const response = await bridge.postToRoom({ roomId, text }).catch(() => undefined)
    if (response === undefined) return 'The post could not be made. Nothing was added to the room.'
    if (!response.ok) return response.error.message
    refreshRooms()
    // Who could not be started, in the host's words, said once per reason.
    setRoomNotice(refusalNotice(response.data.refused))
    return undefined
  }

  /** A person moving a room's board. The host answers with the room as it now stands. */
  const updateRoomTask = async (request: RoomTaskRequest): Promise<string | undefined> => {
    const bridge = window.desktop
    if (bridge === undefined) return 'The secure desktop bridge is unavailable.'
    const response = await bridge.updateRoomTask(request).catch(() => undefined)
    if (response === undefined) return 'The board could not be changed. It still shows what it showed.'
    if (!response.ok) return response.error.message
    setRooms((current) => current.map((room) => (room.roomId === response.data.room.roomId ? response.data.room : room)))
    return undefined
  }

  /** Stop every run in the exchange. Records stay; only the processes go. */
  const stopExchange = (runIds: readonly string[]): void => {
    const bridge = window.desktop
    if (bridge === undefined || runIds.length === 0) return
    setStoppingExchange(true)
    void Promise.all(
      runIds.map((runId) => {
        setRuns((all) => withRun(all, runId, (run) => ({ ...run, phase: 'cancelling', error: undefined })))
        return bridge.cancelCodexMission({ runId }).catch(() => undefined)
      })
    ).finally(() => setStoppingExchange(false))
  }

  const startMission = async (
    prompt: string,
    modeOverride?: MissionMode,
    /** Sent from the queue: refused as busy, it goes back in line (retriedAfterBusy). */
    options?: { readonly requeue?: QueuedRow }
  ): Promise<boolean> => {
    const route = composerRoute
    // What was on screen before this turn's own row took its place.
    const previousKey = shownKey
    const bridge = window.desktop
    const teammateId = pickedTeammate?.teammateId
    // No folder, no run. The main process refuses this too; saying it here
    // keeps a refused start from being filed as a failed mission.
    if (workspacePath === undefined && build !== undefined) {
      setWorkspaceNotice(
        'Choose the folder your teammates work in first. Locust was opened from its own install folder, and no teammate should work in there.'
      )
      return false
    }
    const key = `pending:${++pendingKeyCounter.current}`
    // A reply continues the conversation on screen, when there IS one to
    // continue: the same teammate's finished mission, on the route it ran on,
    // that actually left a runtime session behind. Anything else is a new
    // mission -- which is what a person means when they switch teammate or
    // route first, and the only thing that can work after a run that failed
    // before its runtime ever started.
    const shown = liveRunRef.current
    // Being the next turn of a conversation and resuming a runtime's session
    // are two different things, and gating the first on the second is what
    // made a reply after a failed run open a SECOND sidebar row and lose the
    // turn before it from the screen (Colin, 2026-09-03: "the old bug where
    // it starts new missions"). A run that failed before its runtime got
    // going left no session to resume -- it did not stop being the turn the
    // person was replying to. So the conversation continues either way, and
    // whether the model gets the earlier messages is asked separately.
    // The route no longer has to match: a reply on another runtime is a
    // checkpointed continuation now (the host briefs the new runtime from the
    // old run's record), so it is still the same conversation on screen. The
    // 0.21.2 QA pass had to start a stranger and retype the task instead.
    /*
     * Whether the run is still LIVE is not this decision to make.
     *
     * It was, and it cost the thread: "Build this plan" clicked while the plan
     * run was still settling recorded the build turn with no `continuesFrom`
     * at all, so it started a stranger instead of following the plan it was
     * offered from. Intermittent by construction -- terminal events land once
     * per frame, so for a few tens of milliseconds the host has released the
     * mission and this has not heard (`docs/FINDING-smoke-sweep-2026-09-11.md`,
     * the `steering` smoke: PASS, FAIL, FAIL, PASS).
     *
     * The host settles it, and settles it STRICTER: `ownerBusy` is checked
     * and returns before `followUpOf` is so much as read, so a follow-up on a
     * genuinely running mission cannot be honoured -- the start is refused
     * first, and a refusal now queues the message and asks again when the run
     * in front of it ends. There is no window left in which this is wrong.
     */
    const continuing =
      shown !== undefined && shown.data !== undefined && ownerOf(shown) === teammateId ? shown : undefined
    const coldStart = continuing !== undefined && resumableSessionOf(continuing.events) === undefined
    const earlierTurns = continuing === undefined
      ? []
      : [
          ...(continuing.earlierTurns ?? []),
          {
            missionId: continuing.data!.missionId,
            prompt: continuing.prompt,
            events: continuing.events,
            // What that turn exchanged with peers, carried forward with it.
            // Dropping it here is what hid the outgoing half of a teammate
            // exchange even after the thread learned to draw earlier turns:
            // the message Booty sent Wren lived on the turn BEFORE the reply,
            // and this is where that turn was rebuilt without it.
            ...(continuing.peerMessages === undefined ? {} : { peerMessages: continuing.peerMessages })
          }
        ]
    const starting: LiveRunState = {
      prompt,
      phase: 'starting',
      events: [],
      startedAtIso: new Date().toISOString(),
      runtime: route.runtime,
      ...(teammateId === undefined ? {} : { teammateId }),
      ...(earlierTurns.length === 0 ? {} : { earlierTurns }),
      ...(coldStart ? { coldStart: true } : {}),
      // Plan is a mode now, so the run remembers what it was asked to be
      // rather than a switch that sat beside the mode and could disagree.
      ...((modeOverride ?? mode) === 'plan' ? { plan: true } : {})
    }
    setRuns((current) => withNewRun(current, key, starting))
    setShownKey(key)
    if (!bridge) {
      setRuns((current) =>
        withRun(current, key, (run) => ({ ...run, phase: 'failed', error: 'The secure desktop bridge is unavailable.' }))
      )
      return false
    }

    try {
      const response = await bridge.startCodexMission({
        prompt,
        // The mode the composer SHOWS, which is not always the mode last
        // chosen: a mode the route cannot run is not one a mission can start
        // in, and sending it anyway is how every message came back refused.
        mode: modeRunsOn(modeOverride ?? mode, route.runtime, build?.platform)
          ? modeOverride ?? mode
          : modesFor(route.runtime, build?.platform)[0] ?? 'accept-edits',
        runtime: route.runtime,
        // The concrete model. When a runtime encodes effort in the id, the
        // chosen effort names a different model, and sending the family's
        // default with an effort beside it would run the wrong one.
        // Only sent when the chosen model advertised it; the composer cannot
        // offer an effort the catalog did not report for that model. Swarm
        // overrides the picked effort with the model's maximum, and the
        // composer shows that -- so what is sent must match what is shown.
        // Where the effort lives inside the model id, it is sent as the id
        // alone (startRoute).
        ...startRoute(models, route.runtime, route.model, swarmEffortFor(models, route.model, swarm, effort, route.runtime)),
        modelChoice: route.model,
        ...(teammateId !== undefined && pickerRoutes.has(teammateId) ? { routeOverrideFor: teammateId } : {}),
        ...(teammateId === undefined ? {} : { teammateId }),
        ...(continuing === undefined ? {} : { followUpOf: continuing.data!.missionId })
      })
      if (!response.ok) {
        /*
         * "Already running" is NOT A FAILURE, and must not eat the message.
         *
         * A teammate takes one mission at a time, so a message sent a moment
         * too early is refused -- and the turn was marked `failed`, drawn in
         * the terminal red register under "The run could not continue", and
         * the composer let go of the text because the turn was on screen. So
         * the person's sentence was gone and the conversation said it had
         * broken. Colin, 2026-09-11, with a screenshot of exactly that: "
         * message broke off then gave me this error", above a sidebar showing
         * the teammate idle.
         *
         * The app already has the right answer for this and was not using it:
         * the queue. The message waits for the run in front of it and goes
         * when that one finishes, which is what a person means by sending it.
         */
        if (response.error.code === 'RUN_ALREADY_ACTIVE') {
          const inFront = [...runs.entries()].find(
            ([, run]) => liveRunIsActive(run) && teammateId !== undefined && ownerOf(run) === teammateId
          )?.[0]
          setRuns((current) => {
            const next = new Map(current)
            next.delete(key)
            return next
          })
          // The row just deleted was what the window showed: put back the
          // conversation it replaced, or the window is left on nothing and
          // falls back to the teammate's home screen (0.297 drive, turn 5).
          setShownKey((current) => (current === key ? previousKey : current))
          if (inFront !== undefined) {
            setQueued((rows) => [...rows, { id: `q_${String(rows.length)}_${inFront}`, key: inFront, text: prompt, origin: 'person' as const }])
            return true
          }
          // Nothing of theirs is on screen to wait behind -- the cap is full,
          // or the run belongs to a window this one cannot see. The words go
          // back in the box, which is the only other honest place for them --
          // or, for a message the queue sent, back in the queue: it went
          // because the run in front ended HERE, and the host can still be
          // finishing that run. Dropped, it was simply gone.
          if (options?.requeue !== undefined) {
            const back = retriedAfterBusy(options.requeue, previousKey ?? options.requeue.key, Date.now())
            setQueued((rows) => [back, ...rows])
            return true
          }
          return false
        }
        // A ledger that cannot be written is the same failure whether it hits
        // on the FIRST write or the fortieth, and only the second one used to
        // reach the card that explains it. The first -- a ledger folder that
        // is unwritable when the app starts, which is the likeliest way anyone
        // meets this -- arrived as a plain start error and drew the generic
        // "The run could not continue". Measured by
        // `_tools/drive-ledger-failure.mjs`, which blocks the ledger path.
        const persistence = response.error.code === 'PERSISTENCE_FAILED'
        setRuns((current) =>
          withRun(current, key, (run) => ({
            ...run,
            phase: 'failed',
            error: response.error.message,
            ...(persistence ? { errorIsPersistence: true } : {})
          }))
        )
        // The turn IS on screen -- prompt bubble and failure card -- so the
        // composer must let go of it. Holding on left the same sentence in
        // two places and read as though nothing had been sent (Colin,
        // 2026-09-04: "sometimes text stays in box after sending"). The
        // bridge-missing case above still keeps it, because there the turn
        // was never recorded anywhere and the box is the only copy.
        return true
      }

      const runId = response.data.runId
      // The host recorded the owner; mirror it so the sidebar files the
      // mission under the teammate at once rather than after a refresh.
      if (teammateId !== undefined) {
        const missionId = response.data.missionId
        setMissionOwners((current) => ({ ...current, [missionId]: teammateId }))
        // The host recorded this route as the teammate's own; mirror it so a
        // reply they make on their own, and the composer next time they are
        // picked, use it at once.
        const kept = { runtime: response.data.runtime, model: response.data.model, mode: modeOverride ?? mode }
        setTeammates((current) =>
          current.map((teammate) => (teammate.teammateId === teammateId ? { ...teammate, route: kept } : teammate))
        )
      }
      const queued = pendingUpdatesRef.current.get(runId) ?? []
      pendingUpdatesRef.current.delete(runId)
      setRuns((current) => {
        let next: LiveRunState = {
          ...starting,
          runtime: response.data.runtime,
          data: response.data,
          phase: 'running',
          peerMessages: response.data.peerMessages,
          ...(response.data.peerDeliveryFailed
            ? { peerNotices: ['Messages from teammates could not be read for this mission. Whatever was waiting is still waiting.'] }
            : {})
        }
        for (const update of queued) next = applyMissionUpdate(next, update)
        return withNewRun(withoutRun(current, key), runId, next)
      })
      // Follow the run under its real key only if the person is still looking
      // at it; they may have moved to another teammate's thread meanwhile.
      setShownKey((current) => (current === key ? runId : current))
      // Stopped while it was still starting: the person pressed the button
      // and meant it, so the run is cancelled the moment it can be named.
      if (cancelWhenNamedRef.current.delete(key)) {
        setRuns((all) => withRun(all, runId, (run) => ({ ...run, phase: 'cancelling', error: undefined })))
        void bridge
          .cancelCodexMission({ runId })
          .then((answer) => {
            if (answer.ok) return
            setRuns((all) =>
              withRun(all, runId, (run) =>
                liveRunIsActive(run) ? { ...run, phase: 'running', error: answer.error.message } : run
              )
            )
          })
          .catch(() => {
            setRuns((all) =>
              withRun(all, runId, (run) =>
                liveRunIsActive(run)
                  ? { ...run, phase: 'running', error: 'The cancellation request could not be delivered. The mission is still running.' }
                  : run
              )
            )
          })
      }
      // And so does anything queued against it. The temporary key was just
      // deleted above, so a message typed while the host was still answering
      // pointed at nothing and was held as "that conversation is no longer
      // open" -- about the conversation on screen.
      setQueued((current) => requeuedRows(current, key, runId))
      return true
    } catch {
      setRuns((current) =>
        withRun(current, key, (run) => ({ ...run, phase: 'failed', error: 'The mission could not be started. Nothing was run and nothing was changed.' }))
      )
      return false
    }
  }

  /**
   * Move the shown run to another runtime.
   *
   * The host stops it, reconciles it, and starts a NEW mission briefed from
   * that checkpoint -- so what comes back is a different runId and missionId,
   * and the renderer carries the old run's events forward itself if the
   * thread is to keep reading as one piece of work.
   *
   * Everything about a refusal is surfaced verbatim, because every refusal
   * path in the host describes a mission that is now STOPPED. Swallowing one
   * would leave a dead run looking live.
   */
  /**
   * Pick a stopped mission back up. It reaches the same update stream a start
   * does, so the new run appears and follows exactly as any other; what is
   * different is only that the host wrote its prompt from the checkpoint.
   */
  const resumeMission = async (missionId: string, epoch: number): Promise<void> => {
    const route = composerRoute
    const bridge = window.desktop
    if (!bridge) return
    setHandingOff(true)
    try {
      // The same route the composer would start a fresh mission on, folded
      // the same way. This used to send the model and NOTHING else, so
      // resuming from a checkpoint silently dropped the effort the chip was
      // showing -- and on Cursor, where effort is encoded in the model id
      // rather than passed beside it, it also ran a different model than the
      // one on screen. The contract already carried `effort`; the renderer
      // was the half that never filled it in.
      const resumed = startRoute(
        models,
        route.runtime,
        route.model,
        swarmEffortFor(models, route.model, swarm, effort, route.runtime)
      )
      const response = await bridge.resumeMission({
        missionId,
        runtime: route.runtime,
        mode,
        ...(resumed.model === 'account-default' ? {} : { model: resumed.model }),
        ...(resumed.effort === undefined ? {} : { effort: resumed.effort })
      })
      if (!response.ok) {
        // Said in the thread the person is looking at, not swallowed: they
        // pressed a button and are owed the reason it did nothing.
        setRuns((current) =>
          withNewRun(current, `resume-failed:${String(epoch)}:${String(++pendingKeyCounter.current)}`, {
            prompt: 'Resume from checkpoint',
            phase: 'failed',
            events: [],
            error: response.error.message
          })
        )
        return
      }
      const ownerId = missionOwners[missionId]
      if (ownerId !== undefined) {
        setMissionOwners((current) => ({ ...current, [response.data.missionId]: ownerId }))
      }
      setRuns((current) =>
        withNewRun(current, response.data.runId, {
          prompt: 'Resume from checkpoint',
          data: response.data,
          phase: 'running',
          events: [],
          startedAtIso: new Date().toISOString(),
          ...(ownerId === undefined ? {} : { teammateId: ownerId })
        })
      )
      setShownKey(response.data.runId)
      await refreshHistory()
    } finally {
      setHandingOff(false)
    }
  }

  const handOffMission = async (choice: RouteChoice): Promise<void> => {
    const bridge = window.desktop
    const current = liveRunRef.current
    const runId = current?.data?.runId
    if (!bridge || current === undefined || runId === undefined || !liveRunIsActive(current)) return

    const from = current.data?.runtime ?? route.runtime
    const priorEvents = current.events
    setHandingOff(true)
    setRuns((all) => withRun(all, runId, (run) => ({ ...run, phase: 'cancelling', error: undefined })))
    // The new run cannot inherit questions asked of the old one.
    setApprovals((all) => all.filter((entry) => entry.runId !== runId))

    try {
      const response = await bridge.handOffMission({
        runId,
        runtime: choice.runtime,
        mode,
        ...startRoute(models, choice.runtime, choice.model, swarmEffortFor(models, choice.model, swarm, effort, choice.runtime))
      })

      if (!response.ok) {
        // Failed, not cancelled: the mission is over and the reason has to be
        // the thing on screen.
        setRuns((all) => withRun(all, runId, (run) => ({ ...run, phase: 'failed', error: response.error.message })))
        return
      }

      const newRunId = response.data.runId
      setRoute(choice)
      const ownerId = ownerOf(current)
      if (ownerId !== undefined) {
        const missionId = response.data.missionId
        setMissionOwners((owners) => ({ ...owners, [missionId]: ownerId }))
        // The host now remembers a handed-off route as the teammate's own;
        // mirror it, as a start does, so the sidebar and the composer agree
        // (the sidebar read the old route after a handoff, 2026-09-05).
        const kept = { runtime: response.data.runtime, model: response.data.model, mode }
        setTeammates((all) => all.map((teammate) => (teammate.teammateId === ownerId ? { ...teammate, route: kept } : teammate)))
      }
      const queued = pendingUpdatesRef.current.get(newRunId) ?? []
      pendingUpdatesRef.current.delete(newRunId)
      setRuns((all) => {
        let next: LiveRunState = {
          // The ORIGINAL words, not the generated briefing: the person never
          // typed the briefing, so it must not appear as something they said.
          prompt: current.prompt,
          data: response.data,
          phase: 'running',
          events: [],
          ...(ownerId === undefined ? {} : { teammateId: ownerId }),
          peerMessages: response.data.peerMessages,
          handoff: {
            from,
            to: response.data.runtime,
            at: new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
            unsettledCount: response.data.unsettledCount,
            omittedBriefing: response.data.omittedBriefing,
            priorEvents
          }
        }
        for (const update of queued) next = applyMissionUpdate(next, update)
        // The stopped run's own terminal receipt still arrives under its old
        // runId; it stays in the map so the sidebar shows both missions, which
        // is what the durable record holds.
        return withNewRun(all, newRunId, next)
      })
      setShownKey((shown) => (shown === runId ? newRunId : shown))
      // A handoff continues the same conversation under another runtime, so
      // the next thing the person said belongs to it and not to the run that
      // was handed off.
      setQueued((current) => requeuedRows(current, runId, newRunId))
    } catch {
      setRuns((all) =>
        withRun(all, runId, (run) => ({ ...run, phase: 'failed', error: 'The handoff request could not be delivered. The mission stayed on the runtime it was on.' }))
      )
    } finally {
      setHandingOff(false)
    }
  }

  const cancelMission = (): void => {
    const bridge = window.desktop
    const press = stopPress(liveRun, shownKey)
    if (!bridge || press.kind === 'nothing') return
    // Pressed before the host has answered with a run id. The runtime is
    // already going, so this is not a press to ignore -- it is remembered
    // against the key the run has right now, and the start honours it as
    // soon as there is something to name. Silently returning here let a
    // stopped mission run to completion (measured 2026-09-10).
    if (press.kind === 'cancel-when-named') {
      cancelWhenNamedRef.current.add(press.key)
      setRuns((all) => withRun(all, press.key, (run) => ({ ...run, phase: 'cancelling', error: undefined })))
      return
    }
    const runId = press.runId
    setRuns((all) => withRun(all, runId, (run) => ({ ...run, phase: 'cancelling', error: undefined })))
    void bridge
      .cancelCodexMission({ runId })
      .then((response) => {
        if (response.ok) return
        setRuns((all) =>
          withRun(all, runId, (run) =>
            liveRunIsActive(run) ? { ...run, phase: 'running', error: response.error.message } : run
          )
        )
      })
      .catch(() => {
        setRuns((all) =>
          withRun(all, runId, (run) =>
            liveRunIsActive(run)
              ? { ...run, phase: 'running', error: 'The cancellation request could not be delivered. The mission is still running.' }
              : run
          )
        )
      })
  }

  const createTeammate = (input: { name: string; hue: TeammateHue; role: TeammateRole; roleTitle?: string; worktree?: boolean; avatar: AvatarSpec }): void => {
    const bridge = window.desktop
    if (!bridge) return
    void bridge
      .createTeammate(input)
      .then((response) => {
        if (!response.ok) {
          setTeammateError(response.error.message)
          return
        }
        setTeammateError(undefined)
        setNewTeammateOpen(false)
        return bridge.listTeammates().then((listed) => {
          if (!listed.ok) return
          setTeammates(listed.data.teammates)
          setMissionOwners(listed.data.missionOwners)
          setMissionTitles(listed.data.missionTitles)
        })
      })
      .catch(() => setTeammateError('That teammate could not be created. Nobody was added.'))
  }

  const updateTeammate = (
    teammateId: string,
    input: { name: string; hue: TeammateHue; role: TeammateRole; roleTitle?: string; worktree?: boolean; avatar: AvatarSpec }
  ): void => {
    const bridge = window.desktop
    if (!bridge) return
    void bridge
      .updateTeammate({ teammateId, ...input })
      .then((response) => {
        if (!response.ok) {
          setTeammateError(response.error.message)
          return
        }
        setTeammateError(undefined)
        setEditingTeammate(undefined)
        return bridge.listTeammates().then((listed) => {
          if (!listed.ok) return
          setTeammates(listed.data.teammates)
          setMissionOwners(listed.data.missionOwners)
          setMissionTitles(listed.data.missionTitles)
        })
      })
      .catch(() => setTeammateError('That teammate could not be updated. Their details are unchanged.'))
  }

  /**
   * Point one teammate at its own folder, or put it back in the project one.
   *
   * The host opens the dialog and writes the record; what comes back is the
   * teammate, never a path. The open dialog is refreshed from that answer so
   * the row shows the new folder without a Save, which is honest -- the
   * change has already happened by then.
   */
  /** Every connector the host reports, read when the edit dialog opens. */
  const [connectorList, setConnectorList] = useState<readonly PublicConnector[]>()
  useEffect(() => {
    if (editingTeammate === undefined) return
    let live = true
    void window.desktop
      ?.listConnectors()
      .then((response) => {
        if (live && response.ok) setConnectorList(response.data.connectors)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [editingTeammate?.teammateId])

  /** Narrow one teammate to some connectors, or widen it back. The host answers with the teammate. */
  const setTeammateConnectors = (teammateId: string, names: readonly string[]): void => {
    const bridge = window.desktop
    if (!bridge) return
    void bridge
      .setTeammateConnectors(teammateId, names)
      .then((response) => {
        if (!response.ok) {
          setFolderNotice(response.error.message)
          return
        }
        setEditingTeammate(response.data.teammate)
        return bridge.listTeammates().then((listed) => {
          if (!listed.ok) return
          setTeammates(listed.data.teammates)
          setMissionOwners(listed.data.missionOwners)
          setMissionTitles(listed.data.missionTitles)
        })
      })
      .catch(() => setFolderNotice('That could not be changed. The setting is as it was.'))
  }

  const chooseTeammateFolder = (teammateId: string, clear: boolean): void => {
    const bridge = window.desktop
    if (!bridge) return
    setFolderNotice(undefined)
    void bridge
      .chooseTeammateFolder(teammateId, clear)
      .then((response) => {
        if (!response.ok) {
          // Closing the picker is not a failure and is not reported as one.
          if (response.error.code !== 'CANCELLED') setFolderNotice(response.error.message)
          return
        }
        setEditingTeammate(response.data.teammate)
        return bridge.listTeammates().then((listed) => {
          if (!listed.ok) return
          setTeammates(listed.data.teammates)
          setMissionOwners(listed.data.missionOwners)
          setMissionTitles(listed.data.missionTitles)
        })
      })
      .catch(() => setFolderNotice('That folder could not be chosen. The workspace is unchanged.'))
  }

  const reloadRoutines = async (): Promise<void> => {
    const bridge = window.desktop
    if (!bridge) return
    const listed = await bridge.listRoutines()
    noteStore('routines', listed.ok)
    if (listed.ok) setRoutines(listed.data.routines)
  }

  /** Open the dialog on a draft taken from a finished conversation. */
  const openSaveRoutine = (missionId: string): void => {
    const mission = historyByIdRef.current.get(missionId)
    if (mission === undefined) return
    const draft = routineDraftFor(missionId)
    if (draft === undefined) return
    /*
     * A CONVERSATION NOBODY OWNS CAN STILL BE SAVED, and the dialog asks who
     * will run it.
     *
     * This returned early when the conversation had no owner, so the last
     * hole in the solo path was this one: memory and the folder brief reached
     * an ownerless run in 0.191.0 and Save as routine still did not. The
     * steps are the PERSON's words either way -- that is the whole of what a
     * routine is -- and the only thing genuinely missing is whose route
     * replays them, which is a question with an answer on screen.
     */
    /*
     * The conversation's owner, walked back -- not this turn's.
     *
     * A follow-up typed after a conversation was assigned records no owner of
     * its own, and reading the turn alone is exactly the defect Grok found on
     * pass 14: the menu told the person who had just typed the words that
     * nothing here was typed by them. Asking "who runs it" about a
     * conversation that plainly has an owner would be the same mistake in a
     * new place.
     */
    const teammateId = conversationOwnerOf(missionId)
    const teammate = teammates.find((entry) => entry.teammateId === teammateId)
    setRoutineDialog({
      teammateId,
      name: draft.name,
      steps: draft.steps,
      learnedFrom: draft.learnedFrom,
      truncated: draft.truncated,
      // The route the routine will replay on: the teammate's own, else the
      // one this conversation actually ran on. Never a guess.
      //
      // The effort comes from the composer, because missions do not record
      // theirs -- so there is no level to recover from the conversation being
      // taught, and the one on screen is the level the next run would use.
      //
      // Only where it would actually be SENT as one. The first version of this
      // stored it whenever the composer had a level, on the reading that a
      // model reporting no levels is exactly a runtime that refuses an effort.
      // That reading is wrong: Cursor reports levels AND refuses the argument,
      // because its levels live inside the model id. So a routine taught on
      // Cursor stored `{model: "composer-2.5-fast", effort: "fast"}`, and
      // replaying it put both in front of a builder that throws on the second
      // -- every routine on Cursor failed to start, silently, from 0.43.0
      // until routine-smoke caught it.
      route: (() => {
        /*
         * The mode the conversation ACTUALLY RAN IN, not `ask`.
         *
         * Colin, 2026-09-21: a routine saved from an ownerless conversation
         * could never run. The conversation ran on Cursor in `auto`; this
         * stored `ask`, and Cursor cannot be held read-only on Windows, so
         * every attempt was refused at dispatch. `ask` was a safe-looking
         * guess that is not safe at all -- it is a mode the person did not
         * choose, on a route that may not support it.
         *
         * A mission records its mode (v15), so there is nothing to guess.
         * Older missions have none; `ask` remains the answer only when the
         * record itself cannot say.
         */
        const base = teammate?.route ?? {
          runtime: mission.runtime,
          model: mission.model ?? 'account-default',
          mode: mission.mode ?? ('ask' as const)
        }
        const carried =
          effort === undefined || effortIsInModelId(models, base.runtime, base.model)
            ? undefined
            : effort
        return { ...base, ...(carried === undefined ? {} : { effort: carried }) }
      })(),
      busy: false
    })
  }

  const saveRoutine = (input: {
    readonly name: string
    readonly steps: readonly string[]
    readonly schedule: RoutineSchedule | undefined
    /** Who runs it, when the conversation had no owner to inherit. */
    readonly teammateId?: string
  }): void => {
    const bridge = window.desktop
    const dialog = routineDialog
    if (!bridge || dialog === undefined) return
    // The dialog asks for one when the conversation had none; this is the
     // second half of that rule, so a routine can never be stored ownerless.
    const owner = input.teammateId ?? dialog.teammateId
    /*
     * The route follows whoever the person just NAMED.
     *
     * `dialog.route` is decided when the dialog opens, and for a
     * conversation nobody owns there is no teammate to read it from -- so it
     * fell back to the conversation's runtime with a guessed mode, and
     * answering "who runs this?" never revisited it. The routine was then
     * stored on a mode its own teammate had never run in. Same rule as the
     * dialog's: the teammate's own route, else what the dialog worked out.
     */
    const named = teammates.find((entry) => entry.teammateId === owner)?.route
    const route = named ?? dialog.route ?? { runtime: 'codex' as const, model: 'account-default', mode: 'ask' as const }
    if (dialog.routineId === undefined && owner === undefined) {
      setRoutineDialog({ ...dialog, busy: false, error: 'Choose which teammate runs this routine.' })
      return
    }
    setRoutineDialog({ ...dialog, busy: true, error: undefined })
    const request =
      dialog.routineId === undefined
        ? bridge.createRoutine({
            name: input.name,
            teammateId: owner ?? '',
            route,
            steps: input.steps,
            learnedFrom: dialog.learnedFrom,
            ...(input.schedule === undefined ? {} : { schedule: input.schedule })
          })
        : // null clears a schedule the routine had; the store leaves an absent one alone.
          bridge.updateRoutine({ routineId: dialog.routineId, name: input.name, steps: input.steps, schedule: input.schedule ?? null })
    void request
      .then(async (response) => {
        if (!response.ok) {
          setRoutineDialog({ ...dialog, busy: false, error: response.error.message })
          return
        }
        setRoutineDialog(undefined)
        await reloadRoutines()
      })
      .catch(() => setRoutineDialog({ ...dialog, busy: false, error: 'That routine could not be saved. The version on disk is unchanged.' }))
  }

  /**
   * Open a saved routine for editing. Shared by the roster card and the
   * Automations screen: two copies of this had already started to drift in
   * the same file.
   */
  const editRoutine = (routine: PublicRoutine): void => {
    setRoutineDialog({
      teammateId: routine.teammateId,
      routineId: routine.routineId,
      name: routine.name,
      steps: routine.steps,
      learnedFrom: routine.learnedFrom,
      truncated: false,
      ...(routine.schedule === undefined ? {} : { schedule: routine.schedule }),
      busy: false
    })
  }

  const runRoutine = (routineId: string): void => {
    const bridge = window.desktop
    if (!bridge) return
    void bridge
      .runRoutine(routineId)
      .then(async (response) => {
        if (!response.ok) {
          setTeammateError(response.error.message)
          return
        }
        setTeammateError(undefined)
        // Follow the routine into the thread it is running in, the way the
        // view follows a teammate's reply.
        setScreen('workroom')
        openMission(response.data.missionId)
        await reloadRoutines()
      })
      .catch(() => setTeammateError('That routine could not be started. None of its steps ran.'))
  }

  const recoverRoutine: import('./components/RoutineRecovery.js').RecoverRoutine = async (request) => {
    if (!window.desktop) return { ok: false, error: { message: 'Desktop connection is unavailable.' } }
    const response = await window.desktop.recoverRoutine(request)
    await reloadRoutines()
    return response
  }

  const removeRoutine = (routineId: string): void => {
    const bridge = window.desktop
    if (!bridge) return
    void bridge
      .removeRoutine(routineId)
      .then(() => reloadRoutines())
      .catch(() => undefined)
  }

  const removeTeammate = (teammateId: string): void => {
    const bridge = window.desktop
    if (!bridge) return
    void bridge
      .removeTeammate(teammateId)
      .then(() => bridge.listTeammates())
      .then(async (listed) => {
        if (!listed.ok) return
        setTeammates(listed.data.teammates)
        setMissionOwners(listed.data.missionOwners)
        setMissionTitles(listed.data.missionTitles)
        // Their routines went with them; the host drops those, so re-read.
        await reloadRoutines()
      })
      .catch(() => undefined)
  }

  /*
   * The boot screen is its own WINDOW now, not part of this one.
   *
   * It used to be folded into the pane here, with a phase machine, a
   * discovery subscription and a clock all living in the app shell. All of
   * that moved to `SplashApp`, which is shown before this window exists and
   * closes when the runtimes have answered. Leaving a second copy here is
   * how the same ceremony came to play twice and finish in neither.
   */

  const running = liveRunIsActive(liveRun)
  /**
   * What THIS mission cost, for the line that is about this mission.
   *
   * It used to be the conversation's total, and Grok measured what that
   * does (2026-09-14, finding 2): a mission cancelled before anything
   * started -- its own ledger holding a create, a cancel and no usage at
   * all -- wore "1.8k in · 189 out", which were the previous turn's exact
   * counts. A run that failed on a provider error wore the turn before
   * it. Every other part of that line is a fact about this mission: its
   * id, its model, its phase, its sandbox. A stranger reads the number
   * beside them as this run's, and it was not.
   *
   * Silence when this run reported nothing, which is the honest answer for
   * a run that never reached a model -- never a zero, which reads as free.
   */
  /**
   * The conversation's total, for the conversation-scoped surface.
   *
   * Design ruling, 2026-09-14: this does not belong in the mission strip,
   * which is present-tense and mission-scoped. It lives beside the route
   * chip -- inside the context ring's hover where a ring exists, and stated
   * outright in the ring's slot where one does not, which is every runtime
   * except Claude Code.
   */
  const shownConversationCost =
    liveRun === undefined ? undefined : conversationCostLine(liveRun.earlierTurns ?? [], liveRun.events)
  const shownCostTail =
    liveRun === undefined
      ? ''
      : missionCostTail({ events: liveRun.events, earlierTurns: liveRun.earlierTurns ?? [], running })
  /**
   * How full the model's context is, from the newest turn that reported it.
   * Not the conversation's summed tokens: the window holds one prompt, so
   * adding turns together would say a five-turn chat is five times as full.
   */
  const shownContext =
    liveRun === undefined ? undefined : latestContext(liveRun.earlierTurns ?? [], liveRun.events)
  const runningCount = [...runs.values()].filter(liveRunIsActive).length

  /**
   * Pick the folder the teammates work in. A chosen folder reopens the app
   * there, which stops anything running -- so with runs live it says so and
   * does nothing, rather than taking the person's work down with the switch.
   */
  const chooseWorkspace = (): void => {
    const bridge = window.desktop
    if (bridge === undefined) return
    if (runningCount > 0) {
      setWorkspaceNotice('Stop the running missions first. Changing folder reopens Locust.')
      return
    }
    setWorkspaceNotice(undefined)
    void bridge
      .chooseWorkspace()
      .then((response) => {
        if (response.ok) setWorkspaceNotice(`Reopening in ${response.data.path}...`)
        else if (response.error.code !== 'CANCELLED') setWorkspaceNotice(response.error.message)
      })
      .catch(() => setWorkspaceNotice('The folder could not be chosen. The workspace is unchanged.'))
  }
  const historyById = useMemo(
    () => new Map(history.map((mission) => [mission.missionId, mission] as const)),
    [history]
  )
  // What each route's model turned out to be, from missions that already ran.
  const resolvedModels = useMemo(() => resolvedModelNames(history), [history])
  const recentRoutes = useMemo(() => recentlyUsedRoutes(history), [history])

  // Re-read history whenever ANY run settles, so a finished mission stays in
  // the sidebar after the next one starts instead of vanishing until restart.
  const settledSignature = [...runs.entries()]
    .filter(([, run]) => isTerminal(run.phase))
    .map(([key]) => key)
    .sort()
    .join('|')
  useEffect(() => {
    if (settledSignature.length === 0) return
    refreshHistory()
    // A tree that was "In use" is free once its run settles. Settings read
    // the list when it opened and kept saying In use until the NEXT run
    // (seen driving the app, 2026-09-05); re-read once the list has ever
    // been asked for, so a person sitting on Settings sees Remove appear.
    if (worktrees !== undefined) refreshWorktrees()
  }, [settledSignature])

  // A queued message goes as the next turn the moment its run COMPLETES, and
  // only then. A run that failed, was stopped or was interrupted leaves it
  // waiting with the reason on screen: sending the next instruction into a
  // conversation whose last turn did not happen would build on work that
  // never ran, which is the same rule a routine's steps follow.
  //
  // Only the conversation ON SCREEN sends, because a turn is started into the
  // conversation on screen: a message queued elsewhere waits in its own
  // conversation and goes when that is opened again. Each conversation is
  // judged by its own FRONT -- the row that goes next there, which every row
  // behind it is waiting on too -- and never by another's: one queue for
  // every conversation made a line for Gem wait on Pip's run and then ride
  // along with Pip's (outside beta recheck of 0.299, P1).
  const front = queuedIn(queued, shownKey)[0]
  const queuedRun = front === undefined ? undefined : runs.get(front.key)
  const verdict =
    front === undefined
      ? undefined
      : queuedVerdict({
          running: queuedRun !== undefined && liveRunIsActive(queuedRun),
          phase: queuedRun?.phase,
          onScreen: true
        })
  /** Ticks when a queued message's retry time comes round, so the effect below looks again. */
  const [queueClock, setQueueClock] = useState(0)
  useEffect(() => {
    if (front === undefined || shownKey === undefined || verdict?.kind !== 'send') return undefined
    // Refused as busy a moment ago: not before its retry time.
    const wait = (front.retryAt ?? 0) - Date.now()
    if (wait > 0) {
      const timer = window.setTimeout(() => setQueueClock((tick) => tick + 1), wait)
      return () => window.clearTimeout(timer)
    }
    // Folded at the moment of sending rather than as it is typed, so a person
    // can still edit or drop any row right up until it goes.
    const { going, rest } = takeNext(queued, shownKey)
    if (going === undefined) return undefined
    // Cleared BEFORE sending: this effect runs again on the state the send
    // produces, and a queue still holding the message would send it twice.
    // Only what actually went is dropped -- anything the fold refused to
    // merge stays queued and takes its own turn, and every other
    // conversation's rows stay where they are.
    setQueued(rest)
    void startMission(going.text, undefined, { requeue: going })
    return undefined
  }, [queued, front, shownKey, verdict?.kind, queueClock])

  /** The addressed teammate's live run, if they have one: they cannot be given a second. */
  const busyRun = [...runs.values()].find(
    (run) => liveRunIsActive(run) && pickedTeammate !== undefined && ownerOf(run) === pickedTeammate.teammateId
  )

  /*
   * THE CONVERSATION THE BOX QUEUES INTO, AND SHOWS THE QUEUE OF: the live
   * run on screen -- that is the conversation being replied into -- else the
   * addressed teammate's busy run, else the conversation on screen, for what
   * is still waiting there after its run ended. Keyed on the addressed
   * teammate's busy run first, queueing did nothing at all on a fresh
   * profile, where every mission belongs to nobody (steering smoke,
   * 2026-09-05); the teammate's run is the fallback for when the thread on
   * screen is someone else's.
   *
   * One key for both, so what the box shows as NEXT is exactly what typing
   * adds to, and Edit, Discard and Send act on that and nothing else.
   */
  const liveOnScreen = shownKey !== undefined && liveRunIsActive(runs.get(shownKey)) ? shownKey : undefined
  const busyKey = busyRun === undefined ? undefined : [...runs.entries()].find(([, run]) => run === busyRun)?.[0]
  const queueKey = liveOnScreen ?? busyKey ?? shownKey
  const waitingHere = queuedIn(queued, queueKey)
  const waitingRun = queueKey === undefined ? undefined : runs.get(queueKey)
  const waitingVerdict =
    waitingHere[0] === undefined
      ? undefined
      : queuedVerdict({
          running: waitingRun !== undefined && liveRunIsActive(waitingRun),
          phase: waitingRun?.phase,
          onScreen: queueKey === shownKey
        })
  const queuedNote = waitingVerdict?.kind === 'held' ? waitingVerdict.note : undefined

  /**
   * Show a run's thread. A run the shell already knows about is shown as it
   * is, live or not; anything else is reopened from the ledger. A
   * continuation opens stitched -- the root's prompt, the prior run's events,
   * the divider rebuilt from the checkpoint, then this run -- because that is
   * what the durable record says happened.
   */
  /**
   * Point the composer at the conversation now on screen.
   *
   * The route is remembered per teammate, but the composer's own route starts
   * at Codex and nothing moved it when a conversation was reopened -- so a
   * restored Claude thread sat above a composer saying `Codex CLI /
   * account-default`, and the next message would have gone somewhere the
   * person never chose (QA pass, 2026-09-05). What the run actually ran on is
   * in its own record, so it is read from there rather than guessed.
   *
   * Never for a run that is still going: the composer already follows a live
   * run's own route, and moving the controls under a person mid-mission is
   * its own surprise.
   */
  const followRouteOf = (run: LiveRunState | undefined): void => {
    if (run?.data === undefined || liveRunIsActive(run)) return
    setRoute({ runtime: run.data.runtime, model: run.data.model ?? 'account-default' })
    /*
     * The MODE too, from the record, and the effort from the teammate.
     *
     * Opening a conversation used to seed the runtime and model and leave
     * the mode wherever the last screen left it. Colin, 2026-09-16: "ill
     * have stocks convo on auto so it can access the mcp tools, the next
     * time it will be accept edits and fail the mcp call because i dont
     * notice." The conversation's last turn recorded its mode; that is what
     * the next turn should start on. Effort is not recorded per mission, so
     * it follows the teammate's remembered route, which now keeps it.
     */
    const recorded = run.restoredMission?.mode
    if (recorded !== undefined && modeRunsOn(recorded, run.data.runtime, build?.platform)) setMode(recorded)
    const ownerId = run.teammateId ?? (run.data.missionId === undefined ? undefined : missionOwnersRef.current[run.data.missionId])
    const own = ownerId === undefined ? undefined : teammates.find((teammate) => teammate.teammateId === ownerId)?.route
    if (own !== undefined && own.runtime === run.data.runtime) setEffort(own.effort)
  }

  const openMission = (missionId: string): void => {
    // Opening a conversation SHOWS it. Every caller but one used to have to
    // remember `setScreen('workroom')` first, and the sidebar did not -- so
    // from the Missions screen a click lit the row and left you looking at
    // the list, with no thread and no composer (QA pass, 2026-09-05). The
    // screen change belongs to the action, not to each caller.
    setScreen('workroom')
    // Whoever the mission belongs to is who the composer now addresses. Done
    // here rather than in each caller, because the sidebar, the Missions list
    // and a teammate's message in an exchange all arrive through this one
    // function and had disagreed about it. The run's own answer comes first,
    // which is what the header uses, so the two cannot disagree while a run
    // is waiting to be recorded.
    const runHere =
      runs.get(missionId) ?? [...runs.values()].find((run) => run.data?.missionId === missionId)
    setSelectedTeammateId((current) =>
      ownerToSelect(missionId, missionOwnersRef.current, current, runHere?.teammateId)
    )
    // A run that is still starting is listed under its pending key.
    if (runs.has(missionId)) {
      setShownKey(missionId)
      followRouteOf(runs.get(missionId))
      return
    }
    const known = [...runs.entries()].find(([, run]) => run.data?.missionId === missionId)
    if (known !== undefined) {
      setShownKey(known[0])
      followRouteOf(known[1])
      return
    }
    const mission = historyById.get(missionId)
    if (mission === undefined) return
    const reopened = reopenedRun(mission, historyById)
    setSelectedTeammateId((current) => ownerToSelect(missionId, missionOwnersRef.current, current))
    setRuns((current) => withNewRun(current, mission.runId, reopened))
    setShownKey(mission.runId)
    followRouteOf(reopened)
  }

  /**
   * Delete the shown mission's record for good. The host refuses while it is
   * live, and that refusal is shown rather than swallowed. On success the
   * mission leaves every list it was in and the thread empties, because
   * showing a thread whose record is gone would be showing a ghost.
   */
  /**
   * The conversation on screen, when it can be saved as a routine.
   *
   * Absent rather than disabled -- see `savableMissionId`. The draft check is
   * the same one the right-click menu makes, so the two entrances can never
   * disagree about whether there is anything to save.
   */
  const saveAsRoutineId = savableMissionId({
    missionId: liveRun?.data?.missionId,
    phase: liveRun?.phase,
    running,
    hasDraft:
      liveRun?.data?.missionId !== undefined && routineDraftFor(liveRun.data.missionId) !== undefined
  })
  const [deleteError, setDeleteError] = useState<string>()

  /**
   * Hand this finished mission to another teammate to be challenged.
   *
   * Astra's proposal, part 2, and it waited for part 1a on purpose: until a
   * turn said what it RAN, a reviewer had nothing to read but the diff, and a
   * second model re-reading a diff is a second opinion about code rather than
   * a check on whether the work was done.
   *
   * Everything the reviewer is given is already on this screen. The brief
   * exists because a teammate cannot see another teammate's conversation, so
   * the facts have to travel -- and because a reviewer told the work passed
   * and then asked to check it has been handed the answer. See reviewBrief.ts.
   */
  const reviewMaterialFor = (run: LiveRunState): ReviewMaterial | undefined => {
    const events = run.events
    if (events.length === 0) return undefined
    const activity = buildThread(events, { running: false }).find((item) => item.type === 'activity')
    const details = activity?.type === 'activity' ? activity.details : []
    const changed = [
      ...new Set(
        details
          .filter((detail) => detail.kind === 'edit' && detail.failed !== true)
          .map((detail) => relativePath(detail.name, workspacePath))
      )
    ]
    // A run the host started carries an assembled briefing as its prompt, so
    // only a person-typed turn can speak for itself.
    const thisTurnAsk = run.startedBy === undefined ? run.prompt : undefined
    const rootAsk = run.earlierTurns?.[0]?.prompt
    const commands = details
      .filter((detail) => detail.kind === 'shell')
      .map((detail) => ({
        name: shellCommandText(detail.name).split('\n')[0]?.trim() ?? detail.name,
        ...(detail.exitCode === undefined ? {} : { exitCode: detail.exitCode })
      }))
    return {
      /*
       * THIS turn's request, and the conversation's opening ask beside it.
       *
       * It was the ROOT request alone, on the reasoning that a continuation's
       * own prompt is the host's briefing -- true for a run the HOST started
       * (a relay hand-off, a routine step, another review), and false for a
       * follow-up a person typed, whose prompt is their words.
       *
       * Astra caught what that cost, 2026-09-14, in a real four-turn
       * conversation: turn one asked "explain git ... don't change any
       * files", turn four asked for two files to be created, and the review
       * of turn four was handed turn ONE as WHAT WAS ASKED FOR. The reviewer
       * was being asked to judge file-creating work against an instruction
       * not to create files -- a mismatch that would make correct work read
       * as a violation.
       */
      request: thisTurnAsk ?? rootAsk ?? run.prompt,
      ...(rootAsk !== undefined && thisTurnAsk !== undefined && rootAsk.trim() !== thisTurnAsk.trim()
        ? { openedWith: rootAsk }
        : {}),
      // The reply, which for research or a question IS the work. Its absence
      // is what made a reviewer say "the work is missing entirely" about a
      // page of analysis on 2026-09-13.
      said: turnText(events),
      changed,
      commands: commands.map((command) => ({ name: command.name, exitCode: command.exitCode })),
      /*
       * What the CONVERSATION built, not just this turn.
       *
       * `changed` above is this run's events alone, which is the whole work
       * only when the conversation is one turn long. A teammate that created
       * a file on turn two and adjusted it on turn four had its turn four
       * reviewed against a single path, and a reviewer asked whether the
       * request and the evidence agree says -- correctly, on what it was
       * shown -- that they do not.
       *
       * Read from the same `earlierTurns` the thread draws, so this costs no
       * new source of truth, and handed over as its own labelled list rather
       * than merged, so the reviewer can still tell which turn is its job.
       */
      changedEarlier: [
        ...new Set(
          (run.earlierTurns ?? []).flatMap((turn) => {
            const earlier = buildThread(turn.events, { running: false }).find((item) => item.type === 'activity')
            const theirs = earlier?.type === 'activity' ? earlier.details : []
            return theirs
              .filter((detail) => detail.kind === 'edit' && detail.failed !== true)
              .map((detail) => relativePath(detail.name, workspacePath))
          })
        )
      ],
      ranOn: ranOnLine({
        platform: window.desktop?.platform ?? '',
        ...(folderName(workspacePath) === undefined ? {} : { folder: folderName(workspacePath)! })
      }),
      author: teammates.find((entry) => entry.teammateId === ownerOf(run))?.name ?? 'A teammate'
    }
  }

  /** Every teammate who could review this one -- anyone but its author. */
  const reviewersFor = (run: LiveRunState | undefined): readonly PublicTeammate[] =>
    run === undefined ? [] : teammates.filter((entry) => entry.teammateId !== ownerOf(run))

  const askForReview = (run: LiveRunState, reviewer: PublicTeammate): void => {
    const material = reviewMaterialFor(run)
    if (material === undefined) return
    selectTeammate(reviewer.teammateId)
    // After the teammate is selected, so the run is started as theirs. The
    // same path a person's own message takes -- a review is an ordinary
    // mission of the reviewer's, on their own route, in their own thread.
    setTimeout(() => void startMission(reviewBrief(material)), 0)
  }
  /**
   * What a row action just did, when it worked.
   *
   * A refusal has had somewhere to appear since 2026-09-05. Success had
   * nowhere, and that is the other half of the same complaint: assigning a
   * conversation moves a row in a list you may not be looking at, so a
   * successful assign and a failed one look identical from the composer --
   * "i right clicked it and hit assign to wren, nothing happened" (Colin,
   * 2026-09-08, on a build where assign demonstrably worked).
   */
  const [rowNotice, setRowNotice] = useState<string>()
  // It confirms a thing that already happened, so it goes away on its own. A
  // standing green line would become furniture, and furniture is not read.
  useEffect(() => {
    if (rowNotice === undefined) return
    const clear = window.setTimeout(() => setRowNotice(undefined), 4_000)
    return () => window.clearTimeout(clear)
  }, [rowNotice])
  /*
   * The trash, from the window's side.
   *
   * A restore has to put the conversation back where a person looks for it,
   * and that is two reads: the history the sidebar is built from, and the
   * roster that carries who owns it and what it was renamed to. Neither is
   * derivable from the other.
   */
  const listTrash = async (): Promise<TrashListResponse> => {
    const bridge = window.desktop
    if (!bridge) return { ok: false, error: { code: 'STORAGE_UNAVAILABLE', message: 'The trash could not be read. Nothing in it has been deleted for good.' } }
    return bridge.listTrashedMissions()
  }

  const restoreMission = async (missionId: string): Promise<TrashMutationResponse> => {
    const bridge = window.desktop
    if (!bridge) return { ok: false, error: { code: 'INTERNAL_ERROR', message: 'That conversation could not be put back. It is still in the trash.' } }
    const response = await bridge.restoreMission(missionId)
    if (response.ok) {
      refreshHistory()
      void bridge
        .listTeammates()
        .then((roster) => {
          if (!roster.ok) return
          setMissionOwners(roster.data.missionOwners)
          setMissionTitles(roster.data.missionTitles)
        })
        .catch(() => undefined)
    }
    return response
  }

  const emptyTrash = async (): Promise<TrashMutationResponse> => {
    const bridge = window.desktop
    if (!bridge) return { ok: false, error: { code: 'INTERNAL_ERROR', message: 'The trash was not emptied. Everything in it is still there.' } }
    return bridge.emptyTrash()
  }

  const deleteMissionById = (missionId: string): void => {
    const bridge = window.desktop
    if (!bridge) return
    void bridge
      .deleteMission(missionId)
      .then((response) => {
        if (!response.ok) {
          setDeleteError(response.error.message)
          return
        }
        setDeleteError(undefined)
        setRuns((current) => {
          const next = new Map(current)
          for (const [key, run] of current) if (run.data?.missionId === missionId) next.delete(key)
          return next
        })
        setHistory((current) => current.filter((mission) => mission.missionId !== missionId))
        setMissionOwners((current) => {
          const { [missionId]: _gone, ...rest } = current
          return rest
        })
        setShownKey((current) => {
          const shown = current === undefined ? undefined : runsRef.current.get(current)
          // Only the thread that was deleted closes. Deleting a row from the
          // sidebar must not take the workroom with it.
          return shown?.data?.missionId === missionId ? undefined : current
        })
        void refreshStorage()
      })
      .catch(() => {
        setDeleteError('The mission could not be deleted. Its record and events are still here.')
      })
  }

  /** Address a teammate, and look at what they are doing (or their idle state). */
  const selectTeammate = (teammateId: string): void => {
    setSelectedTeammateId(teammateId)
    setScreen('workroom')
    // Picking a teammate picks their route: the composer shows the runtime,
    // model and mode they last ran on, so a person is not re-choosing a
    // model every time they switch who they are talking to.
    const own = teammates.find((teammate) => teammate.teammateId === teammateId)?.route
    if (own !== undefined) {
      setRoute({ runtime: own.runtime, model: own.model })
      setMode(own.mode)
      /*
       * Including the effort, which this used to drop.
       *
       * `TeammateRoute` carries one, and its own docstring says why -- "how
       * hard the model was asked to think is part of how it ran". Picking the
       * teammate restored their runtime, model and mode and then silently
       * reset the effort to the model's default, so a teammate saved at `low`
       * ran at `medium` every time they were selected. Seen while driving
       * approve-each on 2026-09-08: the seed said `low`, the composer said
       * `medium`, and the run cost more than it was asked to.
       *
       * This is the same shape as the bug `routine-store.ts` guards against by
       * naming every field it copies -- an object rebuilt field by field
       * quietly loses anything nobody remembered. `undefined` is a real value
       * here: a teammate on a runtime with no levels must CLEAR the effort,
       * not inherit the last one.
       */
      setEffort(own.effort)
    }
    const theirs = [...runs.entries()].filter(([, run]) => ownerOf(run) === teammateId)
    const startedAt = (run: LiveRunState): number =>
      Date.parse(run.restoredMission?.lastUpdatedAt ?? run.events[0]?.occurredAt ?? '') || 0
    const newest = [...theirs].sort(([, left], [, right]) => startedAt(right) - startedAt(left))[0]
    const live = theirs.find(([, run]) => liveRunIsActive(run)) ?? newest
    setShownKey(live?.[0])
  }

  /**
   * A blank page with that teammate on it.
   *
   * "New conversation with Jimothy" called `selectTeammate`, which ends by
   * showing that teammate's newest conversation -- and since you reach the
   * control by clicking their avatar, they were already selected and their
   * newest conversation was already open. So the button did nothing at all
   * (Colin, 2026-09-14: "this new convo button does nothing").
   *
   * Selecting them takes their route, model, mode and effort, which is what
   * a new conversation with them should start on; then the conversation
   * itself is cleared, which is the part that was missing.
   */
  const newConversationWith = (teammateId: string): void => {
    selectTeammate(teammateId)
    setShownKey(undefined)
  }

  /**
   * A face's click: their hub, or them.
   *
   * The hub is the conversation their replies to other teammates land in,
   * recorded by the host as its newest turn. It is opened through the
   * sidebar's own row for it when one is listed -- the same path a click on
   * the row takes -- so the thread shows the whole conversation and not
   * just the turn the host happened to record. A teammate with no hub yet
   * has nothing to open, so the click addresses them, as it always did.
   */
  const openHub = (teammateId: string): void => {
    const hub = teammates.find((teammate) => teammate.teammateId === teammateId)?.hubMissionId
    if (hub === undefined) {
      selectTeammate(teammateId)
      return
    }
    const row = sidebarMissionsRef.current.find((entry) => (entry.memberIds ?? [entry.missionId]).includes(hub))
    openMission(row?.missionId ?? hub)
  }

  const sidebarMissionsRef = useRef<readonly SidebarMission[]>([])
  // The right-click menus are built outside render, so they read the roster
  // and the routines through refs the same way they read the rows.
  const teammatesRef = useRef<readonly PublicTeammate[]>([])
  const routinesRef = useRef<readonly PublicRoutine[]>([])
  const sidebarMissions = useMemo<readonly SidebarMission[]>(() => {
    const rows: SidebarMission[] = []
    for (const [key, run] of runs.entries()) {
      // A send the host REFUSED never became a mission. It was assigned no
      // id and it has already settled, so listing it here files a permanent
      // row under a key like `pending:3` -- a thing that looks like a mission,
      // answers "Copy mission id" with a lie, and can never be reopened.
      // Codex's QA pass on 0.14 caught this as a prompt that "appeared
      // submitted" but "was never recorded as a mission". The refusal still
      // shows in the thread, which is where a person is looking when it
      // happens; what it must not do is accumulate.
      if (!listedAsMission({ missionId: run.data?.missionId, active: liveRunIsActive(run) })) continue
      // A run that is still starting has no missionId yet; it is listed under
      // its pending key so the teammate reads as working from the first
      // moment, not from the first receipt.
      const missionId = run.data?.missionId ?? key
      if (rows.some((row) => row.missionId === missionId)) continue
      // A live reply already holds the turns before it, so its chain is
      // known without waiting for the ledger to be re-read.
      const earlier = run.earlierTurns ?? []
      // A handoff's continuation knows the mission it continues from its
      // start data, before the ledger is re-read. Without it the pair sat
      // in the sidebar as two rows with one title (seen driving the app,
      // 2026-09-05); the root is resolved through history when it is there.
      const handoffFrom = (run.data as { continuesFrom?: { missionId: string } } | undefined)?.continuesFrom?.missionId
      const handoffRoot = handoffFrom === undefined
        ? undefined
        : historyById.get(handoffFrom) === undefined ? handoffFrom : rootMission(historyById.get(handoffFrom)!, historyById).missionId
      /*
       * THE RECORD OUTRANKS WHAT THE RUN REMEMBERS ABOUT ITS CHAIN.
       *
       * A live run takes its idea of the turns before it when it is opened,
       * and never revisits it. Grok, passes 9 and 10: seed a two-turn
       * conversation, delete the first turn, OPEN the surviving one, put the
       * first turn back. The record now holds both turns again; the open run
       * still remembers having no parent, so the sidebar draws two rows for
       * one conversation -- and a person who then tidies the "duplicate"
       * loses half of it for good. The drive that skipped the open step
       * never saw this. So when the ledger knows this mission, the chain
       * comes from the ledger; what the run remembers is only for a turn
       * the ledger has not been re-read for yet.
       */
      const recorded = historyById.get(missionId)
      const rootId = recorded === undefined
        ? earlier[0]?.missionId ?? handoffRoot
        : rootMission(recorded, historyById).missionId
      const parentId = recorded === undefined
        ? earlier.at(-1)?.missionId ?? handoffFrom
        : recorded.continuesFrom?.missionId
      // A routine's own step says so; a person's reply inside a routine's
      // conversation is known by the conversation's first turn.
      const routineId = routineOf(run.startedBy) ?? routineOf(rootId === undefined ? undefined : historyById.get(rootId)?.startedBy)
      rows.push({
        missionId,
        ...(rootId === undefined ? {} : { rootId }),
        ...(parentId === undefined ? {} : { parentId }),
        ...(routineId === undefined ? {} : { routineId }),
        ...(run.teammateId === undefined ? {} : { ownerId: run.teammateId }),
        /*
         * When this run started, or when the mission it restored last moved.
         *
         * `startedAtIso` is stamped when WE start a run, so a run that was
         * restored from the ledger rather than started has none -- and the
         * newest conversation is precisely the one the app restores on
         * launch. In the nested sidebar that cost nothing, because rows were
         * grouped by teammate and the age was not drawn. In a list ordered
         * most-recent-first it put the most recent conversation LAST, with
         * no age beside it, which is the one row the ordering exists to put
         * at the top. Seen on the first drive of the flat list, 2026-09-15.
         */
        ...(run.startedAtIso ?? run.restoredMission?.lastUpdatedAt) === undefined
          ? {}
          : { lastAt: (run.startedAtIso ?? run.restoredMission?.lastUpdatedAt)! },
        // A run's thread already shows the root's words for a continuation.
        // A relayed run's prompt is the host's briefing to a runtime, never a
        // sentence to name a conversation with.
        title: missionTitle(relayedTitle({ ...run, peerMessages: run.peerMessages ?? [] }) ?? run.prompt),
        phase: liveRunIsActive(run) ? 'running' : isTerminal(run.phase) ? (run.phase as 'completed' | 'failed' | 'cancelled') : 'interrupted',
        ...(run.data?.runtime === undefined ? {} : { runtime: run.data.runtime }),
        integrityIssueCount: run.restoredMission?.integrityIssueCount ?? 0
      })
    }
    for (const mission of history) {
      if (rows.some((row) => row.missionId === mission.missionId)) continue
      // The sidebar is this folder's work. Missions from other folders stay in
      // the ledger and on the Missions screen, which is the whole archive --
      // listing them here put another project's conversations in the sidebar
      // of this one. Measured 2026-09-03 by opening a second project.
      if (workspaceId !== undefined && mission.workspaceId !== workspaceId) continue
      rows.push({
        missionId: mission.missionId,
        // A continuation's own prompt is the briefing; name it by the words
        // the person typed at the start of the chain.
        title: missionTitle(
          relayedTitle(rootMission(mission, historyById)) ?? rootMission(mission, historyById).prompt
        ),
        rootId: rootMission(mission, historyById).missionId,
        ...(mission.continuesFrom === undefined ? {} : { parentId: mission.continuesFrom.missionId }),
        ...(routineOf(rootMission(mission, historyById).startedBy) === undefined
          ? {}
          : { routineId: routineOf(rootMission(mission, historyById).startedBy)! }),
        phase: mission.phase,
        runtime: mission.runtime,
        integrityIssueCount: mission.integrityIssueCount,
        lastAt: mission.lastUpdatedAt
      })
    }
    // One row per conversation. The ledger still holds one mission per run;
    // this is only how the exchange is listed.
    /*
     * A name someone typed wins over the one derived from their first
     * sentence -- applied AFTER the collapse and keyed by `rootId`, because
     * the thing being named is the conversation and not the turn. Naming a
     * reply and having only that reply change its name would be a rename
     * that did not do what it said.
     *
     * Applied here rather than in the sidebar so every surface agrees: the
     * header, the search that filters on `title`, and the row all read the
     * same string.
     */
    return collapseConversations(rows).map((row) => {
      // Asked for under every id this conversation has worn, not only its
      // root -- a name typed while the row was keyed by a live turn was
      // stored against that turn and is otherwise never found again.
      const chosen = heldFor(row, missionTitles)
      return chosen === undefined ? row : { ...row, title: chosen }
    })
  }, [history, historyById, runs, workspaceId, missionTitles])
  // The right-click menu is built outside render and names the row it was
  // opened on, so it reads the rows through this.
  /*
   * The menu is built outside render, so it reads groups through refs for
   * the same reason it reads rows and teammates through them.
   */
  groupsRef.current = groups
  groupMembersRef.current = groupMembers
  sidebarMissionsRef.current = sidebarMissions
  teammatesRef.current = teammates
  routinesRef.current = routines
  historyByIdRef.current = historyById
  missionOwnersRef.current = missionOwners
  // What each teammate's live run is doing, from its events -- the same
  // function the thread's working line uses, so the two cannot disagree.
  const liveActivityByOwner: Record<string, LiveActivity> = {}
  for (const run of runs.values()) {
    const owner = ownerOf(run)
    if (owner !== undefined && liveRunIsActive(run)) liveActivityByOwner[owner] = liveActivityOf(run.events, true)
  }

  /**
   * What the conversation header's `⋯` offers, built where the things it
   * needs already are.
   *
   * Each entry is present only where it is TRUE, which is the rule the four
   * buttons kept and the menu inherits: there is nothing to explain about an
   * action with no material, so a review with nobody to ask and a routine
   * with nothing to save are absent rather than greyed. An empty list draws
   * no button at all.
   */
  const headerActions: ContextMenuItem[] = []
  if (liveRun !== undefined && !running) {
    for (const reviewer of reviewersFor(liveRun)) {
      headerActions.push({
        label: `Ask ${reviewer.name} for a review`,
        onSelect: () => askForReview(liveRun, reviewer)
      })
    }
  }
  if (saveAsRoutineId !== undefined) {
    headerActions.push({ label: 'Save conversation as routine', onSelect: () => openSaveRoutine(saveAsRoutineId) })
  }
  /*
   * SEND FEEDBACK about this conversation -- Claude Code's box (Colin: "for
   * bug reporting we can use what claude code does"), carrying what was said
   * here, which is what a report about it needs. Words only (feedback.ts).
   */
  if (liveRun !== undefined) {
    const shown = liveRun
    headerActions.push({
      label: 'Send feedback',
      onSelect: () => {
        const turns = [
          ...(shown.earlierTurns ?? []).map((turn) => ({ prompt: turn.prompt, events: turn.events })),
          { prompt: shown.prompt, events: shown.events }
        ]
        const runtime = shown.data?.runtime ?? shown.runtime ?? 'codex'
        const model = shown.data?.model
        const speaker = `${missionOwner?.name ?? 'The teammate'} (${runtimeDisplayName(runtime)}${model === undefined || model.length === 0 ? '' : `, ${modelDisplayName(runtime, model)}`})`
        setFeedbackFor({ conversation: conversationText(turns, speaker) })
      }
    })
  }
  if (!running && liveRun?.data?.missionId !== undefined) {
    const shownId = liveRun.data.missionId
    headerActions.push({
      label: 'Delete conversation',
      confirmLabel: 'Delete for good?',
      danger: true,
      onSelect: () => {
        setDeleteError(undefined)
        // Every turn of the conversation on screen, not just the one whose
        // id the header carries. Deleting the last turn and leaving the row
        // reads as the control doing nothing (Colin, 2026-09-05).
        const row = sidebarMissionsRef.current.find((entry) =>
          (entry.memberIds ?? [entry.missionId]).includes(shownId)
        )
        for (const turn of row?.memberIds ?? [shownId]) deleteMissionById(turn)
      }
    })
  }

  const noRuntimeReady =
    runtimeState.phase !== 'ready' || !runtimes.some((runtime) => runtime.ready && runtime.status === 'ready')
  /*
   * WHAT'S NEW, AND THE SPLASH.
   *
   * The home banner ("Locust 0.277.0 is running. Here is what changed.") is
   * gone -- Colin: "it adds a needless scrollbar on that title menu" -- and the
   * whole changelog lives in Settings as What's new. After an update, the
   * home screen says anything only when a build since the last one seen is
   * marked big ("if we have really good big updates where the user has to
   * know things, we can have a splash page on update"), and then once.
   *
   * Held to the banner's old conditions: Home (no conversation on screen)
   * with a runtime ready -- nothing interrupts a person talking, and a launch
   * whose runtimes are still signed out does not spend the one showing.
   */
  const [splashClosed, setSplashClosed] = useState(false)
  const [settingsLanding, setSettingsLanding] = useState<SettingsPageId | undefined>(undefined)
  const splashEntries = changelog?.firstRun === true ? (changelog.splash ?? []) : []
  const splashOpen = splashEntries.length > 0 && !splashClosed && screen === 'workroom' && !noRuntimeReady && shownKey === undefined
  // The landing is for the one opening "See every version" asked for.
  useEffect(() => {
    if (screen !== 'settings') setSettingsLanding(undefined)
  }, [screen])
  /*
   * The version is marked seen when the splash is actually on screen -- or,
   * on an update with nothing big, when Home first is -- and once. It was
   * once marked when the changelog was READ, at mount, so a banner held for
   * a runtime to connect was never shown after a relaunch either (Fable,
   * pass 1, finding 7).
   */
  const changelogMarked = useRef(false)
  useEffect(() => {
    if (changelogMarked.current) return
    if (screen !== 'workroom' || noRuntimeReady || changelog?.firstRun !== true) return
    if (splashEntries.length > 0 && !splashOpen) return
    changelogMarked.current = true
    void window.desktop?.markChangelogSeen().catch(() => undefined)
  }, [screen, noRuntimeReady, changelog, splashEntries.length, splashOpen])

  // Whose mission is on screen: the owner the host recorded, never the
  // composer's current target, which may already be someone else.
  const missionOwner =
    liveRun === undefined
      ? undefined
      : teammates.find((teammate) => teammate.teammateId === ownerOf(liveRun))
  const shownRunId = liveRun?.data?.runId
  /**
   * The one line under a mission's title on the Missions screen.
   *
   * Read from the same places the thread reads: the run's pending approval,
   * then its live line. Nothing invented for it, and nothing at all for a
   * mission that has settled -- a list where every row carries a sentence is
   * a list nobody scans.
   *
   * Grok Build's dashboard row does the same thing and says why in its own
   * source: the secondary line holds "the last tool call, the last assistant
   * message, or a 'Pending: ...' preview of the front-most permission
   * request". Twelve rows reading RUNNING tell you which to open only by
   * opening them.
   */
  const liveTurnOf = (missionId: string): LiveTurn | undefined => {
    const run = [...runs.values()].find((entry) => entry.data?.missionId === missionId)
    if (run === undefined || !liveRunIsActive(run)) return undefined
    const live = buildThread(run.events, { running: true, ...(run.startedAtIso === undefined ? {} : { startedAt: run.startedAtIso }) })
      .find((item) => item.type === 'live-step')
    if (live === undefined || live.type !== 'live-step') return undefined
    return {
      register: live.register,
      label: live.label,
      detail: live.detail,
      startedAt: live.startedAt,
      // The same rule the thread uses: the dots mean waiting on the model
      // with nothing to show, which is a reasoning step or a gap between
      // steps -- not a tool that is visibly running.
      thinking: live.waiting === true || live.register === 'thinking'
    }
  }

  const missionDoing = (missionId: string): string | undefined => {
    const waiting = approvals.find((request) => request.missionId === missionId)
    // What it wants beats what it is doing: a run that stopped to ask is not
    // doing anything, and that is the row a person is looking for.
    if (waiting !== undefined) return `Pending: ${waiting.summary}`
    const live = liveTurnOf(missionId)
    if (live === undefined) return undefined
    const word = REGISTER_WORD[live.register]
    const said =
      live.label === undefined || /^(thinking|working|starting)$/i.test(live.label.trim()) ? undefined : live.label.trim()
    return [word, said, live.detail].filter((part) => part !== undefined && part.length > 0).join(' · ')
  }

  /**
   * Every mission the Missions screen should list: the recorded ones, and the
   * ones happening RIGHT NOW.
   *
   * MEASURED 2026-09-11 (`probe-missions-say-what-they-want`): for 49
   * consecutive samples a teammate was visibly working in the sidebar and
   * this screen was empty. The list is built from the ledger, and a mission
   * reaches the ledger when it is recovered -- so the one screen in the app
   * whose job is "what is going on" was the last place to hear about it.
   *
   * A live run is not a recovered mission and cannot pretend to be one: it
   * has no checkpoints, no integrity count and no terminal phase. What it
   * does have is everything a ROW needs -- who, what was asked, which route,
   * when it started -- so that is what is filled in, and the fields a row
   * never reads stay empty rather than being invented.
   */
  const missionsToList = useMemo((): readonly PublicRecoveredMission[] => {
    const recorded = new Set(history.map((mission) => mission.missionId))
    const live: PublicRecoveredMission[] = []
    for (const run of runs.values()) {
      const data = run.data
      if (data === undefined || !liveRunIsActive(run) || recorded.has(data.missionId)) continue
      const startedAt = run.startedAtIso ?? run.events[0]?.occurredAt ?? new Date().toISOString()
      live.push({
        missionId: data.missionId,
        runId: data.runId,
        workspaceId: workspaceId ?? '',
        prompt: run.prompt,
        runtime: data.runtime,
        model: data.model ?? 'account-default',
        requestedRouteId: data.resolvedRouteId,
        resolvedRouteId: data.resolvedRouteId,
        cliVersion: data.cliVersion ?? null,
        createdAt: startedAt,
        lastUpdatedAt: run.events.at(-1)?.occurredAt ?? startedAt,
        // A live run has not ended, and every value this field can take is an
        // ending. `interrupted` is the one that does not claim it finished;
        // the row's own tag comes from `runningMissionIds` regardless.
        phase: 'interrupted',
        events: run.events,
        eventCount: run.events.length,
        eventsTruncated: false,
        integrityIssueCount: 0,
        sandbox: data.sandbox,
        checkpoints: [],
        peerMessages: run.peerMessages ?? []
      })
    }
    // Most recently ACTIVE first, not most recently started: a conversation
    // that has been working for an hour belongs above one that opened five
    // minutes ago and has said nothing since. grok-build's `last_progress_at`,
    // and the reason it is their dashboard's sort key.
    return [
      ...live.sort((a, b) => lastActivityAt(b).localeCompare(lastActivityAt(a))),
      ...history
    ]
  }, [history, runs, workspaceId])

  const shownApprovals = approvals.filter((request) => request.runId === shownRunId)
  const pendingApprovalsByOwner = new Map<string, number>()
  for (const request of approvals) {
    const run = runs.get(request.runId)
    const owner = run === undefined ? undefined : ownerOf(run)
    if (owner !== undefined) pendingApprovalsByOwner.set(owner, (pendingApprovalsByOwner.get(owner) ?? 0) + 1)
  }
  // Which teammate is replaying a routine, and which step it is on. DERIVED
  // from the runs that are actually live rather than tracked alongside them:
  // a step that ended stops being reported because its run stopped running,
  // so the label can never outlive the work it describes.
  const routineStepByTeammate: Record<string, { readonly name: string; readonly step: number; readonly of: number }> = {}
  for (const run of runs.values()) {
    const startedBy = run.startedBy
    if (!liveRunIsActive(run) || startedBy?.kind !== 'routine' || run.teammateId === undefined) continue
    const routine = routines.find((entry) => entry.routineId === startedBy.routineId)
    if (routine === undefined) continue
    routineStepByTeammate[run.teammateId] = {
      name: routine.name,
      step: startedBy.step,
      of: routine.steps.length
    }
  }
  /*
   * And each teammate's state, decided once here with the same inputs the
   * sidebar uses, for the surfaces that do not compute their own.
   *
   * The WHOLE view, not just `.activity`. Keeping only the activity is what
   * left the Team roster with no presence dot at all -- not a roster that
   * chose not to draw one, a roster that was never handed the fact (Grok's
   * audit, 2026-09-13). A teammate blocked on a sign-in looked, on the one
   * screen that is entirely about teammates, exactly like a teammate with
   * nothing to do.
   */
  const viewByTeammate: Record<string, TeammateStatusView> = {}
  for (const teammate of teammates) {
    const owned = sidebarMissions.filter(
      (mission) => (mission.ownerId ?? missionOwners[mission.missionId]) === teammate.teammateId
    )
    // One resolver for every surface; see `runtimeOfTeammate`.
    const theirRuntime = runtimeOfTeammate(teammate, owned)
    viewByTeammate[teammate.teammateId] = teammateStatusView({
      runtime: theirRuntime === undefined ? undefined : runtimes.find((entry) => entry.id === theirRuntime),
      anyRuntimeUsable: runtimes.some(runtimeIsUsable),
            anyRuntimeInstalled: runtimes.some((entry) => entry.installed),
      /*
       * Starting counts as working, because the sidebar says so.
       *
       * This map and the sidebar row called the SAME function with different
       * inputs, and so gave different answers for the same teammate. Grok
       * measured it in 0.116.0: title bar "1 running", sidebar Booty with a
       * green ring reading "working", and the Team card beside it with no
       * ring at all.
       *
       * I put that gap in. 0.109.0 gave the roster a presence dot and this
       * map to draw it from, and the map was a THIRD assembly of a fact that
       * already had two -- exactly the class Grok's first audit was about.
       * The sidebar consumes this map now rather than computing its own, so
       * there is one answer per teammate and the surfaces cannot disagree.
       */
      hasRunningMission:
        owned.some((mission) => mission.phase === 'running') || Object.keys(relayStarting).includes(teammate.teammateId),
      pendingApprovals: pendingApprovalsByOwner.get(teammate.teammateId) ?? 0,
      roleLabel: roleLabelOf(teammate),
      ...(liveActivityByOwner[teammate.teammateId] === undefined ? {} : { liveActivity: liveActivityByOwner[teammate.teammateId] }),
      recentlyDone: recentlyDone.includes(teammate.teammateId),
      recentlyReceived: recentlyReceived.includes(teammate.teammateId)
    })
  }

  /*
   * The workroom header's teammate, resolved ONCE.
   *
   * Both the face and the dot beside it are this teammate's state, so both
   * read it from here. They used to be assembled separately in the JSX and
   * had already drifted -- see the `presence` prop below.
   */
  const workroomOwnerView =
    missionOwner === undefined
      ? undefined
      : teammateStatusView({
          runtime: runtimes.find((entry) => entry.id === liveRun?.data?.runtime),
          anyRuntimeUsable: runtimes.some(runtimeIsUsable),
            anyRuntimeInstalled: runtimes.some((entry) => entry.installed),
          hasRunningMission: running,
          pendingApprovals: shownApprovals.length,
          roleLabel: roleLabelOf(missionOwner),
          ...(liveActivityByOwner[missionOwner.teammateId] === undefined
            ? {}
            : { liveActivity: liveActivityByOwner[missionOwner.teammateId] }),
          recentlyDone: recentlyDone.includes(missionOwner.teammateId),
          recentlyReceived: recentlyReceived.includes(missionOwner.teammateId)
        })

  /*
   * `has-inspector` is what insets the workroom so the drawer does not cover
   * the composer -- which cost a release to get right at 1120x720 (0.187.0).
   * The file viewer shares that region, so it shares the class: one inset
   * rule, whichever of the two is occupying the space.
   */
  return (
    <div className={`lc-shell${layoutMode === 'compact' ? ' is-compact' : ''}${(viewingFile !== undefined || viewerRefusal !== undefined) && screen === 'workroom' ? ' has-viewer' : inspectorOpen && liveRun !== undefined && screen === 'workroom' ? ' has-inspector' : ''}`}>
      <TitleBar
        // With no folder the composer chip already says so; the bar shows the
        // build instead (Colin, 2026-09-05).
        workspaceName={workspaceName.length === 0 ? `Locust${build === undefined ? '' : ` ${build.version}`}` : workspaceName}
        runningCount={runningCount}
        swarm={swarm}
      />
      <div className="lc-body">
        {rowMenu !== undefined && (
          <ContextMenu
            state={rowMenu}
            armedLabel={rowMenuArmed}
            onArm={setRowMenuArmed}
            onClose={() => {
              setRowMenu(undefined)
              setRowMenuArmed(undefined)
            }}
          />
        )}
        <Sidebar
          runtimes={runtimes}
          routines={routines}
          onOpenAutomations={() => setScreen('automations')}
          missions={sidebarMissions}
          compact={layoutMode === 'compact'}
          teammates={teammates}
          routineStepByTeammate={routineStepByTeammate}
          missionOwners={missionOwners}
          selectedMissionId={liveRun?.data?.missionId ?? shownKey}
          // Highlight the pick, not the fallback: with nobody picked the
          // first teammate read as chosen while the composer addressed
          // nobody (user session, 2026-09-05).
          selectedTeammateId={pickedTeammate?.teammateId}
          onSelectMission={openMission}
          onMissionMenu={openMissionMenu}
          groups={groups}
          groupMembers={groupMembers}
          unreadableConversations={unreadableLedgers}
          unreadable={unreadableStores}
          onGroupMenu={openGroupMenu}
          renamingGroupId={renamingGroupId}
          onRenameGroup={(groupId, name) => {
            void window.desktop?.renameGroup(groupId, name).then(refreshGroups)
          }}
          onGroupRenameDone={() => setRenamingGroupId(undefined)}
          namingGroup={namingGroup}
          onStartNamingGroup={() => {
            // From the `+`, the new group takes no conversation with it.
            setNewGroupFor(undefined)
            setNamingGroup(true)
          }}
          onNamingGroupDone={() => {
            setNamingGroup(false)
            setNewGroupFor(undefined)
          }}
          onNewGroup={(name) => {
            const waiting = newGroupFor
            setNewGroupFor(undefined)
            void window.desktop
              ?.createGroup(name)
              .then(async (made) => {
                /*
                 * The store answers with `{}` rather than the group, so the
                 * one just made is found by name from a fresh read. Names
                 * are not unique, so the NEWEST match wins -- making a
                 * second group called "Trading" must move the conversation
                 * into the one that was just created, not the older one.
                 */
                if (!made.ok || waiting === undefined) return
                const listed = await window.desktop?.listGroups()
                if (listed?.ok !== true) return
                const mine = listed.data.groups
                  .filter((group) => group.name === name.trim())
                  .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0]
                if (mine !== undefined) await window.desktop?.assignGroup(waiting, mine.groupId)
              })
              .finally(refreshGroups)
          }}
          renamingMissionId={renamingMissionId}
          onRenameMission={(missionId, title) => void renameMission(missionId, title)}
          onRenameDone={() => setRenamingMissionId(undefined)}
          onTeammateMenu={openTeammateMenu}
          rooms={rooms}
          currentRoomId={screen === 'rooms' ? currentRoomId : undefined}
          onOpenRoom={(roomId) => {
            setRoomNotice(undefined)
            setCurrentRoomId(roomId)
            setScreen('rooms')
          }}
          onOpenRooms={() => {
            setRoomNotice(undefined)
            setCurrentRoomId(undefined)
            setScreen('rooms')
          }}
          onHome={() => {
            setSelectedTeammateId(undefined)
            setShownKey(undefined)
            setRoomNotice(undefined)
            setScreen('workroom')
          }}
          pendingApprovals={Object.fromEntries(pendingApprovalsByOwner)}
          liveActivity={liveActivityByOwner}
          viewByTeammate={viewByTeammate}
          starting={Object.keys(relayStarting)}
          recentlyDone={recentlyDone}
          recentlyReceived={recentlyReceived}
          handoffs={handoffs}
          onSelectTeammate={selectTeammate}
          onNewConversationWith={newConversationWith}
          onOpenHub={openHub}
          onNewTeammate={() => {
            setTeammateError(undefined)
            setNewTeammateOpen(true)
          }}
          composerShown={screen === 'workroom'}
          onOpenSettings={() => {
            refreshWorktrees()
            refreshRuntimeSetup()
            const next = screen === 'settings' ? 'workroom' : 'settings'
            // Read the number when the screen that shows it opens, so it
            // cannot be the one from launch.
            if (next === 'settings') refreshStorage()
            setScreen(next)
          }}
          onOpenMissions={() => setScreen(screen === 'missions' ? 'workroom' : 'missions')}
          onOpenTeammates={() => setScreen(screen === 'teammates' ? 'workroom' : 'teammates')}
        />
        <main className="lc-workroom">
          {screen === 'missions' ? (
            <MissionsScreen
              missions={missionsToList}
              unreadableLedgers={unreadableLedgers}
              ledgerUnreadable={ledgerUnreadable}
              workspaceId={workspaceId}
              runningMissionIds={
                new Set(
                  [...runs.values()]
                    .filter((run) => liveRunIsActive(run) && run.data !== undefined)
                    .map((run) => run.data!.missionId)
                )
              }
              titleOf={(mission) => missionTitle(typedPrompt(mission, historyById))}
              secondaryOf={missionDoing}
              /*
               * One at a time, through the same path a single delete takes.
               * The host refuses a live mission per id, so a batch that
               * happens to contain one loses that one and keeps the rest,
               * rather than the whole batch failing on its account.
               */
              onDeleteMissions={(missionIds) => {
                for (const missionId of missionIds) deleteMissionById(missionId)
              }}
              teammates={teammates}
              missionOwners={missionOwners}
              onOpen={openMission}
            />
          ) : screen === 'teammates' ? (
            <TeammatesScreen
              teammates={teammates}
              missions={history}
              missionOwners={missionOwners}
              viewByTeammate={viewByTeammate}
              titleOf={(mission) => missionTitle(typedPrompt(mission, historyById))}
              onOpenMission={openMission}
              routines={routines}
              routineStepByTeammate={routineStepByTeammate}
              onRunRoutine={runRoutine}
              onRecoverRoutine={recoverRoutine}
              onRemoveRoutine={removeRoutine}
              onEditRoutine={editRoutine}
              onNewTeammate={() => {
                setTeammateError(undefined)
                setNewTeammateOpen(true)
              }}
              onEdit={(teammate) => {
                setTeammateError(undefined)
                setEditingTeammate(teammate)
              }}
              onRemove={removeTeammate}
              onMessage={openHub}
            />
          ) : screen === 'memory' ? (
            <MemoryScreen
              memories={memories}
              workspaceId={memoryWorkspace.id}
              workspaceName={memoryWorkspace.name}
              teammates={teammates}
              mode={memoryMode}
              onModeChange={changeMemoryMode}
              onAdd={addMemory}
              onUpdate={updateMemory}
              onRemove={removeMemory}
              onClear={clearMemories}
              // `openMission`, like every other opener. This had its own two
              // lines, and `setShownKey` wants a RUN key -- `runs` is keyed by
              // `run_...` -- so a `mission_...` id matched nothing and the
              // workroom drew its empty home screen with the previous teammate
              // still lit. Reproduced live by an outside QA, 2026-09-06.
              onOpenMission={openMission}
              notice={memoryNotice}
              onDismissNotice={() => setMemoryNotice(undefined)}
            />
          ) : screen === 'automations' ? (
            <AutomationsScreen
              onOpenMission={openMission}
              routines={routines}
              teammates={teammates}
              routineStepByTeammate={routineStepByTeammate}
              onRunRoutine={runRoutine}
              onRecoverRoutine={recoverRoutine}
              onEditRoutine={editRoutine}
              onRemoveRoutine={removeRoutine}
              notice={automationNotice}
              onDismissNotice={() => setAutomationNotice(undefined)}
              // The same rows the sidebar draws. An empty screen offers the
              // finished ones rather than describing how to save one.
              missions={sidebarMissions}
              onSaveRoutine={openSaveRoutine}
            />
          ) : screen === 'rooms' ? (
            <RoomScreen
              rooms={rooms}
              teammates={teammates}
              currentRoomId={currentRoomId}
              answersFor={roomAnswersFor}
              exchangeFor={roomExchangeFor}
              exchangeCostText={roomExchangeCostText}
              onSelectRoom={(roomId) => {
                setRoomNotice(undefined)
                setCurrentRoomId(roomId)
              }}
              onCreateRoom={createRoom}
              onRemoveRoom={removeRoom}
              onMenu={setRowMenu}
              onRenameRoom={renameRoom}
              onPost={postToRoom}
              onTask={updateRoomTask}
              onOpenMission={openMission}
              workspacePath={workspacePath}
              notice={roomNotice}
            />
          ) : screen === 'settings' ? (
            <SettingsScreen
              workspacePath={workspacePath}
              workspaceMade={workspaceMade}
              onChooseFolder={chooseWorkspace}
              runtimes={runtimes}
              limitedRuntimes={limitedRuntimes}
              usageWindows={usageWindows}
              setupNotes={setupNotes}
              {...(runtimeUpdates === undefined ? {} : { runtimeUpdates })}
              onKeepAgentsCurrent={(automatic) => {
                void window.desktop
                  ?.setRuntimeUpdates(automatic)
                  .then(setRuntimeUpdates)
                  .catch(() => undefined)
              }}
              onUpdateAgent={(runtime) => {
                void window.desktop
                  ?.updateRuntimeNow(runtime)
                  .then(setRuntimeUpdates)
                  .catch(() => undefined)
              }}
              runtimeSetup={runtimeSetup}
              cliArtifacts={cliArtifacts}
              workspaceBrief={workspaceBrief}
              worktrees={worktrees}
              onRemoveWorktree={removeWorktree}
              ledgerPath={undefined}
              build={build}
              storage={storage}
              update={update}
              onCheckUpdate={checkUpdate}
              onInstallUpdate={installUpdate}
              onUpdateLane={(everyBuild) => {
                void window.desktop
                  ?.setUpdateLane(everyBuild)
                  .then((response) => {
                    if (response.ok) setUpdate(response.data)
                  })
                  .catch(() => undefined)
              }}
              relay={relay}
              swarm={swarm}
              tube={tube}
            onTubeChange={chooseTube}
              replySize={replySize}
              onReplySizeChange={chooseReplySize}
              metal={metal}
              metalStrength={metalStrength}
              metalMotion={metalMotion}
              metalBend={metalBend}
              onMetalChange={chooseMetal}
            onSwarmChange={(next) => {
                // The same write the composer mark performs: optimistic, then
                // reconciled with what the store actually saved.
                setSwarm(next)
                if (next) setSwarmCalls((count) => count + 1)
                void window.desktop
                  ?.writeWorkspaceSettings({ swarm: next, relay, relayHopCap, interrupt, memoryMode, autoMode, askConnectors, keepATodoList, replySize, layout, tube })
                  .then((settings) => setSwarm(settings.swarm === true))
                  .catch(() => setSwarm(!next))
              }}
              autoMode={autoMode}
              onAutoModeChange={(next) => {
                setAutoMode(next)
                void window.desktop
                  ?.writeWorkspaceSettings({ swarm, relay, relayHopCap, interrupt, memoryMode, autoMode: next, askConnectors, keepATodoList, replySize, layout, tube })
                  .then((settings) => setAutoMode(settings.autoMode === true))
                  .catch(() => setAutoMode(!next))
              }}
              askConnectors={askConnectors}
              onAskConnectorsChange={(next) => {
                setAskConnectors(next)
                void window.desktop
                  ?.writeWorkspaceSettings({ swarm, relay, relayHopCap, interrupt, memoryMode, autoMode, askConnectors: next, keepATodoList, replySize, layout, tube })
                  .then((settings) => setAskConnectors(settings.askConnectors === true))
                  .catch(() => setAskConnectors(!next))
              }}
              keepATodoList={keepATodoList}
              onKeepATodoListChange={(next) => {
                setKeepATodoList(next)
                void window.desktop
                  ?.writeWorkspaceSettings({ swarm, relay, relayHopCap, interrupt, memoryMode, autoMode, askConnectors, keepATodoList: next, replySize, layout, tube })
                  .then((settings) => setKeepATodoList(settings.keepATodoList === true))
                  .catch(() => setKeepATodoList(!next))
              }}
              relayHopCap={relayHopCap}
              memoryMode={memoryMode}
              onMemoryModeChange={changeMemoryMode}
              layout={layout}
              layoutMode={layoutMode}
              onLayoutChange={chooseLayout}
              memoryCount={memories.filter((memory) => memory.status === 'kept').length}
              memoryWaiting={memories.filter((memory) => memory.status === 'proposed').length}
              onOpenMemory={() => setScreen('memory')}
              onRelayHopCapChange={(next) => {
                setRelayHopCap(next)
                void window.desktop
                  ?.writeWorkspaceSettings({ swarm, relay, relayHopCap: next, interrupt, memoryMode, autoMode, askConnectors, keepATodoList, replySize, layout, tube })
                  .then((settings) => setRelayHopCap(settings.relayHopCap))
                  .catch(() => undefined)
              }}
            onRelayChange={(next) => {
              setRelay(next)
              void window.desktop
                ?.writeWorkspaceSettings({ swarm, relay: next, relayHopCap, interrupt, memoryMode, autoMode, askConnectors, keepATodoList, replySize, layout, tube })
                .then((settings) => setRelay(settings.relay === true))
                .catch(() => setRelay(!next))
            }}
            interrupt={interrupt}
            onInterruptChange={(next) => {
              setInterrupt(next)
              void window.desktop
                ?.writeWorkspaceSettings({ swarm, relay, relayHopCap, interrupt: next, memoryMode, autoMode, askConnectors, keepATodoList, replySize, layout, tube })
                .then((settings) => setInterrupt(settings.interrupt === true))
                .catch(() => setInterrupt(!next))
            }}
            onPreviewPrune={previewPrune}
            onListTrash={listTrash}
            onRestoreMission={restoreMission}
            onEmptyTrash={emptyTrash}
            changelog={changelog}
            {...(settingsLanding === undefined ? {} : { initialPage: settingsLanding })}
              onPrune={prune}
            />
          ) : liveRun === undefined ? (
            // A CHOSEN teammate with nothing running gets their own
            // capability-led state. Nothing chosen -- which is how every
            // launch begins -- shows the home screen: what is connected,
            // which folder, and the sidebar to pick a teammate from (Colin,
            // 2026-09-05: "have that on open so the user can see if their
            // models are connected and then can click onto their teammates").
            // `selectedTeammate` falls back to the first teammate so a message
            // always has someone to go to; the SCREEN keys on the explicit pick.
            selectedTeammateId !== undefined && selectedTeammate !== undefined && runtimes.some((entry) => entry.ready && entry.status === 'ready') ? (
              <IdleTeammate
                teammate={pickedTeammate ?? selectedTeammate ?? teammates[0]!}
                canStart={busyRun === undefined}
                /*
                 * Whether THIS teammate can actually start, which this screen
                 * did not know at all.
                 *
                 * `canStart` above is only "no mission is running"; the screen
                 * was drawn whenever ANY runtime was ready. So a Claude
                 * teammate on a machine where Claude is signed out got the
                 * ordinary welcome and a row of starter buttons that could
                 * not work, while Settings said the opposite in red two
                 * clicks away (Astra's Finding 1, 2026-09-14).
                 */
                blocked={(() => {
                  const who = pickedTeammate ?? selectedTeammate ?? teammates[0]!
                  const view = viewByTeammate[who.teammateId]
                  if (view?.status !== 'blocked') return undefined
                  const theirs = runtimeOfTeammate(
                    who,
                    sidebarMissions.filter(
                      (mission) => (mission.ownerId ?? missionOwners[mission.missionId]) === who.teammateId
                    )
                  )
                  const command = theirs === undefined ? undefined : signInCommand(theirs)
                  const named =
                    theirs === undefined || !isMissionRuntime(theirs) ? 'Their runtime' : runtimeDisplayName(theirs)
                  return command === undefined
                    ? `${named} is not signed in, so ${who.name} cannot start yet.`
                    : `${named} is not signed in, so ${who.name} cannot start yet. Sign in from Settings > Runtimes, or ${command} in a terminal.`
                })()}
                mode={mode}
                onStarter={(prompt) => {
                  void startMission(prompt)
                }}
              />
            ) : (
              /*
               * The boot screen is NOT here any more.
               *
               * It is its own window now -- a loading screen shown before
               * this one exists, closing when the runtimes have answered
               * (`SplashApp`). Drawing it in the pane as well meant it
               * "immediately appeared and then disappeared" behind the
               * splash, which is the app showing the same ceremony twice
               * and finishing it in neither.
               */

              <FirstLaunch
                runtimes={runtimes}
                freeStart={freeStartStillFree(runtimes, models)}
                limitedRuntimes={limitedRuntimes}
                discoveryPhase={runtimeState.phase}
                tube={tube}
                swarmCalls={swarmCalls}
                workspacePath={workspacePath}
                workspaceMade={workspaceMade}
                teammateCount={teammates.length}
                onChooseFolder={chooseWorkspace}
                onInstall={installRuntime}
                installing={installing}
                installLog={installLog}
                installLine={
                  installing === undefined
                    ? undefined
                    /*
                      * "checking for npm", not "starting npm".
                      *
                      * Before an install runs, the installer re-asks which npm
                      * to use. That is right -- the one thing that changes the
                      * answer is the person having installed Node since the
                      * first screen decided. But on a machine whose npm hangs
                      * that probe takes five seconds, and the line claimed npm
                      * was starting while nothing of the sort was happening
                      * (Fable, pass 2, finding 4: "2s · starting npm… 6s ·
                      * starting npm…", then the bundled path). Once npm really
                      * does speak, `installLine` carries its own output and
                      * this is gone.
                      */
                    : `${String(installElapsed)}s · ${installLine ?? 'checking for npm…'}`
                }
                installFailure={installFailure}
                npmMissing={runtimeState.phase === 'ready' && runtimeState.npmPresent === false}
                npmIsBundled={runtimeState.phase === 'ready' && runtimeState.npmIsBundled === true}
                npmDidNotAnswer={runtimeState.phase === 'ready' && runtimeState.npmDidNotAnswer === true}
                checkingGaveUp={runtimeState.phase === 'ready' && runtimeState.gaveUp === true}
                onCheckAgain={() => {
                  // The repair the app can actually perform: ask again, from
                  // the top, with CHECKING honest once more while it does.
                  resetDiscoveryBudget.current()
                  setRuntimeState((held) => (held.phase === 'ready' ? { ...held, gaveUp: false } : held))
                  // Everything, including whether npm is there: this is the
                  // repair, so nothing it could fix should be remembered.
                  askDiscoveryAgain.current(true)
                }}
              />
            )
          ) : (
            <>
              <header className="lc-workroom__header">
                <div className="lc-workroom__identity">
                  {missionOwner === undefined ? (
                    <AgentAvatar size={32} />
                  ) : (
                    <TeammateBot
                      hue={missionOwner.hue}
                      avatar={missionOwner.avatar}
                      size={32}
                      teammateId={missionOwner.teammateId}
                      activity={workroomOwnerView?.activity ?? 'idle'}
                      hopsWhenDone={false}
                      /*
                       * The dot comes from the same status as the face.
                       *
                       * It used to be a ternary written out here -- running,
                       * else approvals, else none -- which is three ways of
                       * saying what `facePresenceFor` already says, and it
                       * disagreed in a way nobody would see until it mattered:
                       * it had no `blocked` branch AT ALL. A teammate whose
                       * runtime needed a sign-in drew the same nothing as a
                       * teammate with no work, two inches from a sidebar row
                       * drawing the red one correctly (Grok's audit,
                       * 2026-09-13). One call now decides both.
                       */
                      presence={workroomOwnerView === undefined ? 'none' : facePresenceFor(workroomOwnerView.status)}
                    />
                  )}
                  <div style={{ minWidth: 0 }}>
                    <div className="lc-workroom__titleline">
                      <span className="lc-workroom__name">
                        {missionOwner?.name ?? missionTitle(liveRun.prompt)}
                      </span>
                      <span className="lc-workroom__role">
                        {missionOwner === undefined ? '' : `${roleLabelOf(missionOwner)} · `}
                        {runtimeDisplayName(liveRun.data?.runtime ?? liveRun.runtime ?? 'codex')}
                      </span>
                    </div>
                    <div className="lc-workroom__mission">
                      {liveRun.data === undefined
                        ? isTerminal(liveRun.phase)
                          // A start that failed has no mission id and never
                          // will. Leaving "Starting…" over a red error card
                          // said the opposite of what happened.
                          ? `Mission · not started · ${liveRun.phase}`
                          // Not "Starting…": the thread already says
                          // "Starting · 3s" five hundred pixels below, and
                          // two places stating one fact is how they come to
                          // disagree. The thread's is the one that stays --
                          // it carries the clock (design agent, 2026-09-10).
                          : 'Mission'
                        // The MODEL, not just the runtime. This app exists to
                        // put two models on the same work, and the header
                        // named only the runtime -- so two missions from
                        // different models read identically once the composer
                        // had moved on (design pass, 2026-09-04, asked for a
                        // provenance strip; this is the half of it that was
                        // actually missing). Ledger state was the other half
                        // and is NOT here: the receipt card below already
                        // states it, and two places stating one fact is how
                        // they come to disagree.
                        // Spelled as a name rather than an identifier, the
                        // same way the composer's chip spells it. The exact
                        // id is in the receipt below, which is where a person
                        // goes for a string to copy.
                        /*
                         * FOUR FACTS, ONE SCOPE, ONE TENSE.
                         *
                         * Design ruling, 2026-09-14 (`THREE-PLACEMENTS`),
                         * after this line truncated on Colin's screen as
                         * "… 208 out · co…". It had grown to seven facts
                         * because it is the most VISIBLE surface, not the
                         * right one -- "the usual reason a strip grows".
                         *
                         * Three things came off. The noun `Mission ·`, which
                         * labels the line once for a first-time reader and
                         * costs eight characters on every render after: an
                         * eight-hex id in mono in a header is self-evidently
                         * an id. The permission sentence, which went NOWHERE
                         * -- the composer's mode chip already names that mode
                         * 300px below, where it is actionable, and "a
                         * permission is a thing you can change, so stating it
                         * where it cannot be changed is the app talking to
                         * itself". And the conversation's total, to the
                         * context ring, which is already the
                         * conversation-scoped object drawing a
                         * conversation-scoped budget.
                         *
                         * Measured by the design pass off its own render at
                         * the inspector-open width: 884px of line in 676px of
                         * column, down to 363px.
                         */
                        : `${shortMissionId(liveRun.data.missionId)} · ${
                            liveRun.data.model === undefined
                              ? 'account-default'
                              : modelDisplayName(liveRun.data.runtime, liveRun.data.model)
                          } · ${
                            running
                              ? // A routine's step says which one it is on.
                                routineStepPhrase(liveRun.startedBy, routines) ?? 'running'
                              : liveRun.restored === true
                                ? 'restored from the local ledger'
                                : liveRun.phase
                          }${
                            // This run's own cost. The conversation's total
                            // is NOT here any more -- it is one row inside
                            // the context ring's hover, the surface that was
                            // already conversation-scoped.
                            shownCostTail
                          }`}
                      {/*
                        * The context ring is NOT here.
                        *
                        * It was, from 2026-09-10 -- "a fact about THIS
                        * conversation, and this line is where the
                        * conversation's other facts are" (design agent), after
                        * it had sat on the composer as a bare glyph beside the
                        * swarm mark and read as an artifact rather than a
                        * control. Colin, 2026-09-11: "theres no more
                        * context/usage circle, we can just put it on the left
                        * of the model picker."
                        *
                        * It is there now, and in ONE place: drawing it here as
                        * well would put one fact in two registers. Beside the
                        * route it is no longer loose on the row either -- it
                        * belongs to the control it is about, which is what the
                        * 2026-09-10 objection was really about.
                        */}
                    </div>
                  </div>
                </div>
                <div className="lc-workroom__actions">
                  {/*
                    * One control for the occasional actions, because four
                    * buttons across the top of every conversation is what the
                    * header looked like (Colin, 2026-09-11: "lets clean up
                    * this area with maybe a triple dot dropdown or something").
                    *
                    * Activity stays out of it. It TOGGLES the panel beside the
                    * thread -- it is a view control with a pressed state, and
                    * a thing you turn on and off does not belong behind a menu
                    * that closes when you pick from it. The other three are
                    * each done once and then not again.
                    *
                    * Delete is in here now, and the 2026-09-04 note that kept
                    * it out is answered rather than overruled: its worry was a
                    * menu making the one destructive action harder to find and
                    * three clicks deep. It is NAMED here, which is how a
                    * person finds out an action exists, and the menu asks in
                    * place -- `Delete for good?`, the same second press the
                    * header button had. Nothing about the asking changed.
                    *
                    * Reviewers are listed flat rather than behind a second
                    * menu: `Ask Yurt for a review` is one click instead of
                    * two and says who it goes to before you commit.
                    */}
                  {headerActions.length > 0 && (
                    <button
                      type="button"
                      className="lc-button"
                      aria-label="More actions"
                      aria-haspopup="menu"
                      title="More actions"
                      onClick={(event) => {
                        const at = event.currentTarget.getBoundingClientRect()
                        setRowMenu({
                          // Right-aligned under the button: the menu is wider
                          // than the control and the header sits at the window
                          // edge, so hanging it from the left corner pushed it
                          // off screen.
                          x: Math.round(Math.max(8, at.right - 220)),
                          y: Math.round(at.bottom + 4),
                          title: 'This conversation',
                          items: headerActions
                        })
                      }}
                    >
                      <Icon name="dots" size={13} />
                    </button>
                  )}
                  <button
                    type="button"
                    className={`lc-button${inspectorOpen ? ' is-active' : ''}`}
                    aria-pressed={inspectorOpen}
                    onClick={() => setInspectorOpen(!inspectorOpen)}
                  >
                    <Icon name="activity" size={13} /> Activity
                  </button>
                </div>
              </header>
              {/*
                * Only while something is actually running. It carries a live
                * budget and a Stop control, and neither means anything once
                * the exchange is over -- after which it is a permanent header
                * on a conversation that has finished (Colin, 2026-09-06:
                * "dont have that exchange thing always up there, we want less
                * clutter"). What it said is still in the thread and the record.
                */}
              {exchange !== undefined && (
                <ExchangeStrip
                  exchange={exchange}
                  cap={relayHopCap}
                  runtimeNameOf={runtimeNameOf}
                  stopping={stoppingExchange}
                  onStop={() => stopExchange(exchange.liveRunIds)}
                />
              )}
              <Thread
                onOpenFile={openFileInViewer}
                prompt={liveRun.prompt}
                startedBy={liveRun.startedBy}
                planMode={liveRun.plan === true}
                onOpenPeerRun={(messageId) => {
                  // Only where the record shows the message actually reached
                  // a run. Nothing received it yet is a real state -- it
                  // waits for that teammate's next run -- and a control that
                  // led nowhere would say otherwise.
                  const reached = peerRunFor(messageId, history)
                  return reached === undefined ? undefined : () => openMission(reached.missionId)
                }}
                onOpenSenderRun={(missionId) => () => openMission(missionId)}
                earlierTurns={liveRun.earlierTurns ?? []}
                {...(() => {
                  // Where this conversation's group began briefing it. The
                  // row knows every id the conversation has worn; the
                  // membership is read against all of them, the way the
                  // sidebar reads it; the turns' start times place the line.
                  const shownId = liveRun.data?.missionId ?? liveRun.restoredMission?.missionId
                  const row =
                    shownId === undefined
                      ? undefined
                      : sidebarMissions.find((entry) => (entry.memberIds ?? [entry.missionId]).includes(shownId))
                  const membership = row === undefined ? undefined : heldFor(row, groupMembers)
                  const group = membership === undefined ? undefined : groups.find((entry) => entry.groupId === membership.groupId)
                  const starts = [
                    ...(liveRun.earlierTurns ?? []).map((turn) => historyByIdRef.current.get(turn.missionId)?.createdAt),
                    liveRun.startedAtIso ?? liveRun.restoredMission?.createdAt
                  ]
                  const boundary = groupBoundary(starts, membership, group)
                  // And where earlier groups' words stopped: every id the
                  // conversation has worn, the same way membership is read.
                  const left = row === undefined ? undefined : heldFor(row, groupLeft)
                  return {
                    ...(boundary === undefined ? {} : { groupBoundary: boundary }),
                    // And where they STARTED, for memberships that have ended:
                    // the turns those words briefed still say so.
                    pastBoundaries: groupJoins(starts, left ?? []),
                    groupLeavings: groupLeavings(starts, left ?? [])
                  }
                })()}
                coldStart={liveRun.coldStart ?? false}
                workspacePath={workspacePath}
                {...(workspaceId === undefined ? {} : { workspaceId })}
                wasPlan={liveRun.plan === true}
                onRunWithEdits={
                  // Offered only where it is genuinely the next thing a
                  // person wants: a finished READ-ONLY run whose reply
                  // carries code the runtime was not allowed to apply. Not
                  // an error -- the run did what its mode permits -- just the
                  // one click that would otherwise be a mode change and a
                  // retyped prompt. Thread decides whether code is present.
                  !running
                  && liveRun.data?.sandbox === 'read-only'
                  && liveRun.prompt.trim().length > 0
                  && modeRunsOn('accept-edits', liveRun.data.runtime, build?.platform)
                    ? () => {
                        // An ordinary mode switch now, named on the band
                        // above the button before it is pressed.
                        setMode('accept-edits')
                        void startMission(liveRun.prompt, 'accept-edits')
                      }
                    : undefined
                }
                onRunAgain={
                  /*
                   * Offered only where the runtime NEVER STARTED.
                   *
                   * No session was opened, no tool ran, nothing was touched
                   * -- so pressing this cannot repeat anything, which is the
                   * only reason it is safe to offer at all. A run that got
                   * as far as doing something is deliberately excluded:
                   * whether the half it did matters is the person's call.
                   *
                   * The measured case is a Cursor start dying on its own
                   * config file while a second copy of it held that file
                   * open (Colin, 2026-09-14). Transient, not his fault, and
                   * the message he had typed was still exactly right --
                   * retyping it was the only way forward and should not have
                   * been.
                   */
                  !running
                  && liveRun.phase === 'failed'
                  && runtimeNeverStarted(liveRun.events)
                  && liveRun.prompt.trim().length > 0
                    ? () => void startMission(liveRun.prompt)
                    : undefined
                }
                onResume={
                  // Offered only for a mission that is not running and whose
                  // record the app will vouch for -- ResumeCard decides that
                  // from the checkpoint, and the host checks it again rather
                  // than taking the renderer's word.
                  !running && liveRun.restoredMission !== undefined
                    ? (epoch) => {
                        void resumeMission(liveRun.restoredMission!.missionId, epoch)
                      }
                    : undefined
                }
                onAnswer={
                  // Answering IS the next turn of the conversation, so it goes
                  // through the same path a typed reply does -- same continuity,
                  // same route, same record. A run still going has not asked
                  // anything yet, and one with no prompt cannot be continued.
                  !running && liveRun.prompt.trim().length > 0
                    ? (option) => {
                        void startMission(decisionReply(option))
                      }
                    : undefined
                }
                {...(liveRun.data?.sandbox === undefined ? {} : { sandbox: liveRun.data.sandbox })}
                events={liveRun.events}
                running={running}
                restoredMission={liveRun.restored === true ? liveRun.restoredMission : undefined}
                {...(liveRun.data?.missionId === undefined ? {} : { shownMissionId: liveRun.data.missionId })}
                error={liveRun.error}
                errorIsPersistence={liveRun.errorIsPersistence === true}
                {...(ledgerPath === undefined ? {} : { ledgerPath })}
                approvals={shownApprovals}
                onDecide={decideApproval}
                onAnswerQuestion={answerQuestion}
                decidingIds={decidingIds}
                cancelled={liveRun.phase === 'cancelled'}
                handoff={liveRun.handoff}
                peers={{
                  self: missionOwner,
                  teammates,
                  messages: liveRun.peerMessages ?? [],
                  notices: liveRun.peerNotices ?? [],
                  /*
                   * What this CONVERSATION taught the team, read from the
                   * memory list rather than from a notice that would be gone
                   * once the thread is drawn from the record.
                   *
                   * Every turn of it, not the turn on screen. A reply is its
                   * own mission, so matching the shown missionId lost every
                   * memory learned earlier the moment a later turn began --
                   * Colin, 2026-09-10: "after an agent 'remembers something'
                   * it disappears in chat". The header's Delete had to learn
                   * the same lesson about the same shape.
                   */
                  memories: memoriesOfConversation(
                    memories,
                    turnsOfConversation(liveRun.data?.missionId, sidebarMissions)
                  )
                }}
                startedAt={
                  liveRun.restoredMission === undefined
                    ? undefined
                    : startedLabel(liveRun.restoredMission.createdAt)
                }
                {...(() => {
                  const iso = liveRun.startedAtIso ?? liveRun.restoredMission?.createdAt
                  return iso === undefined ? {} : { startedAtIso: iso }
                })()}
              />
            </>
          )}
          {/*
            * A refused delete, wherever it was asked for. This used to render
            * inside the shown conversation's header -- so a Delete refused
            * from the SIDEBAR, on a row you were not looking at, reported
            * nothing anywhere and read as the menu doing nothing at all
            * (Colin, 2026-09-05, second report of "delete not working").
            */}
          {deleteError !== undefined && (
            <div className="lc-diagnostic lc-tone-red" role="alert">
              <Icon name="shield" size={12} />
              <span>{deleteError}</span>
            </div>
          )}
          {rowNotice !== undefined && (
            <div className="lc-diagnostic lc-tone-green" role="status">
              <Icon name="check" size={12} />
              <span>{rowNotice}</span>
            </div>
          )}
          {workspaceNotice !== undefined && (
            <div className="lc-diagnostic lc-tone-amber lc-diagnostic--row" role="alert">
              <Icon name="shield" size={12} />
              <span>{workspaceNotice}</span>
              {workspacePath === undefined && (
                <button type="button" className="lc-button" onClick={chooseWorkspace}>
                  Choose folder
                </button>
              )}
            </div>
          )}
          {/* What changed lives in Settings > What's new now, and a big build
              gets the splash (see `splashOpen`); the banner that sat here is gone. */}
          {/*
            * Not while this conversation's run is going: the outside recheck
            * of 0.303 found the banner "understandable, but competed for
            * attention during a live mission" -- and installing is refused
            * mid-run anyway. It is there again the moment the run ends.
            */}
          {screen === 'workroom' && !running && <UpdateBanner update={update} onInstall={installUpdate} />}
          {screen === 'workroom' && (
          <Composer
            metal={metal}
            metalStrength={metalStrength}
            metalMotion={metalMotion}
            metalBend={metalBend}
            // So the mode menu can say where connectors live when this route
            // is not the one they are signed in on. See `connectorsNote`.
            hasConnectors={connectorList !== undefined && connectorList.length > 0}
            // Said before the send: a reply on another runtime continues
            // from the stopped run's checkpoint, not from its memory.
            continuationNote={continuationNote}
            workspaceName={workspaceName.length === 0 ? undefined : workspaceName}
            workspacePath={workspacePath}
            workspaceMade={workspaceMade}
            onChooseFolder={chooseWorkspace}
            runtimes={runtimes}
            runtimesGaveUp={runtimeState.phase === 'ready' && runtimeState.gaveUp === true}
            limitedRuntimes={limitedRuntimes}
              usageWindows={usageWindows}
            discoveryPhase={runtimeState.phase}
            {...(shownContext === undefined ? {} : { context: shownContext })}
            {...(shownConversationCost === undefined ? {} : { conversationCost: shownConversationCost })}
            running={running}
            cancelling={liveRun?.phase === 'cancelling'}
            activeRoute={liveRun?.data}
            // What the composer SHOWS has to be what will actually run.
            // A teammate can carry a stored mode their route cannot honour
            // (Claude Code kept on Accept edits from before), and showing it
            // would promise an edit the host is about to refuse.
            mode={
              modeRunsOn(mode, composerRoute.runtime, build?.platform)
                ? mode
                : modesFor(composerRoute.runtime, build?.platform)[0] ?? mode
            }
            onModeChange={setMode}
            autoMode={autoMode}
            onEnableAutoMode={() => {
              // Picking Auto in the composer IS the person switching it on.
              // Written through the host like any other settings change, so
              // the next run -- and a relay hop or a routine step -- reads the
              // same answer the composer just showed.
              setAutoMode(true)
              void window.desktop
                ?.writeWorkspaceSettings({ swarm, relay, relayHopCap, interrupt, memoryMode, autoMode: true, askConnectors, keepATodoList, replySize, layout: 'auto', tube: 'full' })
                .then((settings) => setAutoMode(settings.autoMode === true))
                .catch(() => setAutoMode(false))
            }}
            route={composerRoute}
            onRouteChange={(next) => {
              // From here on this route is theirs, and discovery stops
              // moving it.
              routeChosen.current = true
              setRoute(next)
              if (pickedTeammate !== undefined) {
                setPickerRoutes((current) => new Map(current).set(pickedTeammate.teammateId, next))
              }
              // Effort belongs to a model, so a level the new model never
              // advertised must not follow it across. But clearing to NOTHING
              // is what made picking a model empty the effort control --
              // Colin, 2026-09-07: "if the user just clicks the model it
              // instantly defaults to no effort, it was cleaner before". So
              // it lands on the new model's default instead.
              // Through `modelFamily`, not a bare id match: a Cursor route
              // resolved to a variant finds no family by id, and the effort
              // control then reads as though the model had none.
              const family = modelFamily(models, next.runtime, next.model)
              setEffort(effortAfterRouteChange(effort, family?.supportedEfforts ?? [], family?.defaultEffort))
            }}
            models={models}
            resolvedModels={resolvedModels}
            recentRoutes={recentRoutes}
            platform={build?.platform}
            effort={effort}
            onEffortChange={setEffort}
            swarm={swarm}
            onSwarmChange={(next) => {
              // Optimistic, then reconciled with what the store actually
              // saved -- a rejected write must not leave the chip claiming a
              // setting that is not on disk.
              setSwarm(next)
              if (next) setSwarmCalls((count) => count + 1)
              void window.desktop
                ?.writeWorkspaceSettings({ swarm: next, relay, relayHopCap, interrupt, memoryMode, autoMode, askConnectors, keepATodoList, replySize, layout, tube })
                .then((settings) => setSwarm(settings.swarm === true))
                .catch(() => setSwarm(!next))
            }}
            error={
              /*
               * Only when something is standing: a runtime that is here and
               * not usable (signed out, not answering). On a launch with
               * NOTHING installed the card is cut -- design agent,
               * 2026-09-18: "Red in this app means a run stopped. Nothing
               * stopped here -- nothing has started, and never could have."
               * The disabled composer under it demonstrates the same fact
               * and its placeholder says what would change it; an assertion
               * four lines above a demonstration is the assertion losing.
               */
              /*
               * And not while the rows still say CHECKING. Colin, 2026-09-19,
               * with a frame of five rows checking, the no-Node sentence and
               * this card all at once: "this cant be ideal." A probe that
               * has not answered is not a thing standing either; it is a
               * wait. Standing means a runtime that is here and has SAID it
               * cannot run -- signed out, or never answering after the
               * re-checks ran out.
               */
              noRuntimeReady &&
              runtimeState.phase === 'ready' &&
              /*
               * Not after discovery gives up, either. 0.185.0 counted "asked
               * four times, no answer" as something standing, and Grok's
               * pass 14 drew what that meant: five rows already reading
               * NOT ANSWERING with Check again beside each, a composer that
               * already cannot send and already says why, and THEN this
               * card above it. The rows are the repair; the card was a
               * third telling. It stays for a sign-in, which no row can
               * perform for you.
               */
              runtimeState.runtimes.some(
                (runtime) => runtime.installed && (runtime.status === 'auth-required' || runtime.auth === 'unauthenticated')
              )
                ? 'No runtime can run a mission yet. Locust runs the coding-agent CLIs on this machine — Settings shows what to install, and OpenCode needs no account.'
                : undefined
            }
            onStart={startMission}
            onCancel={cancelMission}
            onOpenRoutePicker={() => {
              // Opening the picker is the moment the list matters most, and
              // the cheapest moment to be sure it is current.
              readModels()
            }}
            onHandOff={(choice) => { void handOffMission(choice) }}
            handingOff={handingOff}
            teammateName={pickedTeammate?.name}
            busyWith={busyRun === undefined ? undefined : (pickedTeammate?.name ?? 'This teammate')}
            // What is waiting, as the person will see it go: folded, so the
            // strip shows the one instruction that will actually be sent
            // rather than the pieces it was typed in.
            queued={combineQueued(waitingHere)[0]?.text}
            queuedCount={waitingHere.length}
            queuedNote={queuedNote}
            queuedElsewhere={queueKey !== shownKey}
            onQueue={(text) => {
              // Into the conversation the box shows the queue of (queueKey):
              // the live run on screen, else the addressed teammate's busy run.
              const key = liveOnScreen ?? busyKey
              if (key !== undefined) {
                setQueued((rows) => [
                  ...rows,
                  { id: `q_${String(rows.length)}_${key}`, key, text, origin: 'person' as const }
                ])
              }
            }}
            onUnqueue={() => setQueued((rows) => withoutQueueOf(rows, queueKey))}
            onSendQueued={() => {
              if (queueKey === undefined) return
              const { going, rest } = takeNext(queued, queueKey)
              setQueued(rest)
              if (going !== undefined) void startMission(going.text, undefined, { requeue: going })
            }}
          />
          )}
        </main>
        {/*
          * Only beside the conversation it inspects. It used to stay open
          * across All missions, Settings and Team, where it inspected
          * nothing on screen and took 344px from screens that had not been
          * drawn for the squeeze: at 1120 the Settings pane and the mission
          * rows grew sideways scrollbars (crowded-window drive, 2026-09-19).
          * It comes back with the workroom; the toggle keeps its state.
          */}
        {/*
          * ONE REGION, TWO OCCUPANTS, and the file wins.
          *
          * A file is opened by pressing a specific file; the inspector is a
          * toggle. The more specific intent is the one to honour, and the
          * inspector is one press away again the moment the file is closed.
          */}
        {viewerRefusal !== undefined && screen === 'workroom' && viewingFile === undefined && (
          <aside className="lc-viewer lc-viewer--refused" role="status">
            <div className="lc-viewer__head">
              <span className="lc-viewer__name">Could not open that file</span>
              <span className="lc-viewer__spacer" />
              <button type="button" className="lc-viewer__close" aria-label="Dismiss" onClick={() => setViewerRefusal(undefined)}>
                <Icon name="close" size={13} />
              </button>
            </div>
            <p className="lc-viewer__refusal">{viewerRefusal}</p>
          </aside>
        )}
        {viewingFile !== undefined && screen === 'workroom' ? (
          <FileViewer
            path={viewingFile.path}
            text={viewingFile.text}
            mode={viewingFile.mode}
            turns={viewingFileTurns}
            onClose={() => setViewingFile(undefined)}
            onReveal={() => {
              const bridge = window.desktop
              if (bridge === undefined || workspacePath === undefined) return
              void bridge.revealFile(viewingFile.path).catch(() => undefined)
            }}
            onSave={() => {
              const bridge = window.desktop
              if (bridge === undefined || workspacePath === undefined) return
              void bridge.saveCopy(viewingFile.path).catch(() => undefined)
            }}
          />
        ) : (
          inspectorOpen && liveRun !== undefined && screen === 'workroom' && (
            <Inspector
              events={liveRun.events}
              workspacePath={workspacePath}
              running={running}
              route={liveRun.data}
              /*
               * THE RECEIPT OF A RUN THAT FINISHED ON SCREEN.
               *
               * Only a conversation reopened from history carried its ledger
               * record, so the Receipt tab of a run that had just finished
               * said "the durable receipt appears once this mission has been
               * recovered from the ledger" and offered nothing -- the run was
               * over and its record was on disk. Found twice by the design
               * reviews (0.255 and 0.268: "a trust issue, not just copy").
               * The history is read again the moment a run ends, so its
               * record is the one the reopened view would have shown.
               */
              restoredMission={
                liveRun.restoredMission
                ?? (running || liveRun.data?.missionId === undefined ? undefined : historyById.get(liveRun.data.missionId))
              }
              onClose={() => setInspectorOpen(false)}
            />
          )
        )}
      </div>
      {paletteOpen && (
        <CommandPalette
          onClose={() => setPaletteOpen(false)}
          actions={
            [
              {
                id: 'go-workroom',
                // Its own group, because it is a promotion rather than an
                // accident of ordering: the workroom is the likeliest thing
                // anybody opening this wants, and a name says why it is
                // first (frame pass, 2026-09-15).
                group: 'This conversation',
                label: 'Workroom',
                run: () => setScreen('workroom')
              },
              {
                id: 'toggle-swarm',
                group: 'Workspace',
                label: swarm ? 'Turn swarm off' : 'Turn swarm on',
                hint: 'every mission at its model maximum',
                run: () => {
                  // Same write as the composer mark, which is the only other
                  // way in -- and it only exists on the workroom, and is
                  // disabled while a mission runs. A workspace-wide setting
                  // needs one way in from anywhere.
                  const next = !swarm
                  setSwarm(next)
                  if (next) setSwarmCalls((count) => count + 1)
                  void window.desktop
                    ?.writeWorkspaceSettings({ swarm: next, relay, relayHopCap, interrupt, memoryMode, autoMode, askConnectors, keepATodoList, replySize, layout, tube })
                    .then((settings) => setSwarm(settings.swarm === true))
                    .catch(() => setSwarm(!next))
                }
              },
              { id: 'go-missions', group: 'Go to', label: 'Missions', hint: 'Ctrl 1', run: () => setScreen('missions') },
              { id: 'go-rooms', group: 'Go to', label: 'Rooms', hint: 'Ctrl 4', run: () => setScreen('rooms') },
              { id: 'go-memory', group: 'Go to', label: 'Memory', hint: 'Ctrl 5', run: () => setScreen('memory') },
              {
                id: 'go-teammates',
                group: 'Go to',
                label: 'Team',
                hint: 'Ctrl 2',
                run: () => setScreen('teammates')
              },
              {
                id: 'go-settings',
                group: 'Go to',
                label: 'Settings',
                hint: 'Ctrl 3',
                // Same as the rail button: the storage number is read when
                // the screen that shows it opens, by every route in.
                run: () => {
                  refreshStorage()
                  setScreen('settings')
                }
              },
              {
                id: 'new-teammate',
                group: 'Teammates',
                label: 'New teammate',
                run: () => {
                  setTeammateError(undefined)
                  setNewTeammateOpen(true)
                }
              },
              {
                id: 'inspector',
                group: 'Mission',
                label: inspectorOpen ? 'Close the mission inspector' : 'Open the mission inspector',
                hint: 'Ctrl I',
                run: () => setInspectorOpen(!inspectorOpen)
              },
              ...(running
                ? [
                    {
                      id: 'stop',
                      group: 'Mission',
                      label: 'Stop the running mission',
                      run: cancelMission
                    }
                  ]
                : [])
            ] satisfies PaletteAction[]
          }
        />
      )}
      {(() => {
        const instructing = groups.find((entry) => entry.groupId === instructingGroupId)
        return instructing === undefined ? null : (
          <GroupSettingsDialog
            key={instructing.groupId}
            group={instructing}
            // What "Use current" takes: the route a mission would start on
            // if you pressed send now, effort included.
            currentRoute={{ runtime: route.runtime, model: route.model, mode, ...(effort === undefined ? {} : { effort }) }}
            onCancel={() => setInstructingGroupId(undefined)}
            onSave={({ instructions, route: nextRoute, routeChanged }) => {
              setInstructingGroupId(undefined)
              const writes: Promise<unknown>[] = []
              if (instructions !== instructing.instructions.trim()) {
                writes.push(window.desktop?.setGroupInstructions(instructing.groupId, instructions) ?? Promise.resolve())
              }
              if (routeChanged) writes.push(window.desktop?.setGroupRoute(instructing.groupId, nextRoute) ?? Promise.resolve())
              void Promise.all(writes).then(refreshGroups)
            }}
          />
        )
      })()}
      {splashOpen && (
        <WhatsNewSplash
          entries={splashEntries}
          onClose={() => setSplashClosed(true)}
          onSeeEverything={() => {
            setSplashClosed(true)
            setSettingsLanding('whatsnew')
            refreshStorage()
            setScreen('settings')
          }}
        />
      )}
      {newTeammateOpen && (
        <NewTeammateDialog
          error={teammateError}
          mode={mode}
          takenHues={teammates.map((teammate) => teammate.hue)}
          onCancel={() => setNewTeammateOpen(false)}
          onCreate={createTeammate}
        />
      )}
      {editingTeammate !== undefined && (
        <NewTeammateDialog
          key={editingTeammate.teammateId}
          initial={editingTeammate}
          error={teammateError}
          mode={mode}
          onCancel={() => {
            setFolderNotice(undefined)
            setEditingTeammate(undefined)
          }}
          onCreate={(input) => updateTeammate(editingTeammate.teammateId, input)}
          onChooseFolder={(clear) => chooseTeammateFolder(editingTeammate.teammateId, clear)}
          {...(connectorList === undefined ? {} : { connectors: connectorList })}
          onSetConnectors={(names) => setTeammateConnectors(editingTeammate.teammateId, names)}
          {...(folderNotice === undefined ? {} : { folderNotice })}
        />
      )}
      {feedbackFor !== undefined && (
        <FeedbackDialog conversation={feedbackFor.conversation} onClose={() => setFeedbackFor(undefined)} />
      )}
      {routineDialog !== undefined && (
        <RoutineDialog
          key={routineDialog.routineId ?? 'new'}
          teammate={teammates.find((entry) => entry.teammateId === routineDialog.teammateId)}
          {...(routineDialog.teammateId === undefined && routineDialog.routineId === undefined
            ? { chooseFrom: teammates }
            : {})}
          initialName={routineDialog.name}
          initialSteps={routineDialog.steps}
          initialSchedule={routineDialog.schedule}
          truncated={routineDialog.truncated}
          routeLabel={
            routineDialog.route === undefined
              ? undefined
              : `${runtimeDisplayName(routineDialog.route.runtime)} / ${routineDialog.route.model}`
          }
          busy={routineDialog.busy}
          error={routineDialog.error}
          onCancel={() => setRoutineDialog(undefined)}
          onSave={saveRoutine}
        />
      )}
    </div>
  )
}
