import { FormEvent, KeyboardEvent, ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import type {
  MissionRouteSummary,
  CodexMissionUpdate,
  PublicRecoveredMission,
  PublicRuntimeStatus,
  RuntimeProbeStatus
} from '../../shared/ipc.js'

type IconName =
  | 'activity'
  | 'arrow-up'
  | 'attachment'
  | 'check'
  | 'chevron-down'
  | 'chevron-right'
  | 'clock'
  | 'close'
  | 'code'
  | 'command'
  | 'dots'
  | 'file'
  | 'grid'
  | 'inbox'
  | 'maximize'
  | 'message'
  | 'minimize'
  | 'pause'
  | 'play'
  | 'plus'
  | 'route'
  | 'search'
  | 'settings'
  | 'shield'
  | 'spark'
  | 'terminal'
  | 'users'

function Icon({ name, size = 16 }: { name: IconName; size?: number }): ReactNode {
  const paths: Record<IconName, ReactNode> = {
    activity: <path d="M3 12h3l2.1-6 3.8 12L14 12h7" />,
    'arrow-up': <><path d="m6 10 6-6 6 6" /><path d="M12 4v16" /></>,
    attachment: <path d="m20.5 11.5-8.9 8.9a6 6 0 0 1-8.5-8.5l9.6-9.6a4 4 0 0 1 5.7 5.7l-9.6 9.6A2 2 0 1 1 6 14.8l8.9-8.9" />,
    check: <path d="m5 12 4 4L19 6" />,
    'chevron-down': <path d="m7 10 5 5 5-5" />,
    'chevron-right': <path d="m9 18 6-6-6-6" />,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    close: <><path d="m7 7 10 10" /><path d="M17 7 7 17" /></>,
    code: <><path d="m8 9-4 3 4 3" /><path d="m16 9 4 3-4 3" /><path d="m14 5-4 14" /></>,
    command: <path d="M9 6V5a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v14a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6Z" />,
    dots: <><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" /></>,
    file: <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v5h5" /></>,
    grid: <><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></>,
    inbox: <><path d="M4 5h16v13H4z" /><path d="M4 13h4l2 3h4l2-3h4" /></>,
    maximize: <rect x="5" y="5" width="14" height="14" rx="1" />,
    message: <path d="M4 5h16v12H9l-5 4z" />,
    minimize: <path d="M5 12h14" />,
    pause: <><path d="M9 7v10" /><path d="M15 7v10" /></>,
    play: <path d="m9 7 8 5-8 5z" />,
    plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
    route: <><circle cx="6" cy="6" r="2" /><circle cx="18" cy="18" r="2" /><path d="M8 6h4a4 4 0 0 1 4 4v4" /><path d="m13 12 3 3 3-3" /></>,
    search: <><circle cx="11" cy="11" r="7" /><path d="m16 16 4 4" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" /></>,
    shield: <><path d="M12 3 5 6v5c0 4.7 2.8 8.2 7 10 4.2-1.8 7-5.3 7-10V6z" /><path d="m9 12 2 2 4-5" /></>,
    spark: <><path d="m12 3 1.3 4.3L18 9l-4.7 1.7L12 15l-1.3-4.3L6 9l4.7-1.7z" /><path d="m18.5 15 .7 2.2 2.3.8-2.3.8-.7 2.2-.7-2.2-2.3-.8 2.3-.8z" /></>,
    terminal: <><path d="m5 7 4 4-4 4" /><path d="M11 16h8" /></>,
    users: <><circle cx="9" cy="8" r="3" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0" /><path d="M15 6.5a3 3 0 0 1 0 5.8" /><path d="M17 14a5 5 0 0 1 3.5 5" /></>
  }

  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  )
}

type MissionStatus = 'running' | 'approval' | 'queued' | 'stopped' | 'complete'

interface Mission {
  id: number
  title: string
  teammate: string
  teammateInitials: string
  status: MissionStatus
  time: string
  unread?: number
  accent: string
}

const missions: Mission[] = [
  { id: 1, title: 'Renewal campaign', teammate: 'Maya · Growth', teammateInitials: 'MY', status: 'running', time: 'Now', unread: 3, accent: '#c2f66f' },
  { id: 2, title: 'Q3 competitor brief', teammate: 'Atlas · Research', teammateInitials: 'AT', status: 'approval', time: '8m', unread: 1, accent: '#8db5ff' },
  { id: 3, title: 'Reconcile July expenses', teammate: 'Ledger · Finance', teammateInitials: 'LD', status: 'queued', time: '24m', accent: '#c69cff' },
  { id: 4, title: 'Support trends digest', teammate: 'Nora · Support', teammateInitials: 'NO', status: 'complete', time: '1h', accent: '#ffb07c' },
  { id: 5, title: 'Vendor security review', teammate: 'Aegis · Operations', teammateInitials: 'AE', status: 'complete', time: '3h', accent: '#77ddd1' }
]

interface RouteOption {
  runtime: string
  model: string
  source: string
  badge: string
  tone: 'lime' | 'blue' | 'violet' | 'neutral'
}

const routes: RouteOption[] = [
  { runtime: 'Codex', model: 'Account default', source: 'Detected local account', badge: 'LIVE', tone: 'lime' },
  { runtime: 'Claude Code', model: 'Claude Sonnet 5', source: 'Example account route', badge: 'STANDBY', tone: 'blue' },
  { runtime: 'OmniRoute', model: 'Qwen3 Coder', source: 'Example free route', badge: 'FREE', tone: 'violet' },
  { runtime: 'Ollama', model: 'Devstral Small', source: 'Example local route', badge: 'LOCAL', tone: 'neutral' }
]

