import { useState } from 'react'
import { usagePercent, usageWindowSentence } from '../missionView.js'
import type { ReactElement, ReactNode } from 'react'

import type {
  AppUpdateResponse,
  AppUpdateState,
  MissionPruneResponse,
  PublicRecoveredMission,
  PublicRoutine,
  PublicRuntimeStatus,
  PublicStorageReport,
  PublicTeammate,
  MemoryMode,
  PublicRuntimeSetup,
  PublicWorkspaceBrief,
  PublicWorktree
} from '../../../shared/ipc.js'
import { roleLabelOf } from '../../../shared/ipc.js'
import {
  formatBytes,
  integrationOf,
  missionPhaseView,
  modeLabel,
  prunePreviewSummary,
  routeRowStatus
} from '../status.js'
import { PixelFace } from './PixelFace.js'
import type { FaceActivity } from '../faceState.js'
import { costLine, runCostOf, sumCosts } from '../cost.js'
import { agoLabel, teammateWork } from '../teammateWork.js'
import { routineRunSummary, routineScheduleSummary, routineStepLabel } from '../routines.js'
import { runtimeDisplayName } from '../../../shared/runtimes.js'

export type Screen = 'workroom' | 'missions' | 'teammates' | 'settings' | 'rooms' | 'memory' | 'automations'

function ScreenHeader({ title, meta }: { readonly title: string; readonly meta: string }): ReactElement {
  return (
    <div className="lc-screen__header">
      <span className="lc-screen__title">{title}</span>
      <span className="lc-screen__meta lc-mono">{meta}</span>
    </div>
  )
}

/** Between a routine's steps in its hover text, so each is readable on its own line. */
const STEP_GAP = '\n\n'

const FILTERS = ['All', 'Running', 'Interrupted', 'Completed'] as const
type Filter = (typeof FILTERS)[number]

/**
 * A mission's phase for this screen, which has to account for the ones the
 * host is running RIGHT NOW.
 *
 * The ledger's own phase cannot say "running": a mission with no terminal
 * receipt reads as `interrupted`, which is the correct reading of a file but
 * the wrong word for a run that is still going. The shell knows which ids are
 * live, so it answers that here.
 */
export function missionRowPhase(
  mission: PublicRecoveredMission,
  runningMissionIds: ReadonlySet<string>
): PublicRecoveredMission['phase'] | 'running' {
  return runningMissionIds.has(mission.missionId) ? 'running' : mission.phase
}

export function matchesFilter(
  mission: PublicRecoveredMission,
  filter: Filter,
  runningMissionIds: ReadonlySet<string>
): boolean {
  if (filter === 'All') return true
  const phase = missionRowPhase(mission, runningMissionIds)
  if (filter === 'Running') return phase === 'running'
  if (filter === 'Interrupted') return phase === 'interrupted'
  return phase === 'completed'
}

/**
 * Missions.
 *
 * The reference offers a "Needs approval" filter; there is no approval channel
 * yet, so a filter that can only ever return nothing is left out rather than
 * shipped as a dead control.
 */
