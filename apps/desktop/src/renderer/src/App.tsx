import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'

import type { MissionRuntimeId, NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

import type { AvatarSpec } from '../../shared/avatar.js'

import type {
  CodexMissionUpdate,
  MissionRouteSummary,
  PublicRecoveredMission,
  PublicRuntimeStatus,
  MissionApprovalDecision,
  MissionApprovalRequest,
  MissionMode,
  PublicModel,
  PublicPeerMessage,
  PublicTeammate,
  TeammateHue,
  TeammateRole
} from '../../shared/ipc.js'
import { Composer } from './components/Composer.js'
import { FirstLaunch } from './components/FirstLaunch.js'
import { CommandPalette } from './components/CommandPalette.js'
import type { PaletteAction } from './components/CommandPalette.js'
import { IdleTeammate } from './components/IdleTeammate.js'
import { Inspector } from './components/Inspector.js'
import { MissionsScreen, SettingsScreen, TeammatesScreen } from './components/Screens.js'
import type { RouteChoice } from './components/RoutePicker.js'
import type { Screen } from './components/Screens.js'
import { Icon } from './components/Icon.js'
import { NewTeammateDialog } from './components/NewTeammateDialog.js'
import { PixelFace } from './components/PixelFace.js'
import { Sidebar } from './components/Sidebar.js'
import type { SidebarMission } from './components/Sidebar.js'
import { Thread } from './components/Thread.js'
import { AgentAvatar } from './components/ThreadItems.js'
import { TitleBar } from './components/TitleBar.js'
import { conversationTurns, resolvedModelNames, rootMission, stitchedHandoff } from './missionView.js'
import { shortMissionId } from './status.js'

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
  if (update.kind === 'peer-share-failed') {
    return { ...live, peerNotices: [...(live.peerNotices ?? []), update.message] }
  }

  const events = [...live.events, update.event].slice(-500)
  if (update.event.type === 'run.completed') return { ...live, events, phase: 'completed' }
  if (update.event.type === 'run.cancelled') return { ...live, events, phase: 'cancelled' }
  if (update.event.type === 'run.failed') {
    return { ...live, events, phase: 'failed', error: update.event.payload.message }
  }
  return { ...live, events, phase: live.phase === 'starting' ? 'running' : live.phase }
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

function missionTitle(prompt: string): string {
  const trimmed = prompt.trim().split('\n')[0] ?? prompt
  return trimmed.length > 44 ? `${trimmed.slice(0, 44).trimEnd()}…` : trimmed
}

export default function App(): ReactElement {
  const [runtimeState, setRuntimeState] = useState<RuntimeDiscoveryState>({ phase: 'loading' })
  /** Every run the shell knows about, keyed by runId (or a pending key until the receipt arrives). */
  const [runs, setRuns] = useState<RunMap>(() => new Map())
  /** Which run's thread is on screen; undefined shows the addressed teammate's idle state. */
  const [shownKey, setShownKey] = useState<string>()
  const [history, setHistory] = useState<readonly PublicRecoveredMission[]>([])
  const [teammates, setTeammates] = useState<readonly PublicTeammate[]>([])
  const [missionOwners, setMissionOwners] = useState<Readonly<Record<string, string>>>({})
  const [newTeammateOpen, setNewTeammateOpen] = useState(false)
  /** The teammate being edited in the same dialog, when it is open for editing. */
  const [editingTeammate, setEditingTeammate] = useState<PublicTeammate>()
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [screen, setScreen] = useState<Screen>('workroom')
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [mode, setMode] = useState<MissionMode>('ask')
  const [route, setRoute] = useState<RouteChoice>({ runtime: 'codex', model: 'account-default' })
  const [approvals, setApprovals] = useState<readonly MissionApprovalRequest[]>([])
  const [decidingIds, setDecidingIds] = useState<readonly string[]>([])
  const [models, setModels] = useState<readonly PublicModel[]>([])
  const [effort, setEffort] = useState<string>()
  const [swarm, setSwarm] = useState(false)
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
        if (active) setSwarm(settings.swarm === true)
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
      .getMissionHistory()
      .then((response) => {
        if (!active || !response.ok) return
        setHistory(response.data.missions)
        const latest = response.data.missions[0]
        if (latest === undefined) return
        // The most recent mission opens on launch, restored from the ledger.
        // Any update addressed to it (a run the host still owns) makes it live.
        setRuns((current) => {
          if (current.size > 0) return current
          const queued = pendingUpdatesRef.current.get(latest.runId) ?? []
          pendingUpdatesRef.current.delete(latest.runId)
          return withNewRun(current, latest.runId, queued.reduce(applyMissionUpdate, restoredLiveRun(latest)))
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
    }
  }, [])

  const decideApproval = (approvalId: string, decision: MissionApprovalDecision): void => {
    const bridge = window.desktop
    if (bridge === undefined) return
    setDecidingIds((current) => [...current, approvalId])
    void bridge
      .decideMissionApproval({ approvalId, decision })
      .catch(() => undefined)
      .finally(() => {
        // The card goes once the answer is delivered, whatever it was --
        // leaving it up would invite a second click on a settled action.
        setApprovals((current) => current.filter((entry) => entry.approvalId !== approvalId))
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

  const startMission = async (prompt: string): Promise<boolean> => {
    const bridge = window.desktop
    const teammateId = selectedTeammate?.teammateId
    const key = `pending:${++pendingKeyCounter.current}`
    // A reply continues the conversation on screen, when there IS one to
    // continue: the same teammate's finished mission, on the route it ran on.
    // Anything else is a new mission, which is what a person means when they
    // switch teammate or route first.
    const shown = liveRunRef.current
    const continuing =
      shown !== undefined
      && shown.data !== undefined
      && !liveRunIsActive(shown)
      && ownerOf(shown) === teammateId
      && shown.data.runtime === route.runtime
        ? shown
        : undefined
    const earlierTurns = continuing === undefined
      ? []
      : [
          ...(continuing.earlierTurns ?? []),
          { missionId: continuing.data!.missionId, prompt: continuing.prompt, events: continuing.events }
        ]
    const starting: LiveRunState = {
      prompt,
      phase: 'starting',
      events: [],
      ...(teammateId === undefined ? {} : { teammateId }),
      ...(earlierTurns.length === 0 ? {} : { earlierTurns })
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
        mode,
        runtime: route.runtime,
        model: route.model,
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
        return false
      }

      const runId = response.data.runId
      // The host recorded the owner; mirror it so the sidebar files the
      // mission under the teammate at once rather than after a refresh.
      if (teammateId !== undefined) {
        const missionId = response.data.missionId
        setMissionOwners((current) => ({ ...current, [missionId]: teammateId }))
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

  const createTeammate = (input: { name: string; hue: TeammateHue; role: TeammateRole; avatar: AvatarSpec }): void => {
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
    input: { name: string; hue: TeammateHue; role: TeammateRole; avatar: AvatarSpec }
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

  const removeTeammate = (teammateId: string): void => {
    const bridge = window.desktop
    if (!bridge) return
    void bridge
      .removeTeammate(teammateId)
      .then(() => bridge.listTeammates())
      .then((listed) => {
        if (!listed.ok) return
        setTeammates(listed.data.teammates)
        setMissionOwners(listed.data.missionOwners)
      })
      .catch(() => undefined)
  }

  const runtimes = runtimeState.phase === 'ready' ? runtimeState.runtimes : []
  const running = liveRunIsActive(liveRun)
  const runningCount = [...runs.values()].filter(liveRunIsActive).length
  const historyById = useMemo(
    () => new Map(history.map((mission) => [mission.missionId, mission] as const)),
    [history]
  )
  // What each route's model turned out to be, from missions that already ran.
  const resolvedModels = useMemo(() => resolvedModelNames(history), [history])

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
    const restored = restoredLiveRun(mission)
    const handoff = stitchedHandoff(mission, historyById)
    // Every earlier turn of this conversation, rebuilt from the ledger, so a
    // reopened exchange reads the way it did when it happened.
    const turns = conversationTurns(mission, historyById)
    const earlier = turns.slice(0, -1)
    setRuns((current) =>
      withNewRun(current, mission.runId, {
        ...restored,
        prompt: rootMission(mission, historyById).prompt,
        ...(earlier.length === 0
          ? {}
          : {
              earlierTurns: earlier.map((turn) => ({
                missionId: turn.missionId,
                prompt: turn.prompt,
                events: turn.events
              }))
            }),
        ...(handoff === undefined ? {} : { handoff })
      })
    )
    setShownKey(mission.runId)
  }

  /** Address a teammate, and look at what they are doing (or their idle state). */
  const selectTeammate = (teammateId: string): void => {
    setSelectedTeammateId(teammateId)
    setScreen('workroom')
    const theirs = [...runs.entries()].filter(([, run]) => ownerOf(run) === teammateId)
    const live = theirs.find(([, run]) => liveRunIsActive(run)) ?? theirs.at(-1)
    setShownKey(live?.[0])
  }

  const sidebarMissions = useMemo<readonly SidebarMission[]>(() => {
    const rows: SidebarMission[] = []
    for (const [key, run] of runs.entries()) {
      // A run that is still starting has no missionId yet; it is listed under
      // its pending key so the teammate reads as working from the first
      // moment, not from the first receipt.
      const missionId = run.data?.missionId ?? key
      if (rows.some((row) => row.missionId === missionId)) continue
      rows.push({
        missionId,
        ...(run.teammateId === undefined ? {} : { ownerId: run.teammateId }),
        // A run's thread already shows the root's words for a continuation.
        title: missionTitle(run.prompt),
        phase: liveRunIsActive(run) ? 'running' : isTerminal(run.phase) ? (run.phase as 'completed' | 'failed' | 'cancelled') : 'interrupted',
        integrityIssueCount: run.restoredMission?.integrityIssueCount ?? 0
      })
    }
    for (const mission of history) {
      if (rows.some((row) => row.missionId === mission.missionId)) continue
      rows.push({
        missionId: mission.missionId,
        // A continuation's own prompt is the briefing; name it by the words
        // the person typed at the start of the chain.
        title: missionTitle(rootMission(mission, historyById).prompt),
        phase: mission.phase,
        integrityIssueCount: mission.integrityIssueCount
      })
    }
    return rows
  }, [history, historyById, runs])

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

  return (
    <div className="lc-shell">
      <TitleBar workspaceName="Local workspace" runningCount={runningCount} swarm={swarm} />
      <div className="lc-body">
        <Sidebar
          runtimes={runtimes}
          missions={sidebarMissions}
          teammates={teammates}
          missionOwners={missionOwners}
          selectedMissionId={liveRun?.data?.missionId ?? shownKey}
          selectedTeammateId={selectedTeammate?.teammateId}
          onSelectMission={openMission}
          pendingApprovals={Object.fromEntries(pendingApprovalsByOwner)}
          onSelectTeammate={selectTeammate}
          onNewTeammate={() => {
            setTeammateError(undefined)
            setNewTeammateOpen(true)
          }}
          onOpenSettings={() => setScreen(screen === 'settings' ? 'workroom' : 'settings')}
        />
        <main className="lc-workroom">
          {screen === 'missions' ? (
            <MissionsScreen
              missions={history}
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
              missionOwners={missionOwners}
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
            <SettingsScreen runtimes={runtimes} ledgerPath={undefined} />
          ) : liveRun === undefined ? (
            // A teammate with nothing running gets their own capability-led
            // state; with no teammates at all, the runtime story comes first.
            teammates.length > 0 && runtimes.some((entry) => entry.ready && entry.status === 'ready') ? (
              <IdleTeammate
                teammate={selectedTeammate ?? teammates[0]!}
                canStart={busyRun === undefined}
                onStarter={(prompt) => {
                  void startMission(prompt)
                }}
              />
            ) : (
              <FirstLaunch runtimes={runtimes} discoveryPhase={runtimeState.phase} />
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
                      activity={running ? 'working' : 'still'}
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
                        {liveRun.data?.runtime === 'claude' ? 'Claude Code' : 'Codex CLI'}
                      </span>
                    </div>
                    <div className="lc-workroom__mission">
                      {liveRun.data === undefined
                        ? 'Starting…'
                        : `Mission · ${shortMissionId(liveRun.data.missionId)} · ${
                            running
                              ? 'running'
                              : liveRun.restored === true
                                ? 'restored from the local ledger'
                                : liveRun.phase
                          } · ${liveRun.data.sandbox === 'workspace-write' ? 'may edit the workspace' : 'read-only'}`}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  className={`lc-button${inspectorOpen ? ' is-active' : ''}`}
                  aria-pressed={inspectorOpen}
                  onClick={() => setInspectorOpen(!inspectorOpen)}
                >
                  <Icon name="activity" size={13} /> Activity
                </button>
              </header>
              <Thread
                prompt={liveRun.prompt}
                earlierTurns={liveRun.earlierTurns ?? []}
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
                    : new Date(liveRun.restoredMission.createdAt).toLocaleTimeString(undefined, {
                        hour: '2-digit',
                        minute: '2-digit'
                      })
                }
              />
            </>
          )}
          {screen === 'workroom' && (
          <Composer
            runtimes={runtimes}
            discoveryPhase={runtimeState.phase}
            running={running}
            cancelling={liveRun?.phase === 'cancelling'}
            activeRoute={liveRun?.data}
            mode={mode}
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
            effort={effort}
            onEffortChange={setEffort}
            swarm={swarm}
            onSwarmChange={(next) => {
              // Optimistic, then reconciled with what the store actually
              // saved -- a rejected write must not leave the chip claiming a
              // setting that is not on disk.
              setSwarm(next)
              void window.desktop
                ?.writeWorkspaceSettings({ swarm: next })
                .then((settings) => setSwarm(settings.swarm === true))
                .catch(() => setSwarm(!next))
            }}
            error={noRuntimeReady && runtimeState.phase === 'ready' ? undefined : undefined}
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
                label: 'Teammates',
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
    </div>
  )
}