type CodexRuntimeEvent = Extract<CodexMissionUpdate, { readonly kind: 'event' }>['event']
type LiveRunPhase = 'starting' | 'running' | 'cancelling' | 'completed' | 'failed' | 'cancelled' | 'interrupted'

interface LiveRunState {
  readonly prompt: string
  readonly data?: MissionRouteSummary
  readonly phase: LiveRunPhase
  readonly events: readonly CodexRuntimeEvent[]
  readonly error?: string
  readonly restored?: boolean
  readonly eventCount?: number
  readonly eventsTruncated?: boolean
  readonly integrityIssueCount?: number
}

function liveRunIsActive(run: LiveRunState | undefined): boolean {
  return run?.phase === 'starting' || run?.phase === 'running' || run?.phase === 'cancelling'
}

function applyMissionUpdate(run: LiveRunState, update: CodexMissionUpdate): LiveRunState {
  // Any update for this runId proves the host still owns the run: a receipt
  // restored from the ledger stops being "restored" and becomes live again,
  // so the stop control and live status reflect the real process.
  let live: LiveRunState = run
  if (run.restored === true) {
    const { error: _staleError, ...rest } = run
    live = { ...rest, restored: false, phase: 'running' }
  }
  if (update.kind === 'transport-error' || update.kind === 'persistence-error') {
    return { ...live, phase: 'failed', error: update.error.message }
  }

  const events = [...live.events, update.event].slice(-500)
  if (update.event.type === 'run.completed') return { ...live, events, phase: 'completed' }
  if (update.event.type === 'run.cancelled') return { ...live, events, phase: 'cancelled' }
  if (update.event.type === 'run.failed') {
    return { ...live, events, phase: 'failed', error: update.event.payload.message }
  }
  return { ...live, events, phase: live.phase === 'starting' ? 'running' : live.phase }
}

function missionForLiveRun(run: LiveRunState): Mission {
  const shortPrompt = run.prompt.length > 42 ? `${run.prompt.slice(0, 42).trimEnd()}…` : run.prompt
  const status: MissionStatus = run.phase === 'completed'
    ? 'complete'
    : run.phase === 'failed' || run.phase === 'cancelled' || run.phase === 'interrupted'
      ? 'stopped'
      : 'running'
  return {
    id: 1,
    title: shortPrompt,
    teammate: 'Codex · Read-only',
    teammateInitials: 'CX',
    status,
    time: run.phase === 'completed' ? 'Done' : run.phase === 'failed' ? 'Failed' : run.phase === 'cancelled' ? 'Stopped' : run.phase === 'interrupted' ? 'Interrupted' : 'Live',
    accent: '#c2f66f'
  }
}

function restoredLiveRun(mission: PublicRecoveredMission): LiveRunState {
  const terminalError = mission.events.filter((event) => event.type === 'run.failed').at(-1)
  const error = mission.hostFailureMessage
    ?? (terminalError?.type === 'run.failed' ? terminalError.payload.message : undefined)
    ?? (mission.phase === 'interrupted' ? 'This run has no terminal receipt and was recovered as interrupted.' : undefined)
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
    eventCount: mission.eventCount,
    eventsTruncated: mission.eventsTruncated,
    integrityIssueCount: mission.integrityIssueCount
  }
}

type RuntimeDiscoveryState =
  | { readonly phase: 'loading' }
  | { readonly phase: 'ready'; readonly runtimes: readonly PublicRuntimeStatus[] }
  | { readonly phase: 'error' }

function WindowBar({ live = false }: { live?: boolean }): ReactNode {
  return (
    <header className="window-bar" onDoubleClick={() => window.desktop?.toggleMaximize()}>
      <div className="window-brand">
        <div className="brand-mark"><Icon name="spark" size={14} /></div>
        <span>Teammate</span>
        <span className="window-separator">/</span>
        <span className="workspace-name">Local workspace</span>
        <span className={`prototype-badge ${live ? 'live' : ''}`}>{live ? 'Local alpha · live runtime' : 'Prototype · sample data'}</span>
      </div>
      <div className="window-center">
        <Icon name="command" size={12} />
        <span>Search or jump to</span>
        <kbd>Ctrl K</kbd>
      </div>
      <div className="window-controls" onDoubleClick={(event) => event.stopPropagation()}>
        <button type="button" aria-label="Minimize" onClick={() => window.desktop?.minimize()}><Icon name="minimize" size={14} /></button>
        <button type="button" aria-label="Maximize" onClick={() => window.desktop?.toggleMaximize()}><Icon name="maximize" size={12} /></button>
        <button type="button" className="window-close" aria-label="Close" onClick={() => window.desktop?.close()}><Icon name="close" size={14} /></button>
      </div>
    </header>
  )
}

function StatusDot({ status }: { status: MissionStatus }): ReactNode {
  if (status === 'running') return <span className="mission-status running" aria-label="Running"><span /></span>
  if (status === 'approval') return <span className="mission-status approval" aria-label="Needs approval"><Icon name="shield" size={10} /></span>
  if (status === 'queued') return <span className="mission-status queued" aria-label="Queued"><Icon name="clock" size={10} /></span>
  if (status === 'stopped') return <span className="mission-status stopped" aria-label="Stopped"><Icon name="close" size={10} /></span>
  return <span className="mission-status complete" aria-label="Complete"><Icon name="check" size={10} /></span>
}

