import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'

import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

import type {
  CodexMissionUpdate,
  MissionRouteSummary,
  PublicRecoveredMission,
  PublicRuntimeStatus,
  MissionApprovalDecision,
  MissionApprovalRequest,
  MissionMode,
  PublicModel,
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
import { Sidebar } from './components/Sidebar.js'
import type { SidebarMission } from './components/Sidebar.js'
import { Thread } from './components/Thread.js'
import { AgentAvatar } from './components/ThreadItems.js'
import { TitleBar } from './components/TitleBar.js'
import { shortMissionId } from './status.js'

/**
 * The Locust shell.
 *
 * The mission state machine below is carried over unchanged from the previous
 * shell -- persist-before-emit ordering, queued updates for a run whose start
 * response has not arrived yet, a restored receipt that becomes live again on
 * any update, and one active run at a time. Only the rendering is new.
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
}

type RuntimeDiscoveryState =
  | { readonly phase: 'loading' }
  | { readonly phase: 'ready'; readonly runtimes: readonly PublicRuntimeStatus[] }
  | { readonly phase: 'error' }

function liveRunIsActive(run: LiveRunState | undefined): boolean {
  return run !== undefined && (run.phase === 'starting' || run.phase === 'running' || run.phase === 'cancelling')
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
    restoredMission: mission
  }
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
  chosen: string | undefined
): string | undefined {
  if (!swarm) return chosen
  const supported = models.find((model) => model.id === modelId)?.supportedEfforts ?? []
  return supported[supported.length - 1]
}

function missionTitle(prompt: string): string {
  const trimmed = prompt.trim().split('\n')[0] ?? prompt
  return trimmed.length > 44 ? `${trimmed.slice(0, 44).trimEnd()}…` : trimmed
}

export default function App(): ReactElement {
  const [runtimeState, setRuntimeState] = useState<RuntimeDiscoveryState>({ phase: 'loading' })
  const [liveRun, setLiveRun] = useState<LiveRunState>()
  const [history, setHistory] = useState<readonly PublicRecoveredMission[]>([])
  const [teammates, setTeammates] = useState<readonly PublicTeammate[]>([])
  const [missionOwners, setMissionOwners] = useState<Readonly<Record<string, string>>>({})
  const [newTeammateOpen, setNewTeammateOpen] = useState(false)
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
  const pendingUpdatesRef = useRef(new Map<string, CodexMissionUpdate[]>())
  const activeRunIdRef = useRef<string | undefined>(undefined)

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
      setLiveRun((current) => {
        if (current !== undefined && (current.data?.runId === update.runId || activeRunIdRef.current === update.runId)) {
          return applyMissionUpdate(current, update)
        }
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
        setLiveRun((current) => {
          if (current !== undefined) return current
          const queued = pendingUpdatesRef.current.get(latest.runId) ?? []
          pendingUpdatesRef.current.delete(latest.runId)
          return queued.reduce(applyMissionUpdate, restoredLiveRun(latest))
        })
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

  const startMission = async (prompt: string): Promise<boolean> => {
    const bridge = window.desktop
    activeRunIdRef.current = undefined
    pendingUpdatesRef.current.clear()
    setLiveRun({ prompt, phase: 'starting', events: [] })
    // A new mission cannot inherit the previous one's pending questions.
    setApprovals([])
    setDecidingIds([])
    if (!bridge) {
      setLiveRun({ prompt, phase: 'failed', events: [], error: 'The secure desktop bridge is unavailable.' })
      return false
    }

    try {
      const response = await bridge.startCodexMission({
        prompt,
        mode,
        runtime: route.runtime,
        model: route.model,
        // Only sent when the chosen model advertised it; the composer cannot
        // offer an effort the catalog did not report for that model.
        // Swarm overrides the picked effort with the model's maximum, and the
        // composer shows that -- so what is sent must match what is shown.
        ...(swarmEffortFor(models, route.model, swarm, effort) === undefined
          ? {}
          : { effort: swarmEffortFor(models, route.model, swarm, effort)! })
      })
      if (!response.ok) {
        activeRunIdRef.current = undefined
        setLiveRun({ prompt, phase: 'failed', events: [], error: response.error.message })
        return false
      }

      activeRunIdRef.current = response.data.runId
      const queued = pendingUpdatesRef.current.get(response.data.runId) ?? []
      pendingUpdatesRef.current.delete(response.data.runId)
      setLiveRun((current) => {
        let next: LiveRunState = {
          prompt,
          data: response.data,
          phase:
            current?.phase === 'completed' || current?.phase === 'failed' || current?.phase === 'cancelled'
              ? current.phase
              : 'running',
          events: current?.prompt === prompt ? current.events : [],
          ...(current?.error === undefined ? {} : { error: current.error })
        }
        for (const update of queued) next = applyMissionUpdate(next, update)
        return next
      })
      return true
    } catch {
      activeRunIdRef.current = undefined
      setLiveRun({ prompt, phase: 'failed', events: [], error: 'The mission could not be started.' })
      return false
    }
  }

  const cancelMission = (): void => {
    const bridge = window.desktop
    const runId = liveRun?.data?.runId
    if (!bridge || runId === undefined || !liveRunIsActive(liveRun)) return
    setLiveRun((current) =>
      current?.data?.runId === runId ? { ...current, phase: 'cancelling', error: undefined } : current
    )
    void bridge
      .cancelCodexMission({ runId })
      .then((response) => {
        if (response.ok) return
        setLiveRun((current) =>
          current?.data?.runId === runId && liveRunIsActive(current)
            ? { ...current, phase: 'running', error: response.error.message }
            : current
        )
      })
      .catch(() => {
        setLiveRun((current) =>
          current?.data?.runId === runId && liveRunIsActive(current)
            ? { ...current, phase: 'running', error: 'The cancellation request could not be delivered.' }
            : current
        )
      })
  }

  const createTeammate = (input: { name: string; hue: TeammateHue; role: TeammateRole }): void => {
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

  const sidebarMissions = useMemo<readonly SidebarMission[]>(() => {
    const rows: SidebarMission[] = []
    if (liveRun?.data !== undefined) {
      rows.push({
        missionId: liveRun.data.missionId,
        title: missionTitle(liveRun.prompt),
        phase: running
          ? 'running'
          : liveRun.phase === 'completed' || liveRun.phase === 'failed' || liveRun.phase === 'cancelled'
            ? liveRun.phase
            : 'interrupted',
        integrityIssueCount: liveRun.restoredMission?.integrityIssueCount ?? 0
      })
    }
    for (const mission of history) {
      if (rows.some((row) => row.missionId === mission.missionId)) continue
      rows.push({
        missionId: mission.missionId,
        title: missionTitle(mission.prompt),
        phase: mission.phase,
        integrityIssueCount: mission.integrityIssueCount
      })
    }
    return rows
  }, [history, liveRun, running])

  const noRuntimeReady =
    runtimeState.phase !== 'ready' || !runtimes.some((runtime) => runtime.ready && runtime.status === 'ready')

  return (
    <div className="lc-shell">
      <TitleBar workspaceName="Local workspace" runningCount={running ? 1 : 0} swarm={swarm} />
      <div className="lc-body">
        <Sidebar
          runtimes={runtimes}
          missions={sidebarMissions}
          teammates={teammates}
          missionOwners={missionOwners}
          selectedMissionId={liveRun?.data?.missionId}
          onSelectMission={() => undefined}
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
              onOpen={() => setScreen('workroom')}
            />
          ) : screen === 'teammates' ? (
            <TeammatesScreen
              teammates={teammates}
              missionOwners={missionOwners}
              onNewTeammate={() => {
                setTeammateError(undefined)
                setNewTeammateOpen(true)
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
                teammate={teammates[0]!}
                canStart
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
                  <AgentAvatar size={32} />
                  <div style={{ minWidth: 0 }}>
                    <div>
                      <span className="lc-workroom__name">{missionTitle(liveRun.prompt)}</span>
                      <span className="lc-workroom__role">
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
                          } · read-only`}
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
                events={liveRun.events}
                running={running}
                missionId={liveRun.data?.missionId}
                restoredMission={liveRun.restored === true ? liveRun.restoredMission : undefined}
                error={liveRun.error}
                errorIsPersistence={liveRun.errorIsPersistence === true}
                approvals={approvals}
                onDecide={decideApproval}
                decidingIds={decidingIds}
                cancelled={liveRun.phase === 'cancelled'}
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
    </div>
  )
}
