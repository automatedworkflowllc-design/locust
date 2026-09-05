import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'

import type { MissionRuntimeId, NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

import type { AvatarSpec } from '../../shared/avatar.js'

import type {
  CodexMissionUpdate,
  MissionRouteSummary,
  PublicRecoveredMission,
  PublicRuntimeStatus,
  PublicStorageReport,
  MissionPruneResponse,
  AppUpdateResponse,
  AppUpdateState,
  MissionApprovalDecision,
  MissionApprovalRequest,
  MissionMode,
  PublicModel,
  PublicPeerMessage,
  PublicRoutine,
  PublicTeammate,
  TeammateHue,
  TeammateRole,
  TeammateRoute
} from '../../shared/ipc.js'
import { roleLabelOf } from '../../shared/ipc.js'
import { routineDraft } from './routines.js'
import type { RoutineDraft } from './routines.js'
import { RoutineDialog } from './components/RoutineDialog.js'
import { runtimeDisplayName } from '../../shared/runtimes.js'
import { Composer } from './components/Composer.js'
import { FirstLaunch } from './components/FirstLaunch.js'
import { CommandPalette } from './components/CommandPalette.js'
import type { PaletteAction } from './components/CommandPalette.js'
import { IdleTeammate } from './components/IdleTeammate.js'
import { Inspector } from './components/Inspector.js'
import { MissionsScreen, SettingsScreen, TeammatesScreen, UpdateBanner } from './components/Screens.js'
import type { RouteChoice } from './components/RoutePicker.js'
import type { Screen } from './components/Screens.js'
import { Icon } from './components/Icon.js'
import { NewTeammateDialog } from './components/NewTeammateDialog.js'
import { PixelFace } from './components/PixelFace.js'
import { Sidebar } from './components/Sidebar.js'
import type { SidebarMission } from './components/Sidebar.js'
import { ContextMenu } from './components/ContextMenu.js'
import type { ContextMenuState } from './components/ContextMenu.js'
import { Thread } from './components/Thread.js'
import { AgentAvatar } from './components/ThreadItems.js'
import { TitleBar } from './components/TitleBar.js'
import {
  conversationTurns,
  failureMessage,
  recentlyUsedRoutes,
  resolvedModelNames,
  resumableSessionOf,
  relayedTitle,
  rootMission,
  startedLabel,
  stitchedHandoff,
  typedPrompt
} from './missionView.js'
import { conversationCost, costLine } from './cost.js'
import { decisionReply } from '../../shared/decision.js'
import { collapseConversations, listedAsMission, modeRunsOn, modesFor, runtimeIsUsable, shortMissionId, teammateStatusView } from './status.js'
import { DONE_HOP_MS, RECEIVED_GLANCE_MS, liveActivityOf } from './faceState.js'
import type { FaceActivity, LiveActivity } from './faceState.js'

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
  readonly startedBy?: PublicRecoveredMission['startedBy']
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
  | { readonly phase: 'ready'; readonly runtimes: readonly PublicRuntimeStatus[] }
  | { readonly phase: 'error' }

type RunMap = ReadonlyMap<string, LiveRunState>

function liveRunIsActive(run: LiveRunState | undefined): boolean {
  return run !== undefined && (run.phase === 'starting' || run.phase === 'running' || run.phase === 'cancelling')
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

  const events = [...live.events, update.event].slice(-500)
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
        ...(live.peerMessages === undefined ? {} : { peerMessages: live.peerMessages })
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
    peerMessages: mission.peerMessages
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
  if (!swarm) return chosen
  const supported =
    models.find((model) => model.id === modelId && (runtime === undefined || model.runtime === runtime))
      ?.supportedEfforts ?? []
  return supported[supported.length - 1]
}

/**
 * Which model a mission actually starts on.
 *
 * Some runtimes take an effort as a flag; Cursor encodes it in the model id
 * instead, and lists every combination as its own model. The picker shows one
 * row per model and lets the effort control choose among them, so the effort
 * has to be turned back into the id it names -- sending the family's default
 * with an effort beside it would quietly run a different model than the one
 * on screen.
 */
export function chosenModelId(
  models: readonly PublicModel[],
  modelId: string,
  effort: string | undefined
): string {
  if (effort === undefined) return modelId
  const variants = models.find((model) => model.id === modelId)?.variants
  return variants?.[effort] ?? modelId
}

function missionTitle(prompt: string): string {
  const trimmed = prompt.trim().split('\n')[0] ?? prompt
  return trimmed.length > 44 ? `${trimmed.slice(0, 44).trimEnd()}…` : trimmed
}

export default function App(): ReactElement {
  const [runtimeState, setRuntimeState] = useState<RuntimeDiscoveryState>({ phase: 'loading' })
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
    if (mission === undefined || missionOwnersRef.current[missionId] === undefined) return undefined
    return routineDraft(mission, historyByIdRef.current)
  }

  const openMissionMenu = (missionId: string, at: { readonly x: number; readonly y: number }): void => {
    const live = [...runsRef.current.values()].some(
      (run) => liveRunIsActive(run) && run.data?.missionId === missionId
    )
    const title = sidebarMissionsRef.current.find((row) => row.missionId === missionId)?.title ?? 'Mission'
    setRowMenuArmed(undefined)
    setRowMenu({
      x: at.x,
      y: at.y,
      title,
      items: [
        { label: 'Open', onSelect: () => openMission(missionId) },
        {
          label: 'Copy mission id',
          onSelect: () => {
            void navigator.clipboard.writeText(missionId).catch(() => undefined)
          }
        },
        {
          label: 'Save as routine',
          // Only where there is something to replay: a conversation whose
          // turns were all written by the host has no words of the person's
          // in it, and one still running has not finished the work yet.
          ...(live
            ? { disabledReason: 'This mission is still running. It can be saved when it finishes.' }
            : routineDraftFor(missionId) === undefined
              ? { disabledReason: 'Nothing here was typed by you, so there are no steps to replay.' }
              : {}),
          onSelect: () => openSaveRoutine(missionId)
        },
        {
          label: 'Delete',
          confirmLabel: 'Delete for good?',
          danger: true,
          ...(live ? { disabledReason: 'This mission is still running. Stop it first.' } : {}),
          onSelect: () => deleteMissionById(missionId)
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
        bridge.getMissionHistory(),
        bridge.listTeammates()
      ])
      if (next.ok) setStorage(next.data)
      if (listed.ok) setHistory(listed.data.missions)
      if (roster.ok) setMissionOwners(roster.data.missionOwners)
    }
    return response
  }
  /** Every run the shell knows about, keyed by runId (or a pending key until the receipt arrives). */
  const [runs, setRuns] = useState<RunMap>(() => new Map())
  /** Which run's thread is on screen; undefined shows the addressed teammate's idle state. */
  const [shownKey, setShownKey] = useState<string>()
  const [history, setHistory] = useState<readonly PublicRecoveredMission[]>([])
  const [teammates, setTeammates] = useState<readonly PublicTeammate[]>([])
  const [missionOwners, setMissionOwners] = useState<Readonly<Record<string, string>>>({})
  const [newTeammateOpen, setNewTeammateOpen] = useState(false)
  const [routines, setRoutines] = useState<readonly PublicRoutine[]>([])
  /** The save/edit dialog, open on a draft taken from a conversation or on a routine already saved. */
  const [routineDialog, setRoutineDialog] = useState<{
    readonly teammateId: string
    readonly routineId?: string
    readonly name: string
    readonly steps: readonly string[]
    readonly learnedFrom: readonly string[]
    readonly truncated: boolean
    readonly route?: TeammateRoute
    readonly busy: boolean
    readonly error?: string
  }>()
  /** The teammate being edited in the same dialog, when it is open for editing. */
  const [editingTeammate, setEditingTeammate] = useState<PublicTeammate>()
  const [inspectorOpen, setInspectorOpen] = useState(false)
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
  const [route, setRoute] = useState<RouteChoice>({ runtime: 'codex', model: 'account-default' })
  const [approvals, setApprovals] = useState<readonly MissionApprovalRequest[]>([])
  const [decidingIds, setDecidingIds] = useState<readonly string[]>([])
  const [models, setModels] = useState<readonly PublicModel[]>([])
  const [effort, setEffort] = useState<string>()
  const [swarm, setSwarm] = useState(false)
  const [relay, setRelay] = useState(true)
  // Which folder this window works in. Every mission runs here; a person
  // with two projects open needs the title to say which is which.
  const [workspaceName, setWorkspaceName] = useState('Local workspace')
  /** The folder itself, so activity rows can show paths the way a person writes them. */
  const [workspacePath, setWorkspacePath] = useState<string | undefined>(undefined)
  /** The folder id the host reports with history, so the sidebar can keep to it. */
  const [workspaceId, setWorkspaceId] = useState<string | undefined>(undefined)
  // Faces that just finished or just heard something: a hop and a glance, each
  // for a moment, then still. Keyed by teammate; cleared by their own timers.
  const [recentlyDone, setRecentlyDone] = useState<readonly string[]>([])
  const [recentlyReceived, setRecentlyReceived] = useState<readonly string[]>([])
  const missionOwnersRef = useRef<Readonly<Record<string, string>>>({})
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
   * Re-read what the local history costs. Deleting a mission changes it, and
   * Settings used to keep the number it read at launch until a restart.
   */
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

  const refreshHistory = (): void => {
    const bridge = window.desktop
    if (!bridge) return
    void bridge
      .getMissionHistory()
      .then((response) => {
        if (response.ok) setHistory(response.data.missions)
      })
      .catch(() => undefined)
  }

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

    const removeMissionListener = bridge.onCodexMissionUpdate((update) => {
      // A finished mission hops once; a message that just arrived earns a
      // glance. Both are moments, so both clear themselves.
      if (update.kind === 'event') {
        const runtime = update.event.sourceAdapter
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
      }
      if (update.kind === 'mission-started') {
        // A teammate replying on their own. The host started it; the renderer
        // adopts it exactly as it adopts a run it asked for, so the sidebar
        // shows them working from this moment rather than after a refresh.
        setMissionOwners((current) => ({ ...current, [update.missionId]: update.teammateId }))
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
      setRuns((current) => {
        if (current.has(update.runId)) {
          return withRun(current, update.runId, (run) => applyMissionUpdate(run, update))
        }
        // A run whose start receipt has not come back yet: hold its updates
        // until the receipt names its runId, then replay them in order.
        const queued = pendingUpdatesRef.current.get(update.runId) ?? []
        pendingUpdatesRef.current.set(update.runId, [...queued, update].slice(-500))
        return current
      })
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
        }
      })
      .catch(() => undefined)

    void bridge
      .getLocalRuntimes()
      .then((response) => {
        if (!active) return
        setRuntimeState(response.ok ? { phase: 'ready', runtimes: response.data.runtimes } : { phase: 'error' })
      })
      .catch(() => {
        if (active) setRuntimeState({ phase: 'error' })
      })

    void bridge
      .readWorkspaceSettings()
      .then((settings) => {
        if (active) {
          setSwarm(settings.swarm === true)
          setRelay(settings.relay === true)
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

    void bridge
      .listTeammates()
      .then((response) => {
        if (!active || !response.ok) return
        setTeammates(response.data.teammates)
        setMissionOwners(response.data.missionOwners)
      })
      .catch(() => {
        // The roster is optional at startup; missions still run without it.
      })

    void bridge
      .listRoutines()
      .then((response) => {
        if (!active || !response.ok) return
        setRoutines(response.data.routines)
      })
      .catch(() => {
        // Routines are optional too: without them the app is what it was.
      })

    void bridge
      .getMissionHistory()
      .then((response) => {
        if (!active || !response.ok) return
        setHistory(response.data.missions)
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
        setShownKey((current) => current ?? latest.runId)
      })
      .catch(() => {
        // History recovery is optional at startup; discovery remains usable.
      })

    return () => {
      active = false
      removeMissionListener()
      removeApprovalListener()
      stopUpdates()
    }
  }, [])

  const decideApproval = (approvalId: string, decision: MissionApprovalDecision): void => {
    const bridge = window.desktop
    if (bridge === undefined) return
    setDecidingIds((current) => [...current, approvalId])
    void bridge
      .decideMissionApproval({ approvalId, decision })
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
      if (event.key === '3') { event.preventDefault(); setScreen('settings') }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // The first teammate is addressed by default, so a roster of one never
  // needs a click before the first mission; removal falls back the same way.
  const selectedTeammate =
    teammates.find((teammate) => teammate.teammateId === selectedTeammateId) ?? teammates[0]

  /** Who a run belongs to: what it was started with, or what the host recorded. */
  const ownerOf = (run: LiveRunState): string | undefined =>
    run.teammateId ?? (run.data === undefined ? undefined : missionOwners[run.data.missionId])

  const startMission = async (prompt: string, modeOverride?: MissionMode): Promise<boolean> => {
    const bridge = window.desktop
    const teammateId = selectedTeammate?.teammateId
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
    const continuing =
      shown !== undefined
      && shown.data !== undefined
      && !liveRunIsActive(shown)
      && ownerOf(shown) === teammateId
      && shown.data.runtime === route.runtime
        ? shown
        : undefined
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
      ...(teammateId === undefined ? {} : { teammateId }),
      ...(earlierTurns.length === 0 ? {} : { earlierTurns }),
      ...(coldStart ? { coldStart: true } : {})
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
        model: chosenModelId(models, route.model, swarmEffortFor(models, route.model, swarm, effort, route.runtime)),
        ...(teammateId === undefined ? {} : { teammateId }),
        ...(continuing === undefined ? {} : { followUpOf: continuing.data!.missionId }),
        // Only sent when the chosen model advertised it; the composer cannot
        // offer an effort the catalog did not report for that model.
        // Swarm overrides the picked effort with the model's maximum, and the
        // composer shows that -- so what is sent must match what is shown.
        ...(swarmEffortFor(models, route.model, swarm, effort, route.runtime) === undefined
          ? {}
          : { effort: swarmEffortFor(models, route.model, swarm, effort, route.runtime)! })
      })
      if (!response.ok) {
        setRuns((current) =>
          withRun(current, key, (run) => ({ ...run, phase: 'failed', error: response.error.message }))
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
      return true
    } catch {
      setRuns((current) =>
        withRun(current, key, (run) => ({ ...run, phase: 'failed', error: 'The mission could not be started.' }))
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
    const bridge = window.desktop
    if (!bridge) return
    setHandingOff(true)
    try {
      const response = await bridge.resumeMission({
        missionId,
        runtime: route.runtime,
        mode,
        ...(route.model === 'account-default' ? {} : { model: route.model })
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
        model: choice.model,
        ...(swarmEffortFor(models, choice.model, swarm, effort, choice.runtime) === undefined
          ? {}
          : { effort: swarmEffortFor(models, choice.model, swarm, effort, choice.runtime)! })
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
    } catch {
      setRuns((all) =>
        withRun(all, runId, (run) => ({ ...run, phase: 'failed', error: 'The handoff request could not be delivered.' }))
      )
    } finally {
      setHandingOff(false)
    }
  }

  const cancelMission = (): void => {
    const bridge = window.desktop
    const runId = liveRun?.data?.runId
    if (!bridge || runId === undefined || !liveRunIsActive(liveRun)) return
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
              ? { ...run, phase: 'running', error: 'The cancellation request could not be delivered.' }
              : run
          )
        )
      })
  }

  const createTeammate = (input: { name: string; hue: TeammateHue; role: TeammateRole; roleTitle?: string; avatar: AvatarSpec }): void => {
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
        })
      })
      .catch(() => setTeammateError('That teammate could not be created.'))
  }

  const updateTeammate = (
    teammateId: string,
    input: { name: string; hue: TeammateHue; role: TeammateRole; roleTitle?: string; avatar: AvatarSpec }
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
        })
      })
      .catch(() => setTeammateError('That teammate could not be updated.'))
  }

  const reloadRoutines = async (): Promise<void> => {
    const bridge = window.desktop
    if (!bridge) return
    const listed = await bridge.listRoutines()
    if (listed.ok) setRoutines(listed.data.routines)
  }

  /** Open the dialog on a draft taken from a finished conversation. */
  const openSaveRoutine = (missionId: string): void => {
    const mission = historyByIdRef.current.get(missionId)
    if (mission === undefined) return
    const draft = routineDraftFor(missionId)
    const teammateId = missionOwnersRef.current[missionId]
    if (draft === undefined || teammateId === undefined) return
    const teammate = teammates.find((entry) => entry.teammateId === teammateId)
    setRoutineDialog({
      teammateId,
      name: draft.name,
      steps: draft.steps,
      learnedFrom: draft.learnedFrom,
      truncated: draft.truncated,
      // The route the routine will replay on: the teammate's own, else the
      // one this conversation actually ran on. Never a guess.
      route: teammate?.route ?? { runtime: mission.runtime, model: mission.model ?? 'account-default', mode: 'ask' },
      busy: false
    })
  }

  const saveRoutine = (input: { readonly name: string; readonly steps: readonly string[] }): void => {
    const bridge = window.desktop
    const dialog = routineDialog
    if (!bridge || dialog === undefined) return
    setRoutineDialog({ ...dialog, busy: true, error: undefined })
    const request =
      dialog.routineId === undefined
        ? bridge.createRoutine({
            name: input.name,
            teammateId: dialog.teammateId,
            route: dialog.route ?? { runtime: 'codex', model: 'account-default', mode: 'ask' },
            steps: input.steps,
            learnedFrom: dialog.learnedFrom
          })
        : bridge.updateRoutine({ routineId: dialog.routineId, name: input.name, steps: input.steps })
    void request
      .then(async (response) => {
        if (!response.ok) {
          setRoutineDialog({ ...dialog, busy: false, error: response.error.message })
          return
        }
        setRoutineDialog(undefined)
        await reloadRoutines()
      })
      .catch(() => setRoutineDialog({ ...dialog, busy: false, error: 'That routine could not be saved.' }))
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
      .catch(() => setTeammateError('That routine could not be started.'))
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
        // Their routines went with them; the host drops those, so re-read.
        await reloadRoutines()
      })
      .catch(() => undefined)
  }

  const runtimes = runtimeState.phase === 'ready' ? runtimeState.runtimes : []
  const running = liveRunIsActive(liveRun)
  /** The conversation's recorded cost, shown in the header while it is going. */
  const shownCost =
    liveRun === undefined
      ? undefined
      : costLine(conversationCost(liveRun.earlierTurns ?? [], liveRun.events))
  const runningCount = [...runs.values()].filter(liveRunIsActive).length
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
  }, [settledSignature])

  /** The addressed teammate's live run, if they have one: they cannot be given a second. */
  const busyRun = [...runs.values()].find(
    (run) => liveRunIsActive(run) && selectedTeammate !== undefined && ownerOf(run) === selectedTeammate.teammateId
  )

  /**
   * Show a run's thread. A run the shell already knows about is shown as it
   * is, live or not; anything else is reopened from the ledger. A
   * continuation opens stitched -- the root's prompt, the prior run's events,
   * the divider rebuilt from the checkpoint, then this run -- because that is
   * what the durable record says happened.
   */
  const openMission = (missionId: string): void => {
    // A run that is still starting is listed under its pending key.
    if (runs.has(missionId)) {
      setShownKey(missionId)
      return
    }
    const known = [...runs.entries()].find(([, run]) => run.data?.missionId === missionId)
    if (known !== undefined) {
      setShownKey(known[0])
      return
    }
    const mission = historyById.get(missionId)
    if (mission === undefined) return
    setRuns((current) => withNewRun(current, mission.runId, reopenedRun(mission, historyById)))
    setShownKey(mission.runId)
  }

  /**
   * Delete the shown mission's record for good. The host refuses while it is
   * live, and that refusal is shown rather than swallowed. On success the
   * mission leaves every list it was in and the thread empties, because
   * showing a thread whose record is gone would be showing a ghost.
   */
  const [deleteArmed, setDeleteArmed] = useState(false)
  const [deleteError, setDeleteError] = useState<string>()
  const deleteMissionById = (missionId: string): void => {
    const bridge = window.desktop
    if (!bridge) return
    void bridge
      .deleteMission(missionId)
      .then((response) => {
        setDeleteArmed(false)
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
        setDeleteArmed(false)
        setDeleteError('The mission could not be deleted.')
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
    }
    const theirs = [...runs.entries()].filter(([, run]) => ownerOf(run) === teammateId)
    const startedAt = (run: LiveRunState): number =>
      Date.parse(run.restoredMission?.lastUpdatedAt ?? run.events[0]?.occurredAt ?? '') || 0
    const newest = [...theirs].sort(([, left], [, right]) => startedAt(right) - startedAt(left))[0]
    const live = theirs.find(([, run]) => liveRunIsActive(run)) ?? newest
    setShownKey(live?.[0])
  }

  const sidebarMissionsRef = useRef<readonly SidebarMission[]>([])
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
      rows.push({
        missionId,
        ...(earlier[0] === undefined ? {} : { rootId: earlier[0].missionId }),
        ...(earlier.at(-1) === undefined ? {} : { parentId: earlier.at(-1)!.missionId }),
        ...(run.teammateId === undefined ? {} : { ownerId: run.teammateId }),
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
        phase: mission.phase,
        runtime: mission.runtime,
        integrityIssueCount: mission.integrityIssueCount
      })
    }
    // One row per conversation. The ledger still holds one mission per run;
    // this is only how the exchange is listed.
    return collapseConversations(rows)
  }, [history, historyById, runs, workspaceId])
  // The right-click menu is built outside render and names the row it was
  // opened on, so it reads the rows through this.
  sidebarMissionsRef.current = sidebarMissions
  historyByIdRef.current = historyById
  missionOwnersRef.current = missionOwners
  // What each teammate's live run is doing, from its events -- the same
  // function the thread's working line uses, so the two cannot disagree.
  const liveActivityByOwner: Record<string, LiveActivity> = {}
  for (const run of runs.values()) {
    const owner = ownerOf(run)
    if (owner !== undefined && liveRunIsActive(run)) liveActivityByOwner[owner] = liveActivityOf(run.events, true)
  }

  const noRuntimeReady =
    runtimeState.phase !== 'ready' || !runtimes.some((runtime) => runtime.ready && runtime.status === 'ready')

  // Whose mission is on screen: the owner the host recorded, never the
  // composer's current target, which may already be someone else.
  const missionOwner =
    liveRun === undefined
      ? undefined
      : teammates.find((teammate) => teammate.teammateId === ownerOf(liveRun))
  const shownRunId = liveRun?.data?.runId
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
  // And each teammate's face, decided once here with the same inputs the
  // sidebar uses, for the surfaces that do not compute their own status.
  const activityByTeammate: Record<string, FaceActivity> = {}
  for (const teammate of teammates) {
    const owned = sidebarMissions.filter(
      (mission) => (mission.ownerId ?? missionOwners[mission.missionId]) === teammate.teammateId
    )
    const theirRuntime = owned.find((mission) => mission.phase === 'running')?.runtime ?? owned.at(0)?.runtime
    activityByTeammate[teammate.teammateId] = teammateStatusView({
      runtime: theirRuntime === undefined ? undefined : runtimes.find((entry) => entry.id === theirRuntime),
      anyRuntimeUsable: runtimes.some(runtimeIsUsable),
      hasRunningMission: owned.some((mission) => mission.phase === 'running'),
      pendingApprovals: pendingApprovalsByOwner.get(teammate.teammateId) ?? 0,
      roleLabel: roleLabelOf(teammate),
      ...(liveActivityByOwner[teammate.teammateId] === undefined ? {} : { liveActivity: liveActivityByOwner[teammate.teammateId] }),
      recentlyDone: recentlyDone.includes(teammate.teammateId),
      recentlyReceived: recentlyReceived.includes(teammate.teammateId)
    }).activity
  }

  return (
    <div className="lc-shell">
      <TitleBar workspaceName={workspaceName} runningCount={runningCount} swarm={swarm} />
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
          missions={sidebarMissions}
          teammates={teammates}
          routineStepByTeammate={routineStepByTeammate}
          missionOwners={missionOwners}
          selectedMissionId={liveRun?.data?.missionId ?? shownKey}
          selectedTeammateId={selectedTeammate?.teammateId}
          onSelectMission={openMission}
          onMissionMenu={openMissionMenu}
          pendingApprovals={Object.fromEntries(pendingApprovalsByOwner)}
          liveActivity={liveActivityByOwner}
          recentlyDone={recentlyDone}
          recentlyReceived={recentlyReceived}
          onSelectTeammate={selectTeammate}
          onNewTeammate={() => {
            setTeammateError(undefined)
            setNewTeammateOpen(true)
          }}
          composerShown={screen === 'workroom'}
          onOpenSettings={() => setScreen(screen === 'settings' ? 'workroom' : 'settings')}
          onOpenMissions={() => setScreen(screen === 'missions' ? 'workroom' : 'missions')}
          onOpenTeammates={() => setScreen(screen === 'teammates' ? 'workroom' : 'teammates')}
        />
        <main className="lc-workroom">
          {screen === 'missions' ? (
            <MissionsScreen
              missions={history}
              runningMissionIds={
                new Set(
                  [...runs.values()]
                    .filter((run) => liveRunIsActive(run) && run.data !== undefined)
                    .map((run) => run.data!.missionId)
                )
              }
              titleOf={(mission) => missionTitle(typedPrompt(mission, historyById))}
              teammates={teammates}
              missionOwners={missionOwners}
              onOpen={(missionId) => {
                openMission(missionId)
                setScreen('workroom')
              }}
            />
          ) : screen === 'teammates' ? (
            <TeammatesScreen
              teammates={teammates}
              missions={history}
              missionOwners={missionOwners}
              activityByTeammate={activityByTeammate}
              titleOf={(mission) => missionTitle(typedPrompt(mission, historyById))}
              onOpenMission={(missionId) => {
                setScreen('workroom')
                openMission(missionId)
              }}
              routines={routines}
              routineStepByTeammate={routineStepByTeammate}
              onRunRoutine={runRoutine}
              onRemoveRoutine={removeRoutine}
              onEditRoutine={(routine) =>
                setRoutineDialog({
                  teammateId: routine.teammateId,
                  routineId: routine.routineId,
                  name: routine.name,
                  steps: routine.steps,
                  learnedFrom: routine.learnedFrom,
                  truncated: false,
                  busy: false
                })
              }
              onNewTeammate={() => {
                setTeammateError(undefined)
                setNewTeammateOpen(true)
              }}
              onEdit={(teammate) => {
                setTeammateError(undefined)
                setEditingTeammate(teammate)
              }}
              onRemove={removeTeammate}
            />
          ) : screen === 'settings' ? (
            <SettingsScreen
              runtimes={runtimes}
              limitedRuntimes={limitedRuntimes}
              ledgerPath={undefined}
              build={build}
              storage={storage}
              update={update}
              onCheckUpdate={checkUpdate}
              onInstallUpdate={installUpdate}
              relay={relay}
            onRelayChange={(next) => {
              setRelay(next)
              void window.desktop
                ?.writeWorkspaceSettings({ swarm, relay: next })
                .then((settings) => setRelay(settings.relay === true))
                .catch(() => setRelay(!next))
            }}
            onPreviewPrune={previewPrune}
              onPrune={prune}
            />
          ) : liveRun === undefined ? (
            // A teammate with nothing running gets their own capability-led
            // state; with no teammates at all, the runtime story comes first.
            teammates.length > 0 && runtimes.some((entry) => entry.ready && entry.status === 'ready') ? (
              <IdleTeammate
                teammate={selectedTeammate ?? teammates[0]!}
                canStart={busyRun === undefined}
                mode={mode}
                onStarter={(prompt) => {
                  void startMission(prompt)
                }}
              />
            ) : (
              <FirstLaunch runtimes={runtimes} limitedRuntimes={limitedRuntimes} discoveryPhase={runtimeState.phase} />
            )
          ) : (
            <>
              <header className="lc-workroom__header">
                <div className="lc-workroom__identity">
                  {missionOwner === undefined ? (
                    <AgentAvatar size={32} />
                  ) : (
                    <PixelFace
                      hue={missionOwner.hue}
                      avatar={missionOwner.avatar}
                      size={32}
                      teammateId={missionOwner.teammateId}
                      activity={
                        teammateStatusView({
                          runtime: runtimes.find((entry) => entry.id === liveRun?.data?.runtime),
                          anyRuntimeUsable: runtimes.some(runtimeIsUsable),
                          hasRunningMission: running,
                          pendingApprovals: shownApprovals.length,
                          roleLabel: missionOwner.role,
                          ...(liveActivityByOwner[missionOwner.teammateId] === undefined
                            ? {}
                            : { liveActivity: liveActivityByOwner[missionOwner.teammateId] }),
                          recentlyDone: recentlyDone.includes(missionOwner.teammateId),
                          recentlyReceived: recentlyReceived.includes(missionOwner.teammateId)
                        }).activity
                      }
                      presence={
                        running
                          ? 'working'
                          : shownApprovals.length > 0
                            ? 'approval'
                            : 'none'
                      }
                    />
                  )}
                  <div style={{ minWidth: 0 }}>
                    <div>
                      <span className="lc-workroom__name">
                        {missionOwner?.name ?? missionTitle(liveRun.prompt)}
                      </span>
                      <span className="lc-workroom__role">
                        {missionOwner === undefined ? '' : `${missionOwner.role} · `}
                        {runtimeDisplayName(liveRun.data?.runtime ?? 'codex')}
                      </span>
                    </div>
                    <div className="lc-workroom__mission">
                      {liveRun.data === undefined
                        ? isTerminal(liveRun.phase)
                          // A start that failed has no mission id and never
                          // will. Leaving "Starting…" over a red error card
                          // said the opposite of what happened.
                          ? `Mission · not started · ${liveRun.phase}`
                          : 'Starting…'
                        : `Mission · ${shortMissionId(liveRun.data.missionId)} · ${
                            running
                              ? 'running'
                              : liveRun.restored === true
                                ? 'restored from the local ledger'
                                : liveRun.phase
                          } · ${liveRun.data.sandbox === 'workspace-write' ? 'may edit the workspace' : 'read-only'}${
                            // What the conversation has actually cost, while it
                            // is still going. Silence when no turn reported a
                            // number -- never a zero, which would read as free.
                            shownCost === undefined ? '' : ` · ${running ? 'so far ' : ''}${shownCost}`
                          }`}
                    </div>
                  </div>
                </div>
                <div className="lc-workroom__actions">
                  {/*
                    Two clicks, and the second says what it does. Deletion is
                    the one thing here that cannot be undone, so it is never
                    one click away and never hidden in a menu either.
                  */}
                  {!running && (
                    <button
                      type="button"
                      className={`lc-button${deleteArmed ? ' lc-button--danger' : ''}`}
                      title={deleteArmed ? 'This removes the record for good' : 'Delete this mission'}
                      onClick={() => {
                        if (deleteArmed) {
                          const shownId = liveRun?.data?.missionId
                          if (shownId !== undefined) deleteMissionById(shownId)
                        }
                        else {
                          setDeleteError(undefined)
                          setDeleteArmed(true)
                        }
                      }}
                      onBlur={() => setDeleteArmed(false)}
                    >
                      {deleteArmed ? 'Delete for good?' : 'Delete'}
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
              {deleteError !== undefined && (
                <div className="lc-diagnostic lc-tone-red" role="alert">
                  <Icon name="shield" size={12} />
                  <span>{deleteError}</span>
                </div>
              )}
              <Thread
                prompt={liveRun.prompt}
                earlierTurns={liveRun.earlierTurns ?? []}
                coldStart={liveRun.coldStart ?? false}
                workspacePath={workspacePath}
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
                        setMode('accept-edits')
                        void startMission(liveRun.prompt, 'accept-edits')
                      }
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
                missionId={liveRun.data?.missionId}
                restoredMission={liveRun.restored === true ? liveRun.restoredMission : undefined}
                error={liveRun.error}
                errorIsPersistence={liveRun.errorIsPersistence === true}
                approvals={shownApprovals}
                onDecide={decideApproval}
                decidingIds={decidingIds}
                cancelled={liveRun.phase === 'cancelled'}
                handoff={liveRun.handoff}
                peers={{
                  self: missionOwner,
                  teammates,
                  messages: liveRun.peerMessages ?? [],
                  notices: liveRun.peerNotices ?? []
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
          {screen === 'workroom' && <UpdateBanner update={update} onInstall={installUpdate} />}
          {screen === 'workroom' && (
          <Composer
            runtimes={runtimes}
            limitedRuntimes={limitedRuntimes}
            discoveryPhase={runtimeState.phase}
            running={running}
            cancelling={liveRun?.phase === 'cancelling'}
            activeRoute={liveRun?.data}
            // What the composer SHOWS has to be what will actually run.
            // A teammate can carry a stored mode their route cannot honour
            // (Claude Code kept on Accept edits from before), and showing it
            // would promise an edit the host is about to refuse.
            mode={
              modeRunsOn(mode, route.runtime, build?.platform)
                ? mode
                : modesFor(route.runtime, build?.platform)[0] ?? mode
            }
            onModeChange={setMode}
            route={route}
            onRouteChange={(next) => {
              setRoute(next)
              // Effort belongs to a model. Carrying it across a model switch
              // could send a level the new model never advertised.
              setEffort(undefined)
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
              void window.desktop
                ?.writeWorkspaceSettings({ swarm: next, relay })
                .then((settings) => setSwarm(settings.swarm === true))
                .catch(() => setSwarm(!next))
            }}
            error={
              noRuntimeReady && runtimeState.phase === 'ready'
                ? 'No runtime is signed in. Locust runs on the CLIs already on this machine; sign in to one and it appears here.'
                : undefined
            }
            onStart={startMission}
            onCancel={cancelMission}
            onOpenRoutePicker={() => undefined}
            onHandOff={(choice) => { void handOffMission(choice) }}
            handingOff={handingOff}
            teammateName={selectedTeammate?.name}
            busyWith={busyRun === undefined ? undefined : (selectedTeammate?.name ?? 'This teammate')}
          />
          )}
        </main>
        {inspectorOpen && liveRun !== undefined && (
          <Inspector
            events={liveRun.events}
            running={running}
            route={liveRun.data}
            restoredMission={liveRun.restoredMission}
            onClose={() => setInspectorOpen(false)}
          />
        )}
      </div>
      {paletteOpen && (
        <CommandPalette
          onClose={() => setPaletteOpen(false)}
          actions={
            [
              {
                id: 'go-workroom',
                group: 'Go to',
                label: 'Workroom',
                run: () => setScreen('workroom')
              },
              { id: 'go-missions', group: 'Go to', label: 'Missions', hint: 'Ctrl 1', run: () => setScreen('missions') },
              {
                id: 'go-teammates',
                group: 'Go to',
                label: 'Team',
                hint: 'Ctrl 2',
                run: () => setScreen('teammates')
              },
              { id: 'go-settings', group: 'Go to', label: 'Settings', hint: 'Ctrl 3', run: () => setScreen('settings') },
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
      {newTeammateOpen && (
        <NewTeammateDialog
          error={teammateError}
          onCancel={() => setNewTeammateOpen(false)}
          onCreate={createTeammate}
        />
      )}
      {editingTeammate !== undefined && (
        <NewTeammateDialog
          key={editingTeammate.teammateId}
          initial={editingTeammate}
          error={teammateError}
          onCancel={() => setEditingTeammate(undefined)}
          onCreate={(input) => updateTeammate(editingTeammate.teammateId, input)}
        />
      )}
      {routineDialog !== undefined && (
        <RoutineDialog
          key={routineDialog.routineId ?? 'new'}
          teammate={teammates.find((entry) => entry.teammateId === routineDialog.teammateId)}
          initialName={routineDialog.name}
          initialSteps={routineDialog.steps}
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