function RuntimeDiscoveryCard({ state }: { state: RuntimeDiscoveryState }): ReactNode {
  if (state.phase === 'loading') {
    return <div className="runtime-discovery-card loading" role="status"><span className="runtime-spinner" /><span><strong>Checking local runtimes</strong><small>Read-only CLI detection</small></span></div>
  }

  if (state.phase === 'error') {
    return <div className="runtime-discovery-card error" role="status"><Icon name="shield" size={14} /><span><strong>Runtime check unavailable</strong><small>No credentials were accessed</small></span></div>
  }

  const readyCount = state.runtimes.filter((runtime) => runtime.ready).length
  const statusLabel = (status: RuntimeProbeStatus): string => {
    if (status === 'ready') return 'Ready'
    if (status === 'auth-required') return 'Sign in'
    if (status === 'not-installed') return 'Not installed'
    if (status === 'offline') return 'Offline'
    return 'Check'
  }

  return (
    <div className="runtime-discovery-card">
      <div className="runtime-discovery-heading"><span>Local runtimes</span><strong>{readyCount}/{state.runtimes.length} ready</strong></div>
      <div className="runtime-discovery-list">
        {state.runtimes.map((runtime) => (
          <div className="runtime-discovery-row" key={runtime.id}>
            <span className={`runtime-mini-glyph ${runtime.id}`}>{runtime.id === 'codex' ? 'O' : runtime.id === 'claude' ? 'A' : '∞'}</span>
            <span className="runtime-discovery-copy"><strong>{runtime.displayName}</strong><small>{runtime.version ? `v${runtime.version}` : runtime.installed ? 'Version unavailable' : 'Optional'}</small></span>
            <span className={`runtime-probe-state ${runtime.status}`}>{statusLabel(runtime.status)}</span>
          </div>
        ))}
      </div>
      <small className="runtime-discovery-note">{state.runtimes.some((runtime) => runtime.id === 'codex' && runtime.ready) ? 'Codex ready · live runs are read-only' : 'Detection only · sign in to enable live runs'}</small>
    </div>
  )
}

