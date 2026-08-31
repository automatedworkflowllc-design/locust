import { FormEvent, KeyboardEvent, ReactNode, useEffect, useMemo, useRef, useState } from 'react'

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

type MissionStatus = 'running' | 'approval' | 'queued' | 'complete'

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
  { runtime: 'Codex', model: 'GPT-5.6 Sol', source: 'Codex account', badge: 'PRIMARY', tone: 'lime' },
  { runtime: 'Claude Code', model: 'Claude Sonnet 5', source: 'Claude account', badge: 'STANDBY', tone: 'blue' },
  { runtime: 'OmniRoute', model: 'Qwen3 Coder', source: 'Free provider', badge: 'FREE', tone: 'violet' },
  { runtime: 'Ollama', model: 'Devstral Small', source: 'This computer', badge: 'LOCAL', tone: 'neutral' }
]

function WindowBar(): ReactNode {
  return (
    <header className="window-bar" onDoubleClick={() => window.desktop?.toggleMaximize()}>
      <div className="window-brand">
        <div className="brand-mark"><Icon name="spark" size={14} /></div>
        <span>Teammate</span>
        <span className="window-separator">/</span>
        <span className="workspace-name">Colin&apos;s workspace</span>
        <span className="prototype-badge">Prototype · sample data</span>
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
  return <span className="mission-status complete" aria-label="Complete"><Icon name="check" size={10} /></span>
}

function Sidebar({ activeId, onSelect }: { activeId: number; onSelect: (id: number) => void }): ReactNode {
  const [filter, setFilter] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const visibleMissions = useMemo(
    () => missions.filter((mission) => `${mission.title} ${mission.teammate}`.toLowerCase().includes(filter.toLowerCase())),
    [filter]
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
        <div className="list-heading"><span>Example missions</span><button type="button" aria-label="Mission list menu (not available in prototype)" disabled><Icon name="dots" size={15} /></button></div>
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
        <div className="provider-health"><span className="health-orb" /><span><strong>4 example routes</strong><small>No live runtime connected</small></span><Icon name="chevron-right" size={14} /></div>
        <button type="button" className="profile-button" disabled title="Workspace settings are coming next"><span className="profile-avatar">CB</span><span>Colin</span><Icon name="settings" size={15} /></button>
      </div>
    </aside>
  )
}

function RoutePill({ route, onClick }: { route: RouteOption; onClick?: () => void }): ReactNode {
  return (
    <button type="button" className="route-pill" onClick={onClick}>
      <span className={`runtime-glyph ${route.tone}`}>{route.runtime === 'Codex' ? 'O' : route.runtime === 'Claude Code' ? 'A' : route.runtime === 'OmniRoute' ? '∞' : 'L'}</span>
      <span>{route.runtime}</span>
      <span className="route-slash">/</span>
      <strong>{route.model}</strong>
      <Icon name="chevron-down" size={12} />
    </button>
  )
}

function MissionHeader({ mission, route, onRouteClick }: { mission: Mission; route: RouteOption; onRouteClick: () => void }): ReactNode {
  return (
    <header className="mission-header">
      <div className="breadcrumb"><span>Missions</span><Icon name="chevron-right" size={12} /><span>{mission.title}</span></div>
      <div className="mission-heading-row">
        <div>
          <div className="title-with-state"><h1>{mission.title}</h1><span className="live-label"><span /> Running</span></div>
          <p>Example run: Maya is researching, drafting, and preparing the next safe action.</p>
        </div>
        <div className="mission-actions">
          <RoutePill route={route} onClick={onRouteClick} />
          <button type="button" className="icon-button" aria-label="Pause mission (not available in prototype)" title="Pause is coming with the live runtime" disabled><Icon name="pause" size={15} /></button>
          <button type="button" className="icon-button" aria-label="More mission options (not available in prototype)" disabled><Icon name="dots" size={16} /></button>
        </div>
      </div>
      <nav className="mission-tabs" aria-label="Mission sections" role="tablist">
        <button type="button" className="active" role="tab" aria-selected="true"><Icon name="activity" size={14} />Activity <span>8</span></button>
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

function RoutePanel({ selected, onSelect }: { selected: number; onSelect: (index: number) => void }): ReactNode {
  const [automatic, setAutomatic] = useState(true)

  return (
    <section className="route-panel">
      <div className="panel-title"><span><Icon name="route" size={15} /> Model route preview</span><button type="button" aria-label="Routing settings (not available in prototype)" disabled><Icon name="settings" size={14} /></button></div>
      <div className="route-policy">
        <div><strong>Automatic fallback</strong><span>Preview the policy used at a provider limit</span></div>
        <button type="button" className={`switch ${automatic ? 'on' : ''}`} onClick={() => setAutomatic((value) => !value)} role="switch" aria-label="Automatic fallback preview" aria-checked={automatic}><span /></button>
      </div>
      <div className="fallback-label"><span>Example fallback chain</span><span>Quality floor · Capable</span></div>
      <div className="fallback-chain" role="radiogroup" aria-label="Example fallback route">
        {routes.map((route, index) => (
          <button type="button" role="radio" aria-checked={selected === index} className={`fallback-row ${selected === index ? 'current' : ''}`} key={`${route.runtime}-${route.model}`} onClick={() => onSelect(index)}>
            <span className="drag-handle" aria-hidden="true">{index + 1}</span>
            <span className={`runtime-glyph ${route.tone}`}>{route.runtime === 'Codex' ? 'O' : route.runtime === 'Claude Code' ? 'A' : route.runtime === 'OmniRoute' ? '∞' : 'L'}</span>
            <span className="fallback-copy"><strong>{route.model}</strong><small>{route.runtime} · {route.source}</small></span>
            <span className={`route-badge ${route.tone}`}>{selected === index ? 'ACTIVE' : route.badge}</span>
          </button>
        ))}
      </div>
      <div className="quota-card">
        <div className="quota-heading"><span>Mission token budget</span><strong>63% left</strong></div>
        <div className="quota-bar"><span /></div>
        <p>Local policy · provider allowance is checked at runtime</p>
      </div>
      <div className="route-guard"><Icon name="shield" size={14} /><span>Model switches pause external tools and create a checkpoint.</span></div>
    </section>
  )
}

function DetailsRail({ approvalStatus, onApprovalChange, selectedRoute, onRouteSelect }: {
  approvalStatus: 'pending' | 'approved' | 'changes'
  onApprovalChange: (status: 'pending' | 'approved' | 'changes') => void
  selectedRoute: number
  onRouteSelect: (index: number) => void
}): ReactNode {
  return (
    <aside className="details-rail">
      <ApprovalCard status={approvalStatus} onChange={onApprovalChange} />
      <RoutePanel selected={selectedRoute} onSelect={onRouteSelect} />
      <section className="context-panel">
        <div className="panel-title"><span><Icon name="file" size={15} /> Sample context</span><button type="button" aria-label="Add context (not available in prototype)" disabled><Icon name="plus" size={14} /></button></div>
        <div className="context-row"><span className="context-icon hubspot">H</span><span><strong>HubSpot sample</strong><small>Fictional customer accounts</small></span><span className="live-dot" /></div>
        <div className="context-row"><span className="context-icon notion">N</span><span><strong>Sample renewal playbook</strong><small>Prototype · read only</small></span><Icon name="chevron-right" size={13} /></div>
      </section>
    </aside>
  )
}

function CommandDock({ route, onRouteClick }: { route: RouteOption; onRouteClick: () => void }): ReactNode {
  const [value, setValue] = useState('')
  const [notice, setNotice] = useState('')

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const command = value.trim()
    if (!command) return
    setNotice(`Prototype only — captured locally: “${command}”`)
    setValue('')
    window.setTimeout(() => setNotice(''), 3200)
  }

  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      event.currentTarget.form?.requestSubmit()
    }
  }

  return (
    <div className="dock-wrap">
      {notice && <div className="command-notice" role="status" aria-live="polite"><Icon name="check" size={13} />{notice}</div>}
      <form className="command-dock" onSubmit={submit}>
        <textarea value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={keyDown} placeholder="Try a prototype instruction for Maya…" aria-label="Prototype mission instruction" rows={1} />
        <div className="dock-toolbar">
          <div className="dock-tools">
            <button type="button" className="dock-icon" aria-label="Attach context (not available in prototype)" title="Attach context is coming next" disabled><Icon name="attachment" size={15} /></button>
            <button type="button" className="teammate-chip" disabled title="Teammate selection is coming next"><span className="tiny-avatar">MY</span>Maya<Icon name="chevron-down" size={11} /></button>
            <RoutePill route={route} onClick={onRouteClick} />
            <span className="permission-chip"><Icon name="shield" size={12} /> Ask before acting</span>
          </div>
          <div className="send-wrap"><span><kbd>Enter</kbd> to send</span><button type="submit" className="send-button" disabled={!value.trim()} aria-label="Send instruction"><Icon name="arrow-up" size={15} /></button></div>
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
  const routeTriggerRef = useRef<HTMLElement | null>(null)
  const activeMission = missions.find((mission) => mission.id === activeMissionId) ?? missions[0]

  const openRouteMenu = (): void => {
    routeTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setRouteMenuOpen(true)
  }

  const closeRouteMenu = (): void => {
    setRouteMenuOpen(false)
    window.requestAnimationFrame(() => routeTriggerRef.current?.focus())
  }

  return (
    <div className="app-shell">
      <WindowBar />
      <div className="app-grid">
        <Sidebar activeId={activeMissionId} onSelect={setActiveMissionId} />
        <main className="mission-workspace">
          <MissionHeader mission={activeMission} route={routes[selectedRoute]} onRouteClick={openRouteMenu} />
          <div className="mission-scroll"><SignalRail approvalStatus={approvalStatus} /></div>
          <CommandDock route={routes[selectedRoute]} onRouteClick={openRouteMenu} />
        </main>
        <DetailsRail
          approvalStatus={approvalStatus}
          onApprovalChange={setApprovalStatus}
          selectedRoute={selectedRoute}
          onRouteSelect={setSelectedRoute}
        />
      </div>
      {routeMenuOpen && <RouteMenu selected={selectedRoute} onSelect={setSelectedRoute} onClose={closeRouteMenu} />}
    </div>
  )
}
