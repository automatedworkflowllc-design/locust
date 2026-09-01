import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'

import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

import type {
  CodexMissionUpdate,
  MissionRouteSummary,
  PublicRecoveredMission,
  PublicRuntimeStatus,
  PublicTeammate,
  TeammateHue,
  TeammateRole
} from '../../shared/ipc.js'
import { Composer } from './components/Composer.js'
import { FirstLaunch } from './components/FirstLaunch.js'
import { Inspector } from './components/Inspector.js'
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
      cliVersion: mission.cliVersion
    },
    phase: mission.phase,
    events: mission.events,
    ...(error === undefined ? {} : { error }),
    restored: true,
    restoredMission: mission
  }
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
    }
  }, [])

  const startMission = async (prompt: string): Promise<boolean> => {
    const bridge = window.desktop
    activeRunIdRef.current = undefined
    pendingUpdatesRef.current.clear()
    setLiveRun({ prompt, phase: 'starting', events: [] })
    if (!bridge) {
      setLiveRun({ prompt, phase: 'failed', events: [], error: 'The secure desktop bridge is unavailable.' })
      return false
    }

    try {
      const response = await bridge.startCodexMission({ prompt })
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
      <TitleBar workspaceName="Local workspace" runningCount={running ? 1 : 0} />
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
          onOpenSettings={() => undefined}
        />
        <main className="lc-workroom">
          {liveRun === undefined ? (
            <FirstLaunch runtimes={runtimes} discoveryPhase={runtimeState.phase} />
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
          <Composer
            runtimes={runtimes}
            discoveryPhase={runtimeState.phase}
            running={running}
            cancelling={liveRun?.phase === 'cancelling'}
            activeRoute={liveRun?.data}
            error={noRuntimeReady && runtimeState.phase === 'ready' ? undefined : undefined}
            onStart={startMission}
            onCancel={cancelMission}
            onOpenRoutePicker={() => undefined}
          />
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