function Sidebar({ activeId, onSelect, runtimeState, liveRun }: {
  activeId: number
  onSelect: (id: number) => void
  runtimeState: RuntimeDiscoveryState
  liveRun?: LiveRunState
}): ReactNode {
  const [filter, setFilter] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const indexedMissions = useMemo(
    () => liveRun === undefined ? missions : [missionForLiveRun(liveRun), ...missions.slice(1)],
    [liveRun]
  )
  const visibleMissions = useMemo(
    () => indexedMissions.filter((mission) => `${mission.title} ${mission.teammate}`.toLowerCase().includes(filter.toLowerCase())),
    [filter, indexedMissions]
  )

  useEffect(() => {
    const focusSearch = (event: globalThis.KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        searchRef.current?.focus()
      }
    }

    window.addEventListener('keydown', focusSearch)
    return () => window.removeEventListener('keydown', focusSearch)
  }, [])

  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <button className="new-mission" type="button" disabled title="Mission creation is coming in the live-runtime milestone"><Icon name="plus" size={15} /><span>New mission</span><kbd>Next</kbd></button>
        <label className="mission-search">
          <Icon name="search" size={14} />
          <input ref={searchRef} value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter missions" aria-label="Filter missions" />
        </label>
      </div>

      <div className="sidebar-nav">
        <button type="button" className="nav-item active"><Icon name="inbox" size={15} /><span>Missions</span><span className="nav-count">3</span></button>
        <button type="button" className="nav-item" disabled title="Coming next"><Icon name="users" size={15} /><span>Teammates</span></button>
        <button type="button" className="nav-item" disabled title="Coming next"><Icon name="grid" size={15} /><span>Connections</span></button>
      </div>

      <div className="mission-list-scroll">
        <div className="list-heading"><span>{liveRun === undefined ? 'Example missions' : 'Local missions'}</span><button type="button" aria-label="Mission list menu (not available in prototype)" disabled><Icon name="dots" size={15} /></button></div>
        <div className="mission-list">
          {visibleMissions.map((mission) => (
            <button
              type="button"
              key={mission.id}
              className={`mission-row ${activeId === mission.id ? 'selected' : ''}`}
              onClick={() => onSelect(mission.id)}
              disabled={mission.id !== 1}
              aria-current={activeId === mission.id ? 'page' : undefined}
              title={mission.id === 1 ? undefined : 'Sample mission — detail view is not connected yet'}
            >
              <span className="mission-avatar" style={{ '--avatar-accent': mission.accent } as React.CSSProperties}>{mission.teammateInitials}</span>
              <span className="mission-copy">
                <span className="mission-title-line"><span>{mission.title}</span><time>{mission.time}</time></span>
                <span className="mission-meta"><StatusDot status={mission.status} /><span>{mission.teammate}</span>{mission.unread ? <strong>{mission.unread}</strong> : null}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="sidebar-footer">
        <RuntimeDiscoveryCard state={runtimeState} />
        <button type="button" className="profile-button" disabled title="Workspace settings are coming next"><span className="profile-avatar">LU</span><span>Local user</span><Icon name="settings" size={15} /></button>
      </div>
    </aside>
  )
}

function RoutePill({ route, onClick, disabled = false }: { route: RouteOption; onClick?: () => void; disabled?: boolean }): ReactNode {
  return (
    <button type="button" className="route-pill" onClick={onClick} disabled={disabled}>
      <span className={`runtime-glyph ${route.tone}`}>{route.runtime === 'Codex' ? 'O' : route.runtime === 'Claude Code' ? 'A' : route.runtime === 'OmniRoute' ? '∞' : 'L'}</span>
      <span>{route.runtime}</span>
      <span className="route-slash">/</span>
      <strong>{route.model}</strong>
      <Icon name="chevron-down" size={12} />
    </button>
  )
}

function MissionHeader({ mission, route, onRouteClick, liveRun, onCancel }: {
  mission: Mission
  route: RouteOption
  onRouteClick: () => void
  liveRun?: LiveRunState
  onCancel: () => void
}): ReactNode {
  const active = liveRunIsActive(liveRun)
  const stateLabel = liveRun === undefined
    ? 'Preview'
    : liveRun.phase === 'completed'
      ? 'Complete'
      : liveRun.phase === 'failed'
        ? 'Failed'
        : liveRun.phase === 'cancelled'
          ? 'Stopped'
          : liveRun.phase === 'interrupted'
            ? 'Interrupted'
          : liveRun.phase === 'cancelling'
            ? 'Stopping'
            : 'Live'
  return (
    <header className="mission-header">
      <div className="breadcrumb"><span>Missions</span><Icon name="chevron-right" size={12} /><span>{mission.title}</span></div>
      <div className="mission-heading-row">
        <div>
          <div className="title-with-state"><h1>{liveRun === undefined ? mission.title : 'Local Codex mission'}</h1><span className={`live-label ${liveRun === undefined ? '' : liveRun.phase}`}><span /> {stateLabel}</span></div>
          <p>{liveRun === undefined
            ? 'Example run: Maya is researching, drafting, and preparing the next safe action.'
            : liveRun.restored
              ? 'A durable local Codex receipt recovered from the append-only mission ledger.'
              : 'A real Codex CLI run in the host-selected workspace with the read-only sandbox enforced.'}</p>
        </div>
        <div className="mission-actions">
          <RoutePill route={route} onClick={onRouteClick} disabled={active} />
          <button type="button" className="icon-button" aria-label="Stop live mission" title={active ? 'Stop this Codex process safely' : 'No active mission'} disabled={!active || liveRun?.data === undefined} onClick={onCancel}><Icon name="pause" size={15} /></button>
          <button type="button" className="icon-button" aria-label="More mission options (not available in prototype)" disabled><Icon name="dots" size={16} /></button>
        </div>
      </div>
      <nav className="mission-tabs" aria-label="Mission sections" role="tablist">
        <button type="button" className="active" role="tab" aria-selected="true"><Icon name="activity" size={14} />Activity <span>{liveRun?.eventCount ?? liveRun?.events.length ?? 8}</span></button>
        <button type="button" role="tab" aria-selected="false" disabled title="Artifact view is coming next"><Icon name="file" size={14} />Artifacts <span>4</span></button>
        <button type="button" role="tab" aria-selected="false" disabled title="Context view is coming next"><Icon name="message" size={14} />Context</button>
      </nav>
    </header>
  )
}

function TimelineItem({
  state,
  icon,
  title,
  time,
  children,
  last = false
}: {
  state: 'done' | 'active' | 'waiting'
  icon: IconName
  title: string
  time: string
  children?: ReactNode
  last?: boolean
}): ReactNode {
  return (
    <article className={`timeline-item ${state}`}>
      <div className="timeline-rail">
        <span className="timeline-node"><Icon name={state === 'done' ? 'check' : icon} size={12} /></span>
        {!last && <span className="timeline-line" />}
      </div>
      <div className="timeline-body">
        <div className="timeline-title"><h3>{title}</h3><time>{time}</time></div>
        {children}
      </div>
    </article>
  )
}

function SignalRail({ approvalStatus }: { approvalStatus: 'pending' | 'approved' | 'changes' }): ReactNode {
  return (
    <section className="signal-rail">
      <div className="section-kicker"><span>Signal rail · example run</span><span className="running-elapsed"><span /> Preview · 04:18</span></div>

      <TimelineItem state="done" icon="spark" title="Understood the mission" time="9:42:03 AM">
        <p>Build a focused renewal campaign for accounts expiring in the next 45 days, prioritizing healthy customers with expansion potential.</p>
        <button type="button" className="inline-link" disabled>View sample plan <Icon name="chevron-right" size={12} /></button>
      </TimelineItem>

      <TimelineItem state="done" icon="search" title="Scanned customer records" time="9:42:31 AM">
        <div className="tool-call">
          <span className="tool-icon">H</span>
          <div><strong>HubSpot sample</strong><span>example companies + active subscriptions</span></div>
          <span className="tool-result"><Icon name="check" size={11} /> 128 sample records</span>
        </div>
        <div className="result-summary"><span>32</span> renewal candidates found <i /> <span>11</span> meet the health threshold</div>
      </TimelineItem>

      <TimelineItem state="done" icon="code" title="Built the priority segment" time="9:43:12 AM">
        <div className="logic-block">
          <div><span className="code-key">renewal_window</span><span className="code-op">≤</span><span className="code-value">45 days</span></div>
          <div><span className="code-key">health_score</span><span className="code-op">≥</span><span className="code-value">78</span></div>
          <div><span className="code-key">open_risk</span><span className="code-op">=</span><span className="code-value">false</span></div>
        </div>
      </TimelineItem>

      <TimelineItem state={approvalStatus === 'pending' ? 'active' : 'done'} icon="spark" title={approvalStatus === 'pending' ? 'Preparing personalized outreach' : 'Outreach package approved'} time="9:44:08 AM">
        <p>{approvalStatus === 'pending' ? 'The prototype drafted 11 sample sequences from demonstration CRM context.' : 'The simulated decision was recorded locally. No external action was executed.'}</p>
        <div className="artifact-stack">
          <button type="button" disabled><span className="file-type">TXT</span><span><strong>Sample renewal sequence</strong><small>11 demonstration variants</small></span><Icon name="chevron-right" size={14} /></button>
          <button type="button" disabled><span className="file-type table">CSV</span><span><strong>Sample target accounts</strong><small>Fictional contacts and health data</small></span><Icon name="chevron-right" size={14} /></button>
        </div>
      </TimelineItem>

      <TimelineItem state="waiting" icon="clock" title="Schedule campaign" time="Waiting" last>
        <p>{approvalStatus === 'pending' ? 'This example external write is paused at its approval checkpoint.' : 'No external action is connected in this prototype.'}</p>
      </TimelineItem>
    </section>
  )
}

function eventTime(event: CodexRuntimeEvent | undefined): string {
  if (event === undefined) return 'Waiting'
  return new Date(event.occurredAt).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit'
  })
}