export function MissionsScreen({
  missions,
  teammates,
  missionOwners,
  runningMissionIds,
  titleOf,
  onOpen
}: {
  readonly missions: readonly PublicRecoveredMission[]
  readonly teammates: readonly PublicTeammate[]
  readonly missionOwners: Readonly<Record<string, string>>
  /** The missions the host is running now; the ledger cannot know this. */
  readonly runningMissionIds: ReadonlySet<string>
  /**
   * What to call a mission. A continuation's own prompt can be the host's
   * briefing, and the sidebar already names such a row by the words a person
   * typed; this screen used to print the briefing in the same column as every
   * real instruction.
   */
  readonly titleOf: (mission: PublicRecoveredMission) => string
  readonly onOpen: (missionId: string) => void
}): ReactElement {
  const [filter, setFilter] = useState<Filter>('All')
  const shown = missions.filter((mission) => matchesFilter(mission, filter, runningMissionIds))
  const withIssues = missions.filter((mission) => mission.integrityIssueCount > 0).length
  // What the shown missions cost, in whatever units their receipts carry.
  // Runtimes that report nothing contribute nothing, and are counted as such
  // rather than as free.
  const costs = shown.map((mission) => runCostOf(mission.events))
  const priced = costs.filter((cost) => cost !== undefined).length
  const total = costLine(sumCosts(costs))

  return (
    <div className="lc-screen">
      <ScreenHeader
        title="Missions"
        meta={`${missions.length} local · ${
          withIssues === 0 ? 'ledger verified' : `${withIssues} with an incomplete receipt`
        }${total === undefined ? '' : ` · ${total} across ${priced} priced`}`}
      />
      {/*
        * Filters over an empty archive are four controls that can only ever
        * return nothing -- the same reason the approval filter is withheld
        * when there is nothing to approve. Raised by the design pass as a
        * feature question rather than a styling one, which it is.
        */}
      {missions.length > 0 && (
      <div className="lc-filters">
        {FILTERS.map((name) => (
          <button
            key={name}
            type="button"
            aria-pressed={filter === name}
            className={`lc-filter${filter === name ? ' is-active' : ''}`}
            onClick={() => setFilter(name)}
          >
            {name}
          </button>
        ))}
      </div>
      )}
      <div className="lc-screen__scroll">
        {shown.length === 0 ? (
          <p className="lc-inspector__empty">
            {missions.length === 0
              ? 'No missions recorded on this machine yet.'
              : 'No missions match this filter.'}
          </p>
        ) : (
          <div className="lc-missionrows">
            {shown.map((mission) => {
              const view = missionPhaseView(mission.phase, mission.integrityIssueCount > 0)
              const owner = teammates.find(
                (teammate) => teammate.teammateId === missionOwners[mission.missionId]
              )
              const elapsed = Math.max(
                0,
                Math.round((Date.parse(mission.lastUpdatedAt) - Date.parse(mission.createdAt)) / 60000)
              )
              return (
                <button
                  type="button"
                  key={mission.missionId}
                  className="lc-missionrow"
                  onClick={() => onOpen(mission.missionId)}
                >
                  <span className={`lc-rail__dot lc-tone-${view.tone}`} />
                  <span className="lc-missionrow__title">{titleOf(mission)}</span>
                  <span className="lc-missionrow__owner">{owner?.name ?? '—'}</span>
                  <span className="lc-missionrow__route lc-mono">
                    {mission.runtime} / {mission.model}
                  </span>
                  <span className="lc-missionrow__stats lc-mono">
                    {mission.checkpoints.length} checkpoint{mission.checkpoints.length === 1 ? '' : 's'} · {elapsed}m
                  </span>
                  <span className="lc-missionrow__cost lc-mono" title="What the runtime reported this run cost">
                    {costLine(runCostOf(mission.events)) ?? '—'}
                  </span>
                  <span className={`lc-missionrow__tag lc-mono lc-tone-${view.tone}`}>{view.tag}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

export function TeammatesScreen({
  teammates,
  missions,
  missionOwners,
  activityByTeammate,
  titleOf,
  onOpenMission,
  onNewTeammate,
  onEdit,
  onRemove,
  routines,
  routineStepByTeammate,
  onRunRoutine,
  onEditRoutine,
  onRemoveRoutine
}: {
  readonly teammates: readonly PublicTeammate[]
  /** Every recovered mission, so a card can say what its teammate has done. */
  readonly missions: readonly PublicRecoveredMission[]
  readonly missionOwners: Readonly<Record<string, string>>
  /** The words a person typed, which for a continuation is not its own prompt. */
  readonly titleOf: (mission: PublicRecoveredMission) => string
  readonly onOpenMission: (missionId: string) => void
  /** Each teammate's face state, decided once in the shell so the roster agrees with the sidebar. */
  readonly activityByTeammate: Readonly<Record<string, FaceActivity>>
  readonly onNewTeammate: () => void
  readonly onEdit: (teammate: PublicTeammate) => void
  readonly onRemove: (teammateId: string) => void
  /** Every routine on file. Each is filed under the teammate that runs it. */
  readonly routines: readonly PublicRoutine[]
  /** Which routine each teammate is replaying right now, if any. */
  readonly routineStepByTeammate: Readonly<Record<string, { readonly name: string; readonly step: number; readonly of: number }>>
  readonly onRunRoutine: (routineId: string) => void
  readonly onEditRoutine: (routine: PublicRoutine) => void
  readonly onRemoveRoutine: (routineId: string) => void
}): ReactElement {
  return (
    <div className="lc-screen">
      <ScreenHeader
        title="Team"
        meta={`${teammates.length} teammate${teammates.length === 1 ? '' : 's'} · avatars and roles are yours to set`}
      />
      <div className="lc-screen__scroll">
        <div className="lc-rostergrid">
          {teammates.map((teammate) => {
            const owned = Object.values(missionOwners).filter((owner) => owner === teammate.teammateId).length
            const work = teammateWork(teammate.teammateId, missions, missionOwners, titleOf)
            const theirRoutines = routines.filter((routine) => routine.teammateId === teammate.teammateId)
            const replaying = routineStepByTeammate[teammate.teammateId]
            return (
              <div className="lc-rostercard" key={teammate.teammateId}>
                <div className="lc-rostercard__head">
                  <PixelFace
                    hue={teammate.hue}
                    avatar={teammate.avatar}
                    size={36}
                    activity={activityByTeammate[teammate.teammateId] ?? 'idle'}
                    teammateId={teammate.teammateId}
                  />
                  <div className="lc-rostercard__id">
                    <div className="lc-rostercard__name">{teammate.name}</div>
                    <div className="lc-rostercard__role">{roleLabelOf(teammate)}</div>
                  </div>
                  <div className="lc-rostercard__actions">
                    <button type="button" className="lc-rostercard__edit" onClick={() => onEdit(teammate)}>
                      Edit
                    </button>
                    <button
                      type="button"
                      className="lc-rostercard__remove"
                      onClick={() => onRemove(teammate.teammateId)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
                {/*
                  * Route and mode are identity, not status, and the model name
                  * is the fact this product exists to keep legible -- so it
                  * gets a full-width row and wraps rather than ever being cut.
                  */}
                <div className="lc-rostercard__route lc-mono">
                  {teammate.route === undefined ? (
                    <span>not run yet · route set by their first mission</span>
                  ) : (
                    <>
                      <span className="lc-rostercard__model">
                        {runtimeDisplayName(teammate.route.runtime)} / {teammate.route.model}
                      </span>
                      <span>{modeLabel(teammate.route.mode)}</span>
                    </>
                  )}
                </div>
                <dl className="lc-rostercard__stats">
                  <div className="lc-rostercard__stat">
                    <dt>Missions</dt>
                    <dd className={`lc-mono${owned === 0 ? ' is-unreported' : ''}`}>{owned}</dd>
                  </div>
                  <div className="lc-rostercard__stat">
                    <dt>Last run</dt>
                    <dd className={`lc-mono${work.lastRunAt === undefined ? ' is-unreported' : ''}`}>
                      {work.lastRunAt === undefined ? 'never' : agoLabel(work.lastRunAt) ?? 'unknown'}
                    </dd>
                  </div>
                </dl>
                {/* Undefined is not zero: a runtime that reported no usage has
                  * not said the work was free, and `not reported` must never
                  * be truncated into saying something else. */}
                <dl className="lc-rostercard__cost">
                  <dt>Cost</dt>
                  <dd className={`lc-mono${work.cost === undefined ? ' is-unreported' : ''}`}>
                    {costLine(work.cost) ?? 'not reported'}
                  </dd>
                </dl>
                {work.recent.length > 0 && (
                  <div className="lc-rostercard__recent">
                    <div className="lc-rostercard__recentlabel lc-mono">Recent</div>
                    {work.recent.map((entry) => (
                      <button
                        type="button"
                        key={entry.missionId}
                        className="lc-rostercard__mission"
                        onClick={() => onOpenMission(entry.missionId)}
                      >
                        <span className={`lc-dot lc-tone-${missionPhaseView(entry.phase, false).tone}`} />
                        <span className="lc-rostercard__missiontitle">{entry.title}</span>
                        <span className="lc-rostercard__missionage lc-mono">{agoLabel(entry.at) ?? ''}</span>
                      </button>
                    ))}
                  </div>
                )}
                {/*
                  * Routines: conversations this teammate has been taught, and
                  * can replay. Shown here rather than in a screen of their own
                  * because a routine belongs to a teammate -- it runs on their
                  * route, with their permissions, and dies with them.
                  */}
                {theirRoutines.length > 0 && (
                  <div className="lc-routinelist">
                    <div className="lc-rostercard__recentlabel lc-mono">Routines</div>
                    {theirRoutines.map((routine) => (
                      <div className="lc-routinerow" key={routine.routineId}>
                        <span className="lc-routinerow__name" title={routine.steps.join(STEP_GAP)}>
                          {routine.name}
                          <span className="lc-routinerow__meta lc-mono"> · {routineRunSummary(routine)}</span>
                          {routineScheduleSummary(routine, new Date()) !== undefined && (
                            <span className="lc-routinerow__meta lc-mono lc-routinerow__sched">
                              {routineScheduleSummary(routine, new Date())}
                            </span>
                          )}
                        </span>
                        <button
                          type="button"
                          className="lc-ghostbutton"
                          disabled={replaying !== undefined}
                          title={
                            replaying === undefined
                              ? undefined
                              : `${replaying.name} is running: ${routineStepLabel(replaying)}`
                          }
                          onClick={() => onRunRoutine(routine.routineId)}
                        >
                          Run
                        </button>
                        <span className="lc-routinerow__meta">
                          <button type="button" className="lc-ghostbutton" onClick={() => onEditRoutine(routine)}>
                            Edit
                          </button>
                          <button type="button" className="lc-ghostbutton" onClick={() => onRemoveRoutine(routine.routineId)}>
                            Remove
                          </button>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
          <button type="button" className="lc-rostercard lc-rostercard--new" onClick={onNewTeammate}>
            <span className="lc-rostercard__plus">+</span>
            <span className="lc-rostercard__name">New teammate</span>
            <span className="lc-rostercard__role">Name, role and avatar. Missions group under them.</span>
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Settings.
 *
 * Runtimes read from discovery. Fallback policy and swarm are drawn because the
 * design places them here, but both are shown as unavailable with the reason --
 * fallback needs route switching, and swarm needs a route that reports whether
 * it honours effort. Neither is rendered as a working toggle that does nothing.
 */
/** The ages offered. Long by default: history is the point of the ledger. */
const RETENTION_CHOICES = [30, 90, 365] as const

/**
 * Deleting old missions in bulk, in two deliberate steps.
 *
 * Nothing is ever pruned automatically, and the first press only ASKS. What
 * comes back is the host's own plan, computed by the same code that does the
 * deleting, and it names what would be kept as well as what would go. Only
 * then does a second, differently-worded press carry it out.
 */
function RetentionControl({
  report,
  onPreview,
  onPrune
}: {
  readonly report: PublicStorageReport | undefined
  readonly onPreview: (days: number) => Promise<MissionPruneResponse>
  readonly onPrune: (days: number) => Promise<MissionPruneResponse>
}): ReactElement {
  const [days, setDays] = useState<number>(90)
  const [state, setState] = useState<
    | { readonly kind: 'idle' }
    | { readonly kind: 'working' }
    | { readonly kind: 'preview'; readonly days: number; readonly summary: string; readonly count: number }
    | { readonly kind: 'done'; readonly summary: string }
    | { readonly kind: 'error'; readonly message: string }
  >({ kind: 'idle' })

  const ask = async (chosen: number): Promise<void> => {
    setState({ kind: 'working' })
    const response = await onPreview(chosen)
    if (!response.ok) {
      setState({ kind: 'error', message: response.error.message })
      return
    }
    setState({
      kind: 'preview',
      days: chosen,
      summary: prunePreviewSummary(response.data),
      count: response.data.deleted.length
    })
  }

  const confirm = async (chosen: number): Promise<void> => {
    setState({ kind: 'working' })
    const response = await onPrune(chosen)
    if (!response.ok) {
      setState({ kind: 'error', message: response.error.message })
      return
    }
    const gone = response.data.deleted.length
    setState({
      kind: 'done',
      summary: `Deleted ${String(gone)} mission${gone === 1 ? '' : 's'}.`
    })
  }

  return (
    <div className="lc-retention">
      <div className="lc-retention__row">
        <span className="lc-settings__note">Delete finished missions older than</span>
        {RETENTION_CHOICES.map((choice) => (
          <button
            key={choice}
            type="button"
            className={`lc-chip${choice === days ? ' is-on' : ''}`}
            aria-pressed={choice === days}
            onClick={() => {
              setDays(choice)
              setState({ kind: 'idle' })
            }}
          >
            {choice === 365 ? '1 year' : `${String(choice)} days`}
          </button>
        ))}
        <button
          type="button"
          className="lc-button"
          disabled={state.kind === 'working' || report?.missionCount === 0}
          onClick={() => void ask(days)}
        >
          {state.kind === 'working' ? 'Working…' : 'Review'}
        </button>
      </div>
      {state.kind === 'preview' && (
        <div className="lc-retention__plan">
          <span className="lc-settings__note">{state.summary}</span>
          {state.count > 0 && (
            <button type="button" className="lc-button lc-button--danger" onClick={() => void confirm(state.days)}>
              Delete them for good
            </button>
          )}
        </div>
      )}
      {state.kind === 'done' && <span className="lc-settings__note">{state.summary}</span>}
      {state.kind === 'error' && <span className="lc-settings__note lc-tone-red">{state.message}</span>}
    </div>
  )
}

/**
 * The update control.
 *
 * The app checks on its own and downloads on its own; it never installs on
 * its own, because a restart under a running mission would cut the run and
 * leave its record without a terminal receipt. So the last step is a button,
 * and it refuses while anything is running.
 */
function UpdateControl({
  update,
  onCheck,
  onInstall
}: {
  readonly update: AppUpdateState | undefined
  readonly onCheck: () => Promise<AppUpdateResponse>
  readonly onInstall: () => Promise<AppUpdateResponse>
}): ReactElement {
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState<string>()

  const phase = update?.phase ?? 'idle'
  const line =
    phase === 'unsupported'
      ? 'This build cannot update itself. Installed copies check on their own.'
      : phase === 'checking'
        ? 'Checking…'
        : phase === 'current'
          ? 'Up to date.'
          : phase === 'available'
            ? `Version ${update?.availableVersion ?? ''} is available. Downloading it now.`
            : phase === 'downloading'
              ? `Downloading ${update?.availableVersion ?? ''}${update?.percent === undefined ? '' : ` · ${String(update.percent)}%`}`
              : phase === 'ready'
                ? `Version ${update?.availableVersion ?? ''} is downloaded and ready to install.`
                : phase === 'failed'
                  ? update?.message ?? 'The update check could not complete.'
                  : 'Not checked yet.'

  return (
    <div className="lc-retention">
      <div className="lc-retention__row">
        <span className={`lc-settings__note${phase === 'failed' ? ' lc-tone-red' : ''}`}>{line}</span>
        <button
          type="button"
          className="lc-button"
          disabled={busy || phase === 'unsupported' || phase === 'checking'}
          onClick={() => {
            setBusy(true)
            setRefusal(undefined)
            void onCheck().finally(() => {
              setBusy(false)
            })
          }}
        >
          Check now
        </button>
        {phase === 'ready' && (
          <button
            type="button"
            className="lc-button"
            disabled={busy}
            onClick={() => {
              setBusy(true)
              setRefusal(undefined)
              void onInstall()
                .then((response) => {
                  if (!response.ok) setRefusal(response.error.message)
                })
                .finally(() => {
                  setBusy(false)
                })
            }}
          >
            Install and restart
          </button>
        )}
      </div>
      {refusal !== undefined && <span className="lc-settings__note lc-tone-red">{refusal}</span>}
    </div>
  )
}

/**
 * One muted line: the runtime's own MCP servers and hooks by name, with the
 * files they were read from in the tooltip. Nothing configured says so in
 * words, so an empty line never reads as "not checked".
 */
/**
 * The explanation a section used to open with, folded under one line.
 * Settings read as a manual: every heading had a paragraph before its first
 * control (Colin, 2026-09-05: "the settings screen looks a little clunky").
 * The words are all still here; they wait behind "How it works".
 */
function More({ children }: { readonly children: ReactNode }): ReactElement {
  return (
    <details className="lc-settings__more">
      <summary>How it works</summary>
      <div className="lc-settings__moretext">{children}</div>
    </details>
  )
}

/** The first few names and a count for the rest, so a long list stays one line. */
function fewNames(names: readonly string[], limit = 5): string {
  return names.length <= limit ? names.join(', ') : `${names.slice(0, limit).join(', ')} +${String(names.length - limit)}`
}

function RuntimeSetupLine({ setup }: { readonly setup: PublicRuntimeSetup }): ReactElement {
  const parts: string[] = []
  if (setup.mcpServers.length > 0) parts.push(`MCP: ${setup.mcpServers.join(', ')}`)
  if (setup.hooks.length > 0) parts.push(`Hooks: ${setup.hooks.join(', ')}`)
  if (setup.skills.length > 0) parts.push(`Skills: ${fewNames(setup.skills)}`)
  if (setup.agents.length > 0) parts.push(`Agents: ${fewNames(setup.agents)}`)
  if (setup.unreadable.length > 0) parts.push(`${String(setup.unreadable.length)} config file${setup.unreadable.length === 1 ? '' : 's'} could not be read`)
  const text = parts.length === 0 ? 'No MCP servers, hooks, skills or agents configured' : parts.join(' · ')
  const title = [...setup.sources.map((path) => `read: ${path}`), ...setup.unreadable.map((path) => `unreadable: ${path}`)].join('\n')
  return (
    <div className="lc-runtimerow__detail lc-runtimerow__setup" title={title.length === 0 ? 'No configuration files found' : title}>
      {text}
    </div>
  )
}

export function SettingsScreen({
  runtimes,
  limitedRuntimes,
  usageWindows,
  runtimeSetup,
  workspaceBrief,
  worktrees,
  onRemoveWorktree,
  workspacePath,
  workspaceMade = false,
  onChooseFolder,
  ledgerPath,
  build,
  storage,
  update,
  onCheckUpdate,
  onInstallUpdate,
  relay,
  onRelayChange,
  autoMode,
  onAutoModeChange,
  relayHopCap,
  onRelayHopCapChange,
  memoryMode,
  onMemoryModeChange,
  memoryCount,
  memoryWaiting,
  onOpenMemory,
  onPreviewPrune,
  onPrune
}: {
  readonly runtimes: readonly PublicRuntimeStatus[]
  /** Runtimes whose last run ended on the account's usage limit, with its own words. */
  readonly limitedRuntimes: ReadonlyMap<string, string>
  /** The latest still-allowed rate-limit reading per runtime, in words. */
  readonly usageWindows?: ReadonlyMap<string, string>
  /** Each runtime's own MCP servers and hooks, by runtime id; undefined until read. */
  readonly runtimeSetup: Readonly<Record<string, PublicRuntimeSetup>> | undefined
  /** The folder's LOCUST.md as last read: null when none, undefined until the host has answered. */
  readonly workspaceBrief: PublicWorkspaceBrief | null | undefined
  /** The teammates' own worktrees under the folder, and why there can be none; undefined until read. */
  readonly worktrees: { readonly list: readonly PublicWorktree[]; readonly reason: string | undefined } | undefined
  readonly onRemoveWorktree: (teammateId: string) => Promise<string | undefined>
  /** The folder every teammate works in; undefined when none is chosen. */
  readonly workspacePath: string | undefined
  readonly workspaceMade?: boolean
  readonly onChooseFolder: () => void
  readonly ledgerPath: string | undefined
  /** Which build this is; undefined until the host has answered. */
  readonly build: { readonly version: string; readonly packaged: boolean } | undefined
  /** What the local history costs; undefined until the host has answered. */
  readonly storage: PublicStorageReport | undefined
  /** Where an update stands; undefined until the host has said anything. */
  readonly update: AppUpdateState | undefined
  readonly onCheckUpdate: () => Promise<AppUpdateResponse>
  readonly onInstallUpdate: () => Promise<AppUpdateResponse>
  /** Whether teammates start runs to answer each other. */
  readonly relay: boolean
  readonly onRelayChange: (relay: boolean) => void
  /** Whether the Auto permission mode may be chosen at all. */
  readonly autoMode: boolean
  readonly onAutoModeChange: (autoMode: boolean) => void
  /** The autonomy budget: automatic replies one exchange may use before it waits for a person. */
  readonly relayHopCap: number
  readonly onRelayHopCapChange: (cap: number) => void
  /** What happens to a memory a teammate writes. */
  readonly memoryMode: MemoryMode
  readonly onMemoryModeChange: (mode: MemoryMode) => void
  readonly memoryCount: number
  /** Memories a teammate proposed that wait for a keep or a forget. */
  readonly memoryWaiting: number
  readonly onOpenMemory: () => void
  readonly onPreviewPrune: (days: number) => Promise<MissionPruneResponse>
  readonly onPrune: (days: number) => Promise<MissionPruneResponse>
}): ReactElement {
  return (
    <div className="lc-screen">
      <ScreenHeader
        title="Settings"
        meta={
          build === undefined
            ? 'workspace · local only'
            : `Locust ${build.version}${build.packaged ? '' : ' · development build'} · local only`
        }
      />
      <div className="lc-screen__scroll">
        {/*
          * Where the teammates work. A workspace-wide fact, so it sits with
          * the other workspace-wide settings rather than on the intro screen
          * (Colin, 2026-09-05). The composer carries a chip for the same
          * thing, the way Claude Code states its own folder on the bar.
          */}
        <section className="lc-settings__section">
          <h2 className="lc-settings__heading">Project folder</h2>
          <p className="lc-settings__lede">
            Every teammate works inside one folder, and every mission runs there.
          </p>
          <More>
            <p>Changing the folder reopens Locust, so stop anything running first.</p>
            <p>
              A LOCUST.md at the folder&rsquo;s root is given to every teammate, on every runtime, before each
              mission. A teammate with Own branch on works in its own worktree of the folder&rsquo;s repository,
              kept under .locust/worktrees; removing one here keeps its branch, and merging is yours to do.
            </p>
          </More>
          <div className="lc-settingcard">
          <div className={`lc-folder${workspacePath === undefined ? ' is-missing' : ''}`}>
            <div className="lc-folder__text">
              <div className="lc-folder__label">
                {workspacePath === undefined ? 'No folder chosen' : workspaceMade ? 'Teammates work in a folder Locust made' : 'Teammates work in'}
              </div>
              <div className={`lc-folder__path${workspacePath === undefined ? '' : ' lc-mono'}`}>
                {workspacePath ?? 'Pick a project folder before the first mission.'}
              </div>
            </div>
            <button type="button" className="lc-button" onClick={onChooseFolder}>
              {workspacePath === undefined ? 'Choose folder' : 'Change'}
            </button>
          </div>
          {workspacePath !== undefined && workspaceBrief !== undefined && (
            <div className="lc-policyrow">
              <span className="lc-tag">LOCUST.md</span>
              <span className="lc-settings__note">
                {workspaceBrief === null
                  ? 'None in this folder. Add a LOCUST.md at its root and every teammate, on every runtime, is given it before each mission.'
                  : `${String(workspaceBrief.lines)} line${workspaceBrief.lines === 1 ? '' : 's'} briefed to every teammate before each mission${workspaceBrief.truncated ? ' -- longer than 200 lines, so the rest is not loaded' : ''}.`}
              </span>
            </div>
          )}
          {workspacePath !== undefined && worktrees !== undefined && (
            <div className="lc-policyrow lc-policyrow--stack">
              <span className="lc-tag">OWN BRANCHES</span>
              <span className="lc-settings__note">
                {worktrees.reason !== undefined
                  ? `${worktrees.reason} A teammate with Own branch on cannot start until this is fixed.`
                  : worktrees.list.length === 0
                    ? 'None yet. Turn Own branch on in a teammate\'s card and its next run makes one.'
                    : 'Removing one keeps its branch.'}
              </span>
              {worktrees.list.length > 0 && (
                <div className="lc-worktreelist">
                  {worktrees.list.map((tree) => (
                    <div className="lc-worktreerow" key={tree.teammateId}>
                      <span className="lc-worktreerow__who">{tree.teammateName ?? tree.teammateId}</span>
                      <span className="lc-worktreerow__branch lc-mono" title={tree.path}>{tree.branch}</span>
                      <button
                        type="button"
                        className="lc-ghostbutton"
                        disabled={tree.busy}
                        title={tree.busy ? 'A run is live in this worktree' : `Remove the worktree; the branch ${tree.branch} stays`}
                        onClick={() => void onRemoveWorktree(tree.teammateId)}
                      >
                        {tree.busy ? 'In use' : 'Remove'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          </div>
        </section>

        <section className="lc-settings__section">
          <h2 className="lc-settings__heading">Runtimes &amp; accounts</h2>
          <p className="lc-settings__lede">
            Each runtime uses the account already signed in on this machine. Locust adds nothing of its own.
          </p>
          <More>
            <p>
              Locust never pools subscriptions or proxies your requests. Under each runtime is what it has
              set up for itself -- MCP servers and hooks, read from its own files -- so a tool a teammate
              reaches for, or a script that runs mid-mission, is never a surprise. Locust changes nothing there.
            </p>
          </More>
          <div className="lc-runtimelist lc-settingcard">
            {runtimes.map((runtime) => {
              const status = routeRowStatus(runtime, integrationOf(runtime.id), false, limitedRuntimes.get(runtime.id))
              return (
                <div className="lc-runtimerow" key={runtime.id}>
                  <div className="lc-runtimerow__text">
                    <div className="lc-runtimerow__name">
                      {runtime.displayName}
                      {runtime.version !== null && <span className="lc-runtimerow__version lc-mono">{runtime.version}</span>}
                    </div>
                    {/* "Signed in on this machine" is said once, in the lede; a row only speaks when its state is not the ordinary one. */}
                    {status.tag !== 'READY' && <div className="lc-runtimerow__detail">{status.detail}</div>}
                    {usageWindows?.get(runtime.id) !== undefined && (
                      <div className={`lc-runtimerow__detail lc-runtimerow__usage${(usagePercent(usageWindows.get(runtime.id)!) ?? 0) >= 80 ? ' lc-tone-amber' : ''}`}>
                        {usageWindowSentence(usageWindows.get(runtime.id)!)}
                      </div>
                    )}
                    {runtimeSetup?.[runtime.id] !== undefined && <RuntimeSetupLine setup={runtimeSetup[runtime.id]!} />}
                  </div>
                  <span
                    className={`lc-tag${
                      // Green is available, lime is happening now (design
                      // pass, objection 5). The first-run panel took the
                      // rule in 0.21.2; Settings kept five lime tags for a
                      // list where nothing is running -- seen in the user
                      // session, 2026-09-05.
                      status.tag === 'READY' || status.tag === 'ACTIVE'
                        ? ' is-green'
                        : status.tag === 'SIGN IN'
                          ? ' is-red'
                          : status.tag === 'PREVIEW' || status.tag === 'EXPERIMENTAL' || status.tag === 'AT LIMIT'
                            ? ' is-amber'
                            : ''
                    }`}
                  >
                    {status.tag}
                  </span>
                </div>
              )
            })}
          </div>
        </section>

        <section className="lc-settings__section">
          <h2 className="lc-settings__heading">Updates</h2>
          <p className="lc-settings__lede">
            Locust checks for a new version on its own and downloads it quietly.
          </p>
          <More>
            <p>
              It never installs one while a mission is running: restarting then would cut the run off and
              leave its record without a receipt.
            </p>
          </More>
          <UpdateControl update={update} onCheck={onCheckUpdate} onInstall={onInstallUpdate} />
        </section>

        <section className="lc-settings__section">
          <h2 className="lc-settings__heading">Auto mode</h2>
          <p className="lc-settings__lede">
            {autoMode
              ? 'On. A mission started in Auto runs without asking and is not confined to the workspace folder.'
              : 'Off. Missions may edit files inside the workspace folder and nowhere else.'}
          </p>
          <More>
            <p>
              Every other mode confines a run to the folder you chose for it, and a runtime that wants to
              touch anything outside it is refused. Auto is the mode that does not: a run started in Auto
              goes ahead without asking and may read and change files anywhere this computer lets you,
              including outside the folder.
            </p>
            <p>
              It exists because some work genuinely lives in more than one place. Auto is always in the
              composer's permission menu and picking it there is what switches it on, so this is the same
              decision seen from the other side: what is on now, and the way to take it back. It is checked
              again each time a run starts -- switching it off here stops the next run, including one a
              teammate or a routine was about to start -- and it is never the mode a malformed or missing
              choice falls back to.
            </p>
          </More>
          <div className="lc-settingrows">
            <div className="lc-settingrow">
              <span className="lc-settings__note">
                {autoMode
                  ? 'On. A run in Auto may change files anywhere on this machine.'
                  : 'Off. Picking Auto in the composer switches it back on.'}
              </span>
              <button
                type="button"
                className={`lc-switch${autoMode ? ' is-on' : ''}`}
                role="switch"
                aria-checked={autoMode}
                aria-label={autoMode ? 'Switch this off' : 'Switch this on'}
                onClick={() => onAutoModeChange(!autoMode)}
              >
                <span className="lc-switch__knob" />
              </button>
            </div>
          </div>
        </section>

        <section className="lc-settings__section">
          <h2 className="lc-settings__heading">Teammates</h2>
          <p className="lc-settings__lede">
            Teammates answer each other on their own, each on its own route, and stop after {String(relayHopCap)} automatic {relayHopCap === 1 ? 'reply' : 'replies'}.
          </p>
          <More>
            <p>
              When a teammate writes to another, the other can answer on their own: Locust starts a run for
              them with the message as its brief, and their answer starts the sender&rsquo;s next turn, so it
              lands in the thread that asked. They keep going while a reply helps finish the work, and stop
              when one has nothing more to say, or when the budget below is spent.
            </p>
            <p>
              Each teammate answers on their own route -- their runtime, model and mode, not the sender&rsquo;s --
              which is how two models end up on one piece of work. Switch replies off to make messages wait
              for you instead.
            </p>
          </More>
          <div className="lc-settingrows">
            <div className="lc-settingrow">
              <span className="lc-settings__note">
                {relay ? 'Teammates reply to each other until the work is done.' : 'Messages wait for the recipient\'s next run.'}
              </span>
              <button
                type="button"
                className={`lc-switch${relay ? ' is-on' : ''}`}
                role="switch"
                aria-checked={relay}
                aria-label={relay ? 'Switch this off' : 'Switch this on'}
                onClick={() => onRelayChange(!relay)}
              >
                <span className="lc-switch__knob" />
              </button>
            </div>
            {/*
              * The autonomy budget. Six was a constant nobody could see or
              * change; the 0.21.2 QA pass (rec. 6) asked for a budget the
              * person owns. Fixed steps rather than a free number: each is
              * a real answer to "how far may they go without me".
              */}
            <div className="lc-settingrow">
              <span className="lc-settings__note">
                Automatic replies per exchange before they wait for you
              </span>
              <div className="lc-segmented" role="radiogroup" aria-label="Automatic replies per exchange">
                {[1, 2, 4, 6, 8, 12].map((cap) => (
                  <button
                    key={cap}
                    type="button"
                    role="radio"
                    aria-checked={relayHopCap === cap}
                    className={`lc-button${relayHopCap === cap ? ' is-active' : ''}`}
                    disabled={!relay}
                    onClick={() => onRelayHopCapChange(cap)}
                  >
                    {String(cap)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="lc-settings__section">
          <h2 className="lc-settings__heading">What your team remembers</h2>
          <p className="lc-settings__lede">
            Teammates keep a shared memory per folder, plus a smaller set marked everywhere.
          </p>
          <More>
            <p>
              The way Claude Code and Cursor do, managed from here. A teammate writes one by ending a reply
              with it; every teammate in the folder reads what is kept. Each memory says who wrote it, where,
              and from which conversation, and you can edit, switch off, or remove any of them.
            </p>
          </More>
          <div className="lc-settingrows">
          <div className="lc-settingrow">
            <span className="lc-settings__note">When a teammate writes a memory</span>
            <div className="lc-segmented" role="radiogroup" aria-label="When a teammate writes a memory">
              {(
                [
                  ['auto', 'Keep and tell me'],
                  ['ask', 'Ask me first'],
                  ['off', 'Off']
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={memoryMode === value}
                  className={`lc-button${memoryMode === value ? ' is-active' : ''}`}
                  onClick={() => onMemoryModeChange(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="lc-settingrow">
            <span className="lc-settings__note">
              {memoryCount === 0 ? 'Nothing remembered yet.' : `${String(memoryCount)} ${memoryCount === 1 ? 'memory' : 'memories'} kept.`}
              {memoryWaiting > 0 ? ` ${String(memoryWaiting)} waiting for you.` : ''}
            </span>
            <button type="button" className="lc-ghostbutton" title="Ctrl 5" onClick={onOpenMemory}>
              Open memory
            </button>
          </div>
          </div>
        </section>

        <section className="lc-settings__section">
          <h2 className="lc-settings__heading">When a route hits its limit</h2>
          <p className="lc-settings__lede">
            A run that hits its account&rsquo;s limit stops at a checkpoint and waits for you. Nothing switches provider on its own.
          </p>
          <More>
            <p>
              You choose where the work continues, and Locust carries it there with a briefing of what was
              done and what was left unsettled. Two ways to do that exist today; the third is not built.
            </p>
          <div className="lc-settingcard">
          <div className="lc-policyrow">
            <span className="lc-tag">HAND OFF</span>
            <span className="lc-settings__note">
              Pick another runtime from the composer while a mission is running. The run is stopped,
              reconciled, and continued there.
            </span>
          </div>
          <div className="lc-policyrow">
            <span className="lc-tag">CONTINUE ELSEWHERE</span>
            <span className="lc-settings__note">
              After a run has stopped, change the route and reply. The next turn starts on the new
              runtime from the old one&rsquo;s checkpoint, with your reply as its first instruction.
            </span>
          </div>
          <div className="lc-policyrow">
            <span className="lc-tag">AUTOMATIC</span>
            <span className="lc-settings__note">
              Not built. Locust will not move your work to a provider you did not choose.
            </span>
          </div>
          </div>
          </More>
        </section>

        <section className="lc-settings__section">
          <h2 className="lc-settings__heading">Privacy &amp; local data</h2>
          <p className="lc-settings__lede">
            Every mission is recorded to an append-only ledger on this machine. Nothing is uploaded.
          </p>
          <dl className="lc-receipt lc-receipt--flush">
            <dt>Ledger</dt>
            <dd className="lc-mono">{ledgerPath ?? 'in this profile'}</dd>
            <dt>On disk</dt>
            <dd className="lc-mono">
              {storage === undefined
                ? 'measuring…'
                : `${String(storage.missionCount)} mission${storage.missionCount === 1 ? '' : 's'} · ${formatBytes(storage.byteTotal)}${
                    storage.oldestUpdatedAt === undefined
                      ? ''
                      : ` · oldest ${new Date(storage.oldestUpdatedAt).toLocaleDateString()}`
                  }`}
            </dd>
            <dt>Network</dt>
            <dd>The window itself makes no outbound requests; runtimes talk to their own providers.</dd>
          </dl>
          <More>
            <p>
              Nothing here is ever deleted on a timer. Missions go when you ask, after you have been shown
              exactly what would go, and a mission an ongoing conversation continues from is kept even
              when it is old.
            </p>
          </More>
          <RetentionControl report={storage} onPreview={onPreviewPrune} onPrune={onPrune} />
        </section>
      </div>
    </div>
  )
}


/**
 * The one line that says a new version is here. Settings knew; the person
 * did not, because nobody opens Settings to find out. It sits above the
 * composer, offers the install, and never installs on its own -- a running
 * mission must not be cut off mid-run, and the host refuses if one is.
 */
export function UpdateBanner({
  update,
  onInstall
}: {
  readonly update: AppUpdateState | undefined
  readonly onInstall: () => Promise<AppUpdateResponse>
}): ReactElement | null {
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState<string>()
  if (update === undefined || update.phase !== 'ready') return null
  return (
    <div className="lc-updatebanner" role="status">
      <span className="lc-updatebanner__text">
        Locust {update.availableVersion ?? ''} is downloaded and ready. It installs when you restart.
        {refusal !== undefined && <span className="lc-tone-amber"> {refusal}</span>}
      </span>
      <button
        type="button"
        className="lc-button"
        disabled={busy}
        onClick={() => {
          setBusy(true)
          setRefusal(undefined)
          void onInstall()
            .then((response) => {
              if (!response.ok) setRefusal(response.error.message)
            })
            .finally(() => setBusy(false))
        }}
      >
        Restart and install
      </button>
    </div>
  )
}