function LiveSignalRail({ run }: { run: LiveRunState }): ReactNode {
  const started = run.events.find((event) => event.type === 'run.started')
  const turnStarted = run.events.find((event) => event.type === 'step.started' && event.payload.stepKind === 'turn')
  const terminal = run.events.filter((event) => event.type === 'run.completed' || event.type === 'run.failed' || event.type === 'run.cancelled').at(-1)
  const limit = run.events.filter((event) => event.type === 'route.limit_detected').at(-1)
  const toolEvents = run.events.filter((event): event is Extract<CodexRuntimeEvent, {
    readonly type: 'tool.started' | 'tool.completed' | 'tool.failed'
  }> => event.type === 'tool.started' || event.type === 'tool.completed' || event.type === 'tool.failed')
  let responseText = ''
  let responseTime: CodexRuntimeEvent | undefined
  for (const event of run.events) {
    if (event.type !== 'message.delta') continue
    responseText = event.payload.operation === 'replace'
      ? event.payload.text
      : responseText + event.payload.text
    responseTime = event
  }
  const statusLabel = run.phase === 'starting'
    ? 'Verifying runtime'
    : run.phase === 'running'
      ? 'Running'
      : run.phase === 'cancelling'
        ? 'Stopping safely'
        : run.phase === 'completed'
          ? 'Completed'
          : run.phase === 'cancelled'
            ? 'Stopped'
            : run.phase === 'interrupted'
              ? 'Interrupted'
              : 'Needs attention'

  return (
    <section className="signal-rail live-signal-rail">
      <div className="section-kicker"><span>Signal rail · {run.restored ? 'restored local receipt' : 'live Codex run'}</span><span className={`running-elapsed ${run.phase}`}><span /> {statusLabel}</span></div>
      {run.restored && (
        <div className={`live-recovery ${(run.integrityIssueCount ?? 0) > 0 ? 'warning' : ''}`} role="status">
          <Icon name={(run.integrityIssueCount ?? 0) > 0 ? 'shield' : 'check'} size={14} />
          <span>
            <strong>Durable local receipt</strong>
            {run.eventsTruncated
              ? `Showing the first and latest ${run.events.length.toLocaleString()} of ${(run.eventCount ?? run.events.length).toLocaleString()} events.`
              : `Recovered ${(run.eventCount ?? run.events.length).toLocaleString()} normalized events after restart.`}
            {(run.integrityIssueCount ?? 0) > 0 && ` ${run.integrityIssueCount} ledger integrity issue${run.integrityIssueCount === 1 ? '' : 's'} were isolated.`}
          </span>
        </div>
      )}

      <TimelineItem state={started === undefined ? 'active' : 'done'} icon="terminal" title={started === undefined ? 'Starting Codex safely' : 'Connected to Codex'} time={eventTime(started)}>
        <p>{started === undefined ? 'Verifying the installed CLI and opening a bounded JSONL transport.' : `Codex CLI ${run.data?.cliVersion ?? 'version unavailable'} · account default · read-only sandbox`}</p>
        <div className="live-guard-row"><Icon name="shield" size={13} /><span>No shell command string, no prompt in argv, and no permission-bypass flags.</span></div>
      </TimelineItem>

      <TimelineItem state={terminal === undefined ? (turnStarted === undefined ? 'waiting' : 'active') : 'done'} icon="spark" title="Working through the mission" time={eventTime(turnStarted)}>
        <p className="live-prompt">{run.prompt}</p>
        {toolEvents.length > 0 && (
          <div className="live-tool-list">
            {toolEvents.slice(-5).map((event) => (
              <div className={`tool-call live ${event.type}`} key={event.id}>
                <span className="tool-icon"><Icon name={event.payload.toolKind === 'command_execution' ? 'terminal' : 'code'} size={13} /></span>
                <div><strong>{event.payload.name}</strong><span>{event.payload.command ?? event.payload.toolKind}</span></div>
                <span className="tool-result">{event.type === 'tool.failed' ? 'Failed' : event.type === 'tool.completed' ? 'Done' : 'Running'}</span>
              </div>
            ))}
          </div>
        )}
        {limit !== undefined && <div className="live-limit"><Icon name="route" size={14} /><span><strong>Provider limit detected</strong>{limit.payload.message}</span></div>}
      </TimelineItem>

      <TimelineItem state={responseText ? (terminal?.type === 'run.completed' ? 'done' : 'active') : 'waiting'} icon="message" title="Codex response" time={eventTime(responseTime)}>
        {responseText
          ? <div className="live-response">{responseText}</div>
          : <p>{terminal === undefined ? 'The response will stream here as normalized events arrive.' : 'This run ended without an assistant message.'}</p>}
      </TimelineItem>

      <TimelineItem state={terminal === undefined ? 'waiting' : terminal.type === 'run.completed' ? 'done' : 'active'} icon={terminal?.type === 'run.completed' ? 'check' : terminal?.type === 'run.cancelled' ? 'pause' : 'shield'} title={terminal === undefined ? 'Finalize run receipt' : terminal.type === 'run.completed' ? 'Mission completed' : terminal.type === 'run.cancelled' ? 'Mission stopped' : 'Codex invocation ended'} time={eventTime(terminal)} last>
        {terminal?.type === 'run.completed' && <p>The provider terminal event and clean host-process exit agreed. This receipt was durably written before it appeared here.</p>}
        {terminal?.type === 'run.cancelled' && <p>The host requested cancellation and waited for process termination confirmation.</p>}
        {terminal?.type === 'run.failed' && <div className="live-error"><strong>{terminal.payload.kind}</strong><span>{terminal.payload.message}</span></div>}
        {terminal === undefined && run.error !== undefined && <div className="live-error"><strong>Runtime error</strong><span>{run.error}</span></div>}
        {terminal === undefined && run.error === undefined && <p>Waiting for both the Codex terminal record and the host process receipt.</p>}
      </TimelineItem>
    </section>
  )
}

function ApprovalCard({ status, onChange }: { status: 'pending' | 'approved' | 'changes'; onChange: (status: 'pending' | 'approved' | 'changes') => void }): ReactNode {
  if (status !== 'pending') {
    return (
      <section className={`approval-card resolved ${status}`}>
        <div className="approval-icon"><Icon name={status === 'approved' ? 'check' : 'message'} size={17} /></div>
        <div><span className="eyebrow">Simulated decision</span><h3>{status === 'approved' ? 'Approval preview complete' : 'Change request previewed'}</h3><p>No HubSpot action was executed.</p></div>
        <button type="button" className="text-button" onClick={() => onChange('pending')}>Undo</button>
      </section>
    )
  }

  return (
    <section className="approval-card">
      <div className="approval-card-top">
        <span className="approval-shield"><Icon name="shield" size={16} /></span>
        <span>Approval preview</span>
        <span className="risk-badge">Prototype only</span>
      </div>
      <h3>Would you schedule 11 renewal emails?</h3>
      <p>Simulated approval using sample data. No HubSpot account is connected and nothing can be sent.</p>
      <div className="approval-receipt">
        <div><span>Recipients</span><strong>11 contacts</strong></div>
        <div><span>Starts</span><strong>Tomorrow, 9:15 AM</strong></div>
        <div><span>Cadence</span><strong>3 emails · 14 days</strong></div>
      </div>
      <button type="button" className="review-link" disabled>Exact-change review coming next <Icon name="chevron-right" size={13} /></button>
      <div className="approval-actions">
        <button type="button" className="secondary-action" onClick={() => onChange('changes')}>Simulate changes</button>
        <button type="button" className="primary-action" onClick={() => onChange('approved')}><Icon name="check" size={14} /> Simulate approval</button>
      </div>
    </section>
  )
}

function LiveSafetyCard({ run }: { run: LiveRunState }): ReactNode {
  const limit = run.events.some((event) => event.type === 'route.limit_detected')
  const restored = run.restored === true
  return (
    <section className={`approval-card live-safety-card ${limit ? 'limit' : ''}`}>
      <div className="approval-card-top">
        <span className="approval-shield"><Icon name={limit ? 'route' : 'shield'} size={16} /></span>
        <span>{limit ? 'Route handoff required' : restored ? 'Mission history' : 'Live guardrails'}</span>
        <span className="risk-badge">{restored ? 'Local receipt' : 'Read only'}</span>
      </div>
      <h3>{limit ? 'Codex reached a provider limit' : restored ? 'Recovered from the local ledger' : 'External writes are disabled'}</h3>
      <p>{limit
        ? 'This invocation will close cleanly. Automatic fallback waits for the durable-checkpoint milestone.'
        : restored
          ? 'The append-only receipt survived restart. Incomplete runs are marked interrupted instead of being presented as successful.'
          : 'The host fixed the workspace, executable, argv, and sandbox. The renderer supplied only the prompt.'}</p>
      <div className="approval-receipt">
        <div><span>Runtime</span><strong>Codex CLI</strong></div>
        <div><span>{restored ? 'Events' : 'Model'}</span><strong>{restored ? (run.eventCount ?? run.events.length).toLocaleString() : 'Account default'}</strong></div>
        <div><span>{restored ? 'State' : 'Sandbox'}</span><strong>{restored ? run.phase : 'Read only'}</strong></div>
      </div>
    </section>
  )
}

function RoutePanel({ selected, onSelect, locked = false, live = false }: { selected: number; onSelect: (index: number) => void; locked?: boolean; live?: boolean }): ReactNode {
  const [automatic, setAutomatic] = useState(true)

  return (
    <section className="route-panel">
      <div className="panel-title"><span><Icon name="route" size={15} /> Model route preview</span><button type="button" aria-label="Routing settings (not available in prototype)" disabled><Icon name="settings" size={14} /></button></div>
      <div className="route-policy">
        <div><strong>{live ? 'Automatic fallback preview' : 'Automatic fallback'}</strong><span>{live ? 'Connects after durable checkpoints are added' : 'Preview the policy used at a provider limit'}</span></div>
        <button type="button" className={`switch ${automatic ? 'on' : ''}`} onClick={() => setAutomatic((value) => !value)} role="switch" aria-label="Automatic fallback preview" aria-checked={automatic} disabled={locked || live}><span /></button>
      </div>
      <div className="fallback-label"><span>Example fallback chain</span><span>Quality floor · Capable</span></div>
      <div className="fallback-chain" role="radiogroup" aria-label="Example fallback route">
        {routes.map((route, index) => (
          <button type="button" role="radio" aria-checked={selected === index} className={`fallback-row ${selected === index ? 'current' : ''}`} key={`${route.runtime}-${route.model}`} onClick={() => onSelect(index)} disabled={locked || live}>
            <span className="drag-handle" aria-hidden="true">{index + 1}</span>
            <span className={`runtime-glyph ${route.tone}`}>{route.runtime === 'Codex' ? 'O' : route.runtime === 'Claude Code' ? 'A' : route.runtime === 'OmniRoute' ? '∞' : 'L'}</span>
            <span className="fallback-copy"><strong>{route.model}</strong><small>{route.runtime} · {route.source}</small></span>
            <span className={`route-badge ${route.tone}`}>{selected === index ? 'ACTIVE' : route.badge}</span>
          </button>
        ))}
      </div>
      <div className="quota-card">
        <div className="quota-heading"><span>{live ? 'Provider allowance' : 'Mission token budget'}</span><strong>{live ? 'Runtime-owned' : '63% left'}</strong></div>
        {!live && <div className="quota-bar"><span /></div>}
        <p>{live ? 'Codex does not expose an exact remaining allowance in this stream.' : 'Local policy · provider allowance is checked at runtime'}</p>
      </div>
      <div className="route-guard"><Icon name="shield" size={14} /><span>{live ? 'Planned guard: route switches require a durable checkpoint.' : 'Model switches pause external tools and create a checkpoint.'}</span></div>
    </section>
  )
}

function DetailsRail({ approvalStatus, onApprovalChange, selectedRoute, onRouteSelect, liveRun }: {
  approvalStatus: 'pending' | 'approved' | 'changes'
  onApprovalChange: (status: 'pending' | 'approved' | 'changes') => void
  selectedRoute: number
  onRouteSelect: (index: number) => void
  liveRun?: LiveRunState
}): ReactNode {
  return (
    <aside className="details-rail">
      {liveRun === undefined ? <ApprovalCard status={approvalStatus} onChange={onApprovalChange} /> : <LiveSafetyCard run={liveRun} />}
      <RoutePanel selected={selectedRoute} onSelect={onRouteSelect} locked={liveRunIsActive(liveRun)} live={liveRun !== undefined} />
      <section className="context-panel">
        <div className="panel-title"><span><Icon name="file" size={15} /> {liveRun === undefined ? 'Sample context' : 'Run context'}</span><button type="button" aria-label="Add context (not available in prototype)" disabled><Icon name="plus" size={14} /></button></div>
        {liveRun === undefined
          ? <><div className="context-row"><span className="context-icon hubspot">H</span><span><strong>HubSpot sample</strong><small>Fictional customer accounts</small></span><span className="live-dot" /></div><div className="context-row"><span className="context-icon notion">N</span><span><strong>Sample renewal playbook</strong><small>Prototype · read only</small></span><Icon name="chevron-right" size={13} /></div></>
          : <><div className="context-row"><span className="context-icon codex">O</span><span><strong>Host-selected workspace</strong><small>Local files · read only</small></span><span className="live-dot" /></div><div className="context-row"><span className="context-icon notion">i</span><span><strong>Mission prompt</strong><small>Sent through stdin, never argv</small></span><Icon name="shield" size={13} /></div></>}
      </section>
    </aside>
  )
}

function CommandDock({ route, onRouteClick, runtimeState, liveRun, onStart, onCancel }: {
  route: RouteOption
  onRouteClick: () => void
  runtimeState: RuntimeDiscoveryState
  liveRun?: LiveRunState
  onStart: (prompt: string) => Promise<boolean>
  onCancel: () => void
}): ReactNode {
  const [value, setValue] = useState('')
  const active = liveRunIsActive(liveRun)
  const codexReady = runtimeState.phase === 'ready'
    && runtimeState.runtimes.some((runtime) => runtime.id === 'codex' && runtime.ready)
  const routeSupported = route.runtime === 'Codex'
  const canStart = codexReady && routeSupported && !active && value.trim().length > 0
  const placeholder = active
    ? 'Codex is working — stop the run before starting another…'
    : !routeSupported
      ? 'Live execution currently supports the Codex route…'
      : codexReady
        ? 'Give Codex a read-only mission in this workspace…'
        : runtimeState.phase === 'loading'
          ? 'Checking the local Codex runtime…'
          : 'Sign in to Codex CLI to run a live mission…'

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const prompt = value.trim()
    if (!canStart || !prompt) return
    void onStart(prompt).then((started) => {
      if (started) setValue('')
    })
  }

  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      event.currentTarget.form?.requestSubmit()
    }
  }

  return (
    <div className="dock-wrap">
      {liveRun?.error && <div className="command-notice error" role="status" aria-live="polite"><Icon name="shield" size={13} />{liveRun.error}</div>}
      <form className="command-dock" onSubmit={submit}>
        <textarea value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={keyDown} placeholder={placeholder} aria-label="Read-only Codex mission instruction" rows={1} maxLength={8000} disabled={active} />
        <div className="dock-toolbar">
          <div className="dock-tools">
            <button type="button" className="dock-icon" aria-label="Attach context (not available in prototype)" title="Attach context is coming next" disabled><Icon name="attachment" size={15} /></button>
            <button type="button" className="teammate-chip" disabled title="Specialized teammate profiles are coming next"><span className="tiny-avatar">CX</span>Codex<Icon name="chevron-down" size={11} /></button>
            <RoutePill route={route} onClick={onRouteClick} disabled={active} />
            <span className="permission-chip"><Icon name="shield" size={12} /> Read-only sandbox</span>
          </div>
          <div className="send-wrap">
            <span>{active ? 'One local process active' : <><kbd>Enter</kbd> to run</>}</span>
            {active
              ? <button type="button" className="send-button stop" disabled={liveRun?.data === undefined || liveRun.phase === 'cancelling'} onClick={onCancel} aria-label="Stop Codex mission"><Icon name="close" size={15} /></button>
              : <button type="submit" className="send-button" disabled={!canStart} aria-label="Run read-only Codex mission"><Icon name="arrow-up" size={15} /></button>}
          </div>
        </div>
      </form>
    </div>
  )
}

function RouteMenu({ selected, onSelect, onClose }: { selected: number; onSelect: (index: number) => void; onClose: () => void }): ReactNode {
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const selectedRoute = dialogRef.current?.querySelector<HTMLButtonElement>('[role="radio"][aria-checked="true"]')
    const firstButton = dialogRef.current?.querySelector<HTMLButtonElement>('button')
    if (selectedRoute) selectedRoute.focus()
    else firstButton?.focus()
  }, [])

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }

    if (event.key !== 'Tab') return
    const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
    if (controls.length === 0) return
    const first = controls[0]
    const last = controls.at(-1) ?? first

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div className="route-menu-backdrop" onMouseDown={onClose}>
      <div
        className="route-menu"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="route-menu-title"
        onKeyDown={handleKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="route-menu-header"><span id="route-menu-title">Run this example mission with</span><button type="button" onClick={onClose} aria-label="Close model route picker"><Icon name="close" size={14} /></button></div>
        <div className="route-menu-list" role="radiogroup" aria-label="Example runtime and model route">
          {routes.map((route, index) => (
            <button type="button" role="radio" aria-checked={selected === index} key={route.model} className={selected === index ? 'selected' : ''} onClick={() => { onSelect(index); onClose() }}>
              <span className={`runtime-glyph ${route.tone}`}>{route.runtime === 'Codex' ? 'O' : route.runtime === 'Claude Code' ? 'A' : route.runtime === 'OmniRoute' ? '∞' : 'L'}</span>
              <span><strong>{route.model}</strong><small>{route.runtime} · {route.source}</small></span>
              <span className={`route-badge ${route.tone}`}>{route.badge}</span>
              {selected === index && <Icon name="check" size={14} />}
            </button>
          ))}
        </div>
        <div className="route-menu-footer"><Icon name="settings" size={13} />Manage models and fallback policy</div>
      </div>
    </div>
  )
}

export default function App(): ReactNode {
  const [activeMissionId, setActiveMissionId] = useState(1)
  const [approvalStatus, setApprovalStatus] = useState<'pending' | 'approved' | 'changes'>('pending')
  const [selectedRoute, setSelectedRoute] = useState(0)
  const [routeMenuOpen, setRouteMenuOpen] = useState(false)
  const [runtimeState, setRuntimeState] = useState<RuntimeDiscoveryState>({ phase: 'loading' })
  const [liveRun, setLiveRun] = useState<LiveRunState>()
  const routeTriggerRef = useRef<HTMLElement | null>(null)
  const pendingUpdatesRef = useRef(new Map<string, CodexMissionUpdate[]>())
  const activeRunIdRef = useRef<string | undefined>(undefined)
  const activeMission = liveRun !== undefined && activeMissionId === 1
    ? missionForLiveRun(liveRun)
    : missions.find((mission) => mission.id === activeMissionId) ?? missions[0]

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

    void bridge.getLocalRuntimes()
      .then((response) => {
        if (!active) return
        setRuntimeState(response.ok
          ? { phase: 'ready', runtimes: response.data.runtimes }
          : { phase: 'error' })
      })
      .catch(() => {
        if (active) setRuntimeState({ phase: 'error' })
      })

    void bridge.getMissionHistory()
      .then((response) => {
        if (!active || !response.ok) return
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
        // History recovery is optional at startup; live runtime discovery remains usable.
      })

    return () => {
      active = false
      removeMissionListener()
    }
  }, [])

  const startMission = async (prompt: string): Promise<boolean> => {
    const bridge = window.desktop
    setActiveMissionId(1)
    setSelectedRoute(0)
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
          phase: current?.phase === 'completed' || current?.phase === 'failed' || current?.phase === 'cancelled'
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
      setLiveRun({ prompt, phase: 'failed', events: [], error: 'The Codex mission could not be started.' })
      return false
    }
  }

  const cancelMission = (): void => {
    const bridge = window.desktop
    const runId = liveRun?.data?.runId
    if (!bridge || runId === undefined || !liveRunIsActive(liveRun)) return
    setLiveRun((current) => current?.data?.runId === runId
      ? { ...current, phase: 'cancelling', error: undefined }
      : current)
    void bridge.cancelCodexMission({ runId })
      .then((response) => {
        if (response.ok) return
        setLiveRun((current) => current?.data?.runId === runId && liveRunIsActive(current)
          ? { ...current, phase: 'running', error: response.error.message }
          : current)
      })
      .catch(() => {
        setLiveRun((current) => current?.data?.runId === runId && liveRunIsActive(current)
          ? { ...current, phase: 'running', error: 'The cancellation request could not be delivered.' }
          : current)
      })
  }

  const openRouteMenu = (): void => {
    if (liveRunIsActive(liveRun)) return
    routeTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setRouteMenuOpen(true)
  }

  const closeRouteMenu = (): void => {
    setRouteMenuOpen(false)
    window.requestAnimationFrame(() => routeTriggerRef.current?.focus())
  }

  return (
    <div className="app-shell">
      <WindowBar live={liveRun !== undefined} />
      <div className="app-grid">
        <Sidebar activeId={activeMissionId} onSelect={setActiveMissionId} runtimeState={runtimeState} liveRun={liveRun} />
        <main className="mission-workspace">
          <MissionHeader mission={activeMission} route={routes[selectedRoute]} onRouteClick={openRouteMenu} liveRun={liveRun} onCancel={cancelMission} />
          <div className="mission-scroll">{liveRun === undefined ? <SignalRail approvalStatus={approvalStatus} /> : <LiveSignalRail run={liveRun} />}</div>
          <CommandDock route={routes[selectedRoute]} onRouteClick={openRouteMenu} runtimeState={runtimeState} liveRun={liveRun} onStart={startMission} onCancel={cancelMission} />
        </main>
        <DetailsRail
          approvalStatus={approvalStatus}
          onApprovalChange={setApprovalStatus}
          selectedRoute={selectedRoute}
          onRouteSelect={setSelectedRoute}
          liveRun={liveRun}
        />
      </div>
      {routeMenuOpen && <RouteMenu selected={selectedRoute} onSelect={setSelectedRoute} onClose={closeRouteMenu} />}
    </div>
  )
}
