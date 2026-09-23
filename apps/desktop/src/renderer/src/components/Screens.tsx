import { useEffect, useRef, useState } from 'react'
import { durationText, usagePercent, usageWindowSentence } from '../missionView.js'
import { WhatsNew } from './WhatsNew.js'
import { SETTINGS_PAGES, matchedHeadings, pageMatches } from '../settingsPages.js'
import type { SettingsPageId } from '../settingsPages.js'
import type { MetalMotion, MetalPreset, MetalStrength } from '../../../shared/ipc.js'
import { modelDisplayName, routeModelName, shortRuntimeName } from '../routeName.js'
import type { ReactElement, ReactNode } from 'react'

import type {
  AppUpdateResponse,
  DiagnosticsReport,
  AppUpdateState,
  AppChangelog,
  MissionPruneResponse,
  PublicTrashedMission,
  TrashListResponse,
  TrashMutationResponse,
  PublicRecoveredMission,
  PublicRoutine,
  PublicRuntimeArtifact,
  PublicRuntimeStatus,
  PublicStorageReport,
  PublicTeammate,
  MemoryMode,
  LayoutPreference,
  PublicRuntimeSetup,
  PublicWorkspaceBrief,
  PublicWorktree, TubePreference, ReplyTextSize } from '../../../shared/ipc.js'
import { roleLabelOf } from '../../../shared/ipc.js'
import type { TeammateStatusView } from '../status.js'
import {
  facePresenceFor,
  formatBytes,
  integrationOf,
  missionPhaseView,
  modeLabel,
  prunePreviewSummary,
  routeRowStatus,
  runtimeListOrder
} from '../status.js'
import { CliArtifacts } from './CliArtifacts.js'
import { TeammateBot } from './TeammateBot.js'
import { Icon } from './Icon.js'
import { COST_NOT_REPORTED_SHORT, costLabel, costLine, costLineOrWhyNot, costTotal, runCostOf } from '../cost.js'
import { agoLabel, teammateWork } from '../teammateWork.js'
import { routineRunSummary, routineScheduleSummary, routineStepLabel } from '../routines.js'
import { RoutineRecovery } from './RoutineRecovery.js'
import type { RecoverRoutine } from './RoutineRecovery.js'
import { FREE_START_RUNTIME, installCommand } from '../../../shared/runtime-install.js'
import { SignInButton } from './SignInButton.js'

export type Screen = 'workroom' | 'missions' | 'teammates' | 'settings' | 'rooms' | 'memory' | 'automations'

/**
 * THE header for a list screen. Exported since 2026-09-22 because Routines
 * had a second one.
 *
 * Routines rendered `.lc-screen__head` -- a flex column with a UI-font lede
 * -- while Missions, Rooms and Memory rendered this 60px row. MEASURED on
 * the packaged build: 60 / 60 / 129px, so everything below the title stepped
 * down 69px on landing in Routines and back up on leaving. Colin: "why am I
 * so triggered". A tab click is the most frequent gesture in the app, and it
 * moved the page under him.
 *
 * One component, so a third form cannot appear by being written rather than
 * imported.
 */
export function ScreenHeader({ title, meta }: { readonly title: string; readonly meta: string }): ReactElement {
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
 * What the Missions header says when the ledger is not clean.
 *
 * Two different facts, and they must not be merged into one number: a mission
 * with an incomplete receipt is HERE and readable with a gap in it, while an
 * unreadable file is not here at all. "3 with an incomplete receipt" for two
 * of one and one of the other would replace a false reassurance with a false
 * count, which is not an improvement.
 *
 * Files, not issues: one truncated header raises both `truncated-tail` and
 * `invalid-record`, and "2 could not be read" for one file is its own lie.
 * `unreadableFileCount` in mission-history is what does that counting.
 */
export function ledgerDamageWords(withIssues: number, unreadable: number): string {
  const parts: string[] = []
  if (withIssues > 0) parts.push(`${String(withIssues)} with an incomplete receipt`)
  if (unreadable > 0) {
    parts.push(`${String(unreadable)} ${unreadable === 1 ? 'file' : 'files'} could not be read`)
  }
  return parts.join(' · ')
}

/**
 * Missions.
 *
 * The reference offers a "Needs approval" filter; there is no approval channel
 * yet, so a filter that can only ever return nothing is left out rather than
 * shipped as a dead control.
 */
export function MissionsScreen({
  workspaceId,
  missions,
  teammates,
  missionOwners,
  runningMissionIds,
  titleOf,
  secondaryOf,
  onOpen,
  unreadableLedgers = 0,
  ledgerUnreadable = false,
  onDeleteMissions
}: {
  readonly missions: readonly PublicRecoveredMission[]
  /** The folder this window is open on, so the header can say how many are its own. */
  readonly workspaceId: string | undefined
  readonly teammates: readonly PublicTeammate[]
  readonly missionOwners: Readonly<Record<string, string>>
  /** The missions the host is running now; the ledger cannot know this. */
  readonly runningMissionIds: ReadonlySet<string>
  /**
   * The one line under the title: what this mission is doing right now, or
   * what it is waiting on you for.
   *
   * A list of twelve missions all reading COMPLETED or RUNNING tells you
   * which to open only by opening them. Undefined collapses the row to the
   * single line it has always been -- a settled mission has nothing live to
   * say, and inventing something for it would be noise on every row.
   */
  readonly secondaryOf?: (missionId: string) => string | undefined
  /**
   * What to call a mission. A continuation's own prompt can be the host's
   * briefing, and the sidebar already names such a row by the words a person
   * typed; this screen used to print the briefing in the same column as every
   * real instruction.
   */
  readonly titleOf: (mission: PublicRecoveredMission) => string
  readonly onOpen: (missionId: string) => void
  /**
   * Ledger files that raised an issue and produced no mission.
   *
   * They cannot appear in `missions` by definition -- that is the whole
   * defect: nothing in the list could carry their damage, so the header
   * reassured about them. Defaulted to zero so a caller that has not been
   * updated reads as it did before rather than crashing.
   */
  readonly unreadableLedgers?: number
  /**
   * The ledger could not be read at all, so this screen knows nothing.
   *
   * Distinct from "no missions": an empty ledger is a fact, and a ledger that
   * would not open is the absence of any facts. Both used to render the same
   * confident "ledger verified" -- seen by driving it with the ledger
   * directory replaced by a plain file (2026-09-08).
   */
  readonly ledgerUnreadable?: boolean
  /**
   * Delete these records for good. Absent means the screen offers no
   * selection at all -- a list with checkboxes and nowhere to take them is
   * worse than a list without.
   */
  readonly onDeleteMissions?: (missionIds: readonly string[]) => void
}): ReactElement {
  const [filter, setFilter] = useState<Filter>('All')
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const [armed, setArmed] = useState(false)
  const shown = missions.filter((mission) => matchesFilter(mission, filter, runningMissionIds))
  const withIssues = missions.filter((mission) => mission.integrityIssueCount > 0).length
  /*
   * "ledger verified" is a claim, and it must cover the files that are NOT here.
   *
   * `withIssues` counts recovered missions carrying an issue, which is every
   * mission whose file was damaged in its BODY. A file damaged in its HEADER,
   * or over the size limit, recovers no mission at all -- so it contributed
   * nothing to this count and the header said "0 local · ledger verified"
   * about a ledger the reader had just refused (Astra, 2026-09-08, rendering
   * this very component from hand-written damaged JSONL).
   *
   * The worse the damage, the more confident the reassurance. The count was
   * computed in mission-history and carried across IPC the whole time; nothing
   * on this side read it.
   */
  const damaged = withIssues + unreadableLedgers
  // This screen is the whole ledger; the sidebar is only the folder you are
  // in. Both are right and neither said so, so a tester counted 3 in one and
  // 5 in the other and could not tell which to believe (2026-09-07). Said
  // only when the two actually differ -- in one folder there is nothing to
  // reconcile and the extra clause would be noise.
  const elsewhere =
    workspaceId === undefined
      ? 0
      : missions.filter((mission) => mission.workspaceId !== workspaceId).length
  // What the shown missions cost, in whatever units their receipts carry.
  // Runtimes that report nothing contribute nothing, and are counted as such
  // rather than as free. "priced" is a claim about money: when every receipt
  // reported tokens and no price -- which is what a free route gives -- the
  // honest word for the same count is "measured". See `costTotal`.
  const total = costTotal(shown.map((mission) => runCostOf(mission.events)))

  /*
   * A running mission cannot be deleted -- the host refuses, because
   * deleting one would orphan a process still writing into a file that no
   * longer exists and take away the only control that stops it. So they are
   * not selectable here either: offering a checkbox for something that will
   * be refused is an offer the screen knows it cannot keep.
   */
  const deletable = shown.filter((mission) => !runningMissionIds.has(mission.missionId))
  const pickedHere = deletable.filter((mission) => picked.has(mission.missionId))
  const allPicked = deletable.length > 0 && pickedHere.length === deletable.length
  const toggle = (missionId: string): void => {
    setArmed(false)
    setPicked((current) => {
      const next = new Set(current)
      if (next.has(missionId)) next.delete(missionId)
      else next.add(missionId)
      return next
    })
  }
  const clear = (): void => {
    setPicked(new Set())
    setArmed(false)
  }

  return (
    <div className="lc-screen">
      <ScreenHeader
        title="Missions"
        meta={`${missions.length} local${elsewhere === 0 ? '' : `, ${missions.length - elsewhere} in this folder`} · ${
          ledgerUnreadable
            ? 'the ledger could not be read'
            : damaged === 0
              ? 'ledger verified'
              : ledgerDamageWords(withIssues, unreadableLedgers)
        }${total === undefined ? '' : ` · ${total.line} across ${String(total.runs)} ${total.word}`}`}
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
      {/*
        * The selection bar, drawn only once something is selected.
        *
        * Colin, 2026-09-15: "can we add a check and delete, so we can delete
        * missions from here or delete more than once." Deleting one at a
        * time through a right-click menu is fine for one and absurd for
        * seventeen.
        *
        * Two steps, the same shape the row menu already uses: `Delete 6` and
        * then `Delete 6 for good?`. This removes records that cannot be
        * recovered, and a single click between a person and that is not
        * enough -- but a modal for it would be heavier than the act
        * deserves, and the menu settled that question already.
        */}
      {onDeleteMissions !== undefined && picked.size > 0 && (
        <div className="lc-pickbar" role="status">
          <span className="lc-pickbar__count">
            {picked.size} selected
          </span>
          <button type="button" className="lc-pickbar__link" onClick={clear}>
            Clear
          </button>
          <button
            type="button"
            className="lc-pickbar__link"
            onClick={() => {
              setArmed(false)
              setPicked(allPicked ? new Set() : new Set(deletable.map((mission) => mission.missionId)))
            }}
          >
            {allPicked ? 'Select none' : `Select all ${deletable.length}`}
          </button>
          <button
            type="button"
            className={`lc-pickbar__delete${armed ? ' is-armed' : ''}`}
            onClick={() => {
              if (!armed) {
                setArmed(true)
                return
              }
              // Only what is still selectable: a mission that started running
              // between the click and the confirm must not go.
              const going = deletable
                .map((mission) => mission.missionId)
                .filter((missionId) => picked.has(missionId))
              onDeleteMissions(going)
              clear()
            }}
          >
            {armed ? `Delete ${picked.size} for good?` : `Delete ${picked.size}`}
          </button>
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
              /*
                * RUNNING comes from the host, not the ledger.
                *
                * `missionRowPhase` has existed for exactly this since the
                * screen was written, and only the FILTER ever called it --
                * the row read `mission.phase` straight, so a live mission
                * wore INTERRUPTED, which is the correct reading of a file
                * with no terminal receipt and the wrong word for a run that
                * is still going. It never showed, because until the live
                * runs were listed at all there was no row to be wrong
                * (MEASURED 2026-09-11: `INTERRUPTED || using a tool · Read`).
                */
              const view = missionPhaseView(
                missionRowPhase(mission, runningMissionIds),
                mission.integrityIssueCount > 0
              )
              const owner = teammates.find(
                (teammate) => teammate.teammateId === missionOwners[mission.missionId]
              )
              /*
               * ONE clock, `durationText`.
               *
               * This rounded to whole minutes, so a 41-second run read `0m`
               * here while the fold two inches away said `41s` -- the same
               * mission, timed twice, disagreeing. Grok's finding 2,
               * 2026-09-13, and the same shape as every other one in that
               * report: two surfaces computing one fact separately.
               */
              const elapsed = durationText(
                Math.max(0, Date.parse(mission.lastUpdatedAt) - Date.parse(mission.createdAt))
              )
              const secondary = secondaryOf?.(mission.missionId)
              const running = runningMissionIds.has(mission.missionId)
              const isPicked = picked.has(mission.missionId)
              return (
                <div
                  key={mission.missionId}
                  className={`lc-missionrowwrap${isPicked ? ' is-picked' : ''}`}
                >
                  {/*
                    * Beside the row, never inside it. The row is a button and
                    * a checkbox nested in one is neither valid nor reachable
                    * -- the same reason the sidebar's conversation row wraps
                    * its `...` menu rather than nesting it.
                    */}
                  {onDeleteMissions !== undefined && (
                    <input
                      type="checkbox"
                      className="lc-missionrow__pick"
                      checked={isPicked}
                      disabled={running}
                      aria-label={running ? `${titleOf(mission)} is still running` : `Select ${titleOf(mission)}`}
                      title={running ? 'Still running — stop it first' : undefined}
                      onChange={() => toggle(mission.missionId)}
                    />
                  )}
                <button
                  type="button"
                  className="lc-missionrow"
                  onClick={() => onOpen(mission.missionId)}
                >
                  <span className={`lc-rail__dot lc-tone-${view.tone}`} />
                  {/*
                    * Title, and under it the live word.
                    *
                    * `Pending: …` on a mission waiting for you is the whole
                    * point: amber already says a person may need to act, and
                    * this says what for, without opening it.
                    */}
                  <span className="lc-missionrow__name">
                    <span className="lc-missionrow__title">{titleOf(mission)}</span>
                    {secondary !== undefined && <span className="lc-missionrow__doing">{secondary}</span>}
                  </span>
                  <span className="lc-missionrow__owner">{owner?.name ?? '—'}</span>
                  <span className="lc-missionrow__route lc-mono">
                    {/* The route, spelled the way the composer and sidebar
                        spell it. This printed raw ids -- `opencode /
                        muse-spark-1.3-contributor-free` -- so one route read
                        three different ways depending on the screen (Grok's
                        finding 1). Receipts keep raw ids on purpose; a row is
                        not a receipt. */}
                    {shortRuntimeName(mission.runtime)} / {modelDisplayName(mission.runtime, mission.model)}
                  </span>
                  <span className="lc-missionrow__stats lc-mono">
                    {mission.checkpoints.length} checkpoint{mission.checkpoints.length === 1 ? '' : 's'} · {elapsed}
                  </span>
                  <span className="lc-missionrow__cost lc-mono" title="What the runtime reported this run cost">
                    {costLine(runCostOf(mission.events)) ?? COST_NOT_REPORTED_SHORT}
                  </span>
                  <span className={`lc-missionrow__tag lc-mono lc-tone-${view.tone}`}>{view.tag}</span>
                </button>
                </div>
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
  viewByTeammate,
  titleOf,
  onOpenMission,
  onNewTeammate,
  onEdit,
  onRemove,
  onMessage,
  routines,
  routineStepByTeammate,
  onRunRoutine,
  onRecoverRoutine,
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
  readonly viewByTeammate: Readonly<Record<string, TeammateStatusView>>
  readonly onNewTeammate: () => void
  readonly onEdit: (teammate: PublicTeammate) => void
  readonly onRemove: (teammateId: string) => void
  /** Their conversation, as a face in the rail opens it. */
  readonly onMessage: (teammateId: string) => void
  /** Every routine on file. Each is filed under the teammate that runs it. */
  readonly routines: readonly PublicRoutine[]
  /** Which routine each teammate is replaying right now, if any. */
  readonly routineStepByTeammate: Readonly<Record<string, { readonly name: string; readonly step: number; readonly of: number }>>
  readonly onRunRoutine: (routineId: string) => void
  readonly onRecoverRoutine?: RecoverRoutine
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
                  <TeammateBot
                    hue={teammate.hue}
                    avatar={teammate.avatar}
                    size={36}
                    activity={viewByTeammate[teammate.teammateId]?.activity ?? 'idle'}
                    // The roster had no dot because it had no status. It has
                    // both now, from the same call the sidebar reads.
                    presence={facePresenceFor(viewByTeammate[teammate.teammateId]?.status ?? 'idle')}
                    teammateId={teammate.teammateId}
                  />
                  <div className="lc-rostercard__id">
                    <div className="lc-rostercard__name">{teammate.name}</div>
                    <div className="lc-rostercard__role">{roleLabelOf(teammate)}</div>
                  </div>
                  {/*
                    * ICONS, as the Routines row draws the same two actions.
                    *
                    * "Edit" and "Remove" as words took the width beside the
                    * name, so a role like "Code & Migrations" wrapped to two
                    * lines and cards in one row stood at different heights,
                    * their stat boxes out of line (design pass and beta review
                    * of 0.255.0, #4). Both carry a title and an accessible name.
                    */}
                  <div className="lc-rostercard__actions">
                    {/*
                      * The rail draws four faces once the team is six or more,
                      * and its +N opens this screen -- which had no way to
                      * talk to anyone on it. A fifth teammate could be edited
                      * and removed, never messaged (found fixing the drives'
                      * one way to open a teammate, 2026-09-23).
                      */}
                    <button
                      type="button"
                      className="lc-ghostbutton lc-iconbutton lc-rostercard__message"
                      title="Message teammate"
                      aria-label={`Message ${teammate.name}`}
                      onClick={() => onMessage(teammate.teammateId)}
                    >
                      <Icon name="message" size={14} />
                    </button>
                    <button
                      type="button"
                      className="lc-ghostbutton lc-iconbutton lc-rostercard__edit"
                      title="Edit teammate"
                      aria-label={`Edit ${teammate.name}`}
                      onClick={() => onEdit(teammate)}
                    >
                      <Icon name="pencil" size={14} />
                    </button>
                    <button
                      type="button"
                      className="lc-ghostbutton lc-iconbutton lc-rostercard__remove"
                      title="Remove teammate"
                      aria-label={`Remove ${teammate.name}`}
                      onClick={() => onRemove(teammate.teammateId)}
                    >
                      <Icon name="close" size={14} />
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
                        {shortRuntimeName(teammate.route.runtime)} / {routeModelName(teammate.route.runtime, teammate.route.model)}
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
                {/* Only once there has been a run to report on: before the first,
                    "not reported by the runtime" blamed a runtime nobody had
                    used yet (design pass, 2026-09-22). */}
                {work.lastRunAt !== undefined && (
                  <dl className="lc-rostercard__cost">
                    {/* `Usage` when the receipts carry tokens and no price: a
                        free route's numbers are a measurement, not a charge. */}
                    <dt>{costLabel(work.cost)}</dt>
                    <dd className={`lc-mono${work.cost === undefined ? ' is-unreported' : ''}`}>
                      {costLineOrWhyNot(work.cost)}
                    </dd>
                  </dl>
                )}
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
                        <span className={`lc-dot lc-tone-${missionPhaseView(entry.phase, entry.hasIntegrityIssues).tone}`} />
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
                          <RoutineRecovery key={`${routine.execution?.attemptId}:${routine.execution?.step}`} routine={routine} onOpenMission={onOpenMission}
                            {...(onRecoverRoutine === undefined ? {} : { recover: onRecoverRoutine })} />
                          {routineScheduleSummary(routine, new Date()) !== undefined && (
                            <span className="lc-routinerow__meta lc-mono lc-routinerow__sched">
                              {routineScheduleSummary(routine, new Date())}
                            </span>
                          )}
                        </span>
                        <button
                          type="button"
                          className="lc-ghostbutton"
                          disabled={replaying !== undefined || (routine.execution !== undefined && routine.execution.status !== 'abandoned')}
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
 * What has been deleted and is still here.
 *
 * Deleting takes a conversation out of every listing at once, which is what a
 * person means by it. The record itself is kept until this panel is emptied,
 * so the one thing the app could not do on 2026-09-17 -- give an accidentally
 * deleted day of work back -- it can now do.
 *
 * Restoring is one press, because the case it exists for is a mistake that has
 * already happened. Emptying is two, differently worded, because that is the
 * press that cannot be taken back.
 */
function TrashControl({
  onList,
  onRestore,
  onEmpty
}: {
  readonly onList: () => Promise<TrashListResponse>
  readonly onRestore: (missionId: string) => Promise<TrashMutationResponse>
  readonly onEmpty: () => Promise<TrashMutationResponse>
}): ReactElement {
  const [held, setHeld] = useState<readonly PublicTrashedMission[] | undefined>(undefined)
  const [armed, setArmed] = useState(false)
  const [message, setMessage] = useState<string | undefined>(undefined)

  const load = (): void => {
    void onList()
      .then((response) => {
        setHeld(response.ok ? response.data.missions : [])
        if (!response.ok) setMessage(response.error.message)
      })
      .catch(() => setHeld([]))
  }
  useEffect(load, [])

  const restore = (missionId: string): void => {
    setMessage(undefined)
    void onRestore(missionId)
      .then((response) => {
        setMessage(response.ok ? 'Put back.' : response.error.message)
        load()
      })
      .catch(() => setMessage('That conversation could not be put back.'))
  }

  const empty = (): void => {
    if (!armed) {
      setArmed(true)
      return
    }
    setArmed(false)
    setMessage(undefined)
    void onEmpty()
      .then((response) => {
        setMessage(response.ok ? `Deleted ${String(response.data.count)} for good.` : response.error.message)
        load()
      })
      .catch(() => setMessage('The trash was not emptied.'))
  }

  const count = held?.length ?? 0
  const NEWLINE = String.fromCharCode(10)
  return (
    <div className="lc-trash">
      <p className="lc-settings__note">
        {held === undefined
          ? 'Reading the trash…'
          : count === 0
            ? 'Nothing deleted. A conversation you delete waits here until you empty it.'
            : `${String(count)} deleted conversation${count === 1 ? '' : 's'}, kept until you empty this.`}
      </p>
      {held !== undefined && count > 0 && (
        <>
          <ul className="lc-trash__list">
            {held.map((mission) => (
              <li className="lc-trash__row" key={mission.missionId}>
                <span className="lc-trash__what">
                  {mission.prompt === undefined || mission.prompt.trim().length === 0
                    ? mission.missionId
                    : mission.prompt.split(NEWLINE)[0]}
                </span>
                <span className="lc-trash__when lc-mono">{mission.deletedAt.slice(0, 16).replace('T', ' ')}</span>
                <button type="button" className="lc-button" onClick={() => restore(mission.missionId)}>
                  Put back
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="lc-button lc-button--danger" onClick={empty}>
            {armed ? `Delete ${String(count)} for good?` : 'Empty the trash'}
          </button>
        </>
      )}
      {message !== undefined && <p className="lc-settings__note">{message}</p>}
    </div>
  )
}

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

/**
 * The one line a person has to run, with a button that copies it.
 *
 * Shown only for a runtime Locust cannot find. Locust does not run this for
 * them: installing software on someone's machine on their behalf is a
 * different promise from running the agents they already chose, and the app
 * has no business making it without being asked. Copying is one click; the
 * terminal is theirs.
 */
function InstallCommand({ command }: { readonly command: string }): ReactElement {
  const [copied, setCopied] = useState(false)
  const copy = (): void => {
    const done = (): void => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1_600)
    }
    // `navigator.clipboard` is the right call and is not always available to a
    // packaged page; the textarea is what works everywhere else.
    navigator.clipboard?.writeText(command).then(done).catch(() => {
      const field = document.createElement('textarea')
      field.value = command
      document.body.appendChild(field)
      field.select()
      try {
        document.execCommand('copy')
        done()
      } finally {
        field.remove()
      }
    })
  }
  return (
    <div className="lc-installline">
      <code className="lc-installline__command lc-mono">{command}</code>
      <button type="button" className="lc-installline__copy" onClick={copy}>
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
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

/**
 * The way a person says "this broke".
 *
 * Until 0.138.0 there was none. An uncaught exception raised a dialog that
 * named `locust-errors.log`, which meant the only people who knew the file
 * existed were the ones who had already hit a crash the main process could
 * throw -- and a renderer crash, the one a person would describe as "Locust
 * disappeared", raised no dialog and wrote no line at all.
 *
 * So this exists to be found BEFORE it is needed. It says where the file is,
 * how big it is, and what is in it, because a person deciding whether to
 * send a log to someone is entitled to know what they are sending.
 *
 * Reveals, never opens -- `main/reveal-file.ts` sets that rule out at
 * length. And it takes no path: the host knows the only answer, so there is
 * nothing for the renderer to propose.
 */
function ProblemReport(): ReactElement {
  const [report, setReport] = useState<DiagnosticsReport>()
  useEffect(() => {
    const bridge = window.desktop
    if (bridge === undefined) return
    void bridge.diagnosticsReport().then(setReport).catch(() => undefined)
  }, [])
  return (
    <>
      <dl className="lc-receipt lc-receipt--flush">
        <dt>Log</dt>
        <dd className="lc-mono">{report?.path ?? 'in this profile'}</dd>
        <dt>On disk</dt>
        <dd className="lc-mono">
          {report === undefined ? 'measuring…' : report.exists ? formatBytes(report.byteTotal) : 'nothing yet'}
        </dd>
      </dl>
      <More>
        <p>
          The log records what happened, never what was said. Crashes, a window that stopped answering,
          and the version you were on — no messages, no file contents, and nothing from a mission. That is
          what makes it safe to send.
        </p>
        <p>It is capped, and rolls over once. Nothing in it leaves this machine unless you send it.</p>
      </More>
      <button
        type="button"
        className="lc-button"
        onClick={() => {
          void window.desktop?.revealDiagnostics()
        }}
      >
        Show the log
      </button>
    </>
  )
}

export function SettingsScreen({
  runtimes,
  limitedRuntimes,
  usageWindows,
  runtimeSetup,
  cliArtifacts,
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
  interrupt,
  onInterruptChange,
  autoMode,
  askConnectors,
  keepATodoList,
  onKeepATodoListChange,
  onAskConnectorsChange,
  swarm,
  tube,
  replySize,
  metal,
  metalStrength,
  metalMotion,
  metalBend,
  onMetalChange,
  onReplySizeChange,
  onTubeChange,
  onSwarmChange,
  onAutoModeChange,
  relayHopCap,
  onRelayHopCapChange,
  memoryMode,
  layout,
  layoutMode,
  onLayoutChange,
  onMemoryModeChange,
  memoryCount,
  memoryWaiting,
  onOpenMemory,
  onPreviewPrune,
  onListTrash,
  onRestoreMission,
  onEmptyTrash,
  changelog,
  initialPage,
  onPrune
}: {
  readonly runtimes: readonly PublicRuntimeStatus[]
  /** Runtimes whose last run ended on the account's usage limit, with its own words. */
  readonly limitedRuntimes: ReadonlyMap<string, string>
  /** The latest still-allowed rate-limit reading per runtime, in words. */
  readonly usageWindows?: ReadonlyMap<string, string>
  /** Each runtime's own MCP servers and hooks, by runtime id; undefined until read. */
  readonly runtimeSetup: Readonly<Record<string, PublicRuntimeSetup>> | undefined
  /**
   * What the person configured inside the CLIs themselves, shown under the
   * runtime each belongs to. Locust neither made nor runs these.
   */
  readonly cliArtifacts?: readonly PublicRuntimeArtifact[]
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
  /** Whether a teammate may stop another's run to be heard now. */
  readonly interrupt: boolean
  readonly onInterruptChange: (interrupt: boolean) => void
  /** Whether the Auto permission mode may be chosen at all. */
  readonly autoMode: boolean
  /** Workspace-wide: every mission at its model's maximum effort. */
  readonly swarm: boolean
  readonly onSwarmChange: (swarm: boolean) => void
  readonly tube: TubePreference
  readonly onTubeChange: (tube: TubePreference) => void
  /** How big a reply is set. The person's, not the app's -- see ReplyTextSize. */
  readonly replySize: ReplyTextSize
  /** The send button's metal; every option the design pass offered. */
  readonly metal: MetalPreset
  readonly metalStrength: MetalStrength
  readonly metalMotion: MetalMotion
  readonly metalBend: boolean
  readonly onMetalChange: (next: {
    readonly metal?: MetalPreset
    readonly metalStrength?: MetalStrength
    readonly metalMotion?: MetalMotion
    readonly metalBend?: boolean
  }) => void
  readonly onReplySizeChange: (size: ReplyTextSize) => void
  readonly onAutoModeChange: (autoMode: boolean) => void
  readonly askConnectors: boolean
  readonly onAskConnectorsChange: (askConnectors: boolean) => void
  readonly keepATodoList: boolean
  readonly onKeepATodoListChange: (keepATodoList: boolean) => void
  /** The autonomy budget: automatic replies one exchange may use before it waits for a person. */
  readonly relayHopCap: number
  readonly onRelayHopCapChange: (cap: number) => void
  /** What happens to a memory a teammate writes. */
  readonly memoryMode: MemoryMode
  /** What the person chose; `auto` follows the window width. */
  readonly layout: LayoutPreference
  /** What that actually resolves to right now, so `auto` can say which. */
  readonly layoutMode: 'compact' | 'wide'
  readonly onLayoutChange: (layout: LayoutPreference) => void
  readonly onMemoryModeChange: (mode: MemoryMode) => void
  readonly memoryCount: number
  /** Memories a teammate proposed that wait for a keep or a forget. */
  readonly memoryWaiting: number
  readonly onOpenMemory: () => void
  readonly onPreviewPrune: (days: number) => Promise<MissionPruneResponse>
  readonly onListTrash: () => Promise<TrashListResponse>
  readonly onRestoreMission: (missionId: string) => Promise<TrashMutationResponse>
  readonly onEmptyTrash: () => Promise<TrashMutationResponse>
  /** What changed in the running build; undefined until the host has answered. */
  readonly changelog: AppChangelog | undefined
  /** The page Settings opens on: What's new, from the splash's "See every version". */
  readonly initialPage?: SettingsPageId
  readonly onPrune: (days: number) => Promise<MissionPruneResponse>
}): ReactElement {
  const [page, setPage] = useState<SettingsPageId>(initialPage ?? 'workspace')
  const [query, setQuery] = useState('')
  const asked = query.trim()
  // A page earns its place in the list when its name or one of its settings
  // matches. With no search every page is there, which is the ordinary state.
  const shownPages =
    asked.length === 0
      ? SETTINGS_PAGES
      : SETTINGS_PAGES.filter((entry) => pageMatches(entry, asked))
  // A search that hides the page you were on moves you to the first that
  // survived, rather than showing an empty pane beside a list of matches.
  const shownPage = shownPages.some((entry) => entry.id === page) ? page : shownPages[0]?.id
  /*
   * AND THE PANE OPENS AT WHAT WAS SEARCHED FOR, not at the top of the page.
   *
   * Grok, pass 9: typing "trash" switched to This app and left the pane on
   * Updates, with Trash further down the same page. "I think switching the
   * page is right. I think not scrolling to the heading is the miss." Five
   * pages are short enough to survive that; the words a person types that
   * are NOT headings are not -- someone who types "memory" and lands at the
   * top of How teammates work has no way to tell which of four sections
   * answered them.
   */
  const pane = useRef<HTMLDivElement>(null)
  const landOn = shownPage === undefined || asked.length === 0
    ? undefined
    : matchedHeadings(SETTINGS_PAGES.find((entry) => entry.id === shownPage)!, asked)[0]
  useEffect(() => {
    if (landOn === undefined) return
    const headings = pane.current?.querySelectorAll('.lc-settings__heading') ?? []
    for (const heading of headings) {
      if (heading.textContent?.trim() !== landOn) continue
      // The section, so the heading does not land flush against the top
      // edge with its own words half under the search box.
      ;(heading.closest('.lc-settings__section') ?? heading).scrollIntoView({ block: 'start' })
      return
    }
    // Nothing to scroll to is the ordinary case for a page-name match, and
    // the top of the page is already the right place for it.
  }, [landOn, shownPage])

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
      <div className="lc-settings">
        <nav className="lc-settings__nav" aria-label="Settings sections">
          <input
            type="search"
            className="lc-settings__search"
            placeholder="Search settings"
            value={query}
            aria-label="Search settings"
            onChange={(event) => setQuery(event.target.value)}
          />
          {shownPages.length === 0 ? (
            <p className="lc-settings__note">Nothing matches. The pages are still here; clear the search to see them.</p>
          ) : (
            shownPages.map((entry) => (
              <button
                type="button"
                key={entry.id}
                className={`lc-settings__navitem${entry.id === shownPage ? ' is-current' : ''}`}
                aria-current={entry.id === shownPage ? 'page' : undefined}
                onClick={() => setPage(entry.id)}
              >
                <span className="lc-settings__navlabel">{entry.label}</span>
                {query.trim().length > 0 && (
                  <span className="lc-settings__navhits">
                    {/*
                      * The heading, not the word typed. Someone who types
                      * "memory" is told "What your team remembers", which is
                      * what they will be reading for once the page opens --
                      * echoing their own word back would say nothing.
                      */}
                    {matchedHeadings(entry, asked).join(' · ')}
                  </span>
                )}
              </button>
            ))
          )}
        </nav>
        <div className="lc-settings__pane" ref={pane}>
        {/*
          * Where the teammates work. A workspace-wide fact, so it sits with
          * the other workspace-wide settings rather than on the intro screen
          * (Colin, 2026-09-05). The composer carries a chip for the same
          * thing, the way Claude Code states its own folder on the bar.
          */}
        {/*
          * GROUPED BY WHAT A SETTING IS ABOUT, and ordered by how often it
          * is touched.
          *
          * Colin, 2026-09-14: "our settings page is a disaster, just copy
          * how claude code does and organize theirs". It was thirteen
          * subjects in one unbroken scroll, in the order they happened to be
          * built: Updates third, the two appearance settings at opposite
          * ends, and one section stacking the boot screen, Swarm and Auto
          * mode together because they were added on the same day.
          *
          * Five areas now, each named for what is in it. The prose stays
          * where it was -- behind `More` -- because the problem was never
          * that a setting explained itself, it was that you could not find
          * the setting.
          */}
        {shownPage === 'workspace' && (
          <>
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
            <button
              type="button"
              className="lc-button"
              onClick={onChooseFolder}
              title={workspacePath === undefined ? 'Choose the folder your teammates work in' : 'Choose another folder. Locust reopens in it.'}
            >
              {workspacePath === undefined ? 'Choose folder' : 'Change'}
            </button>
          </div>
          {/*
            * Said in front of the button, not behind a fold.
            *
            * Every service binds its folder at start-up, so changing it
            * reopens the app -- which is the honest switch and looks exactly
            * like a crash if nobody was told. Colin has reported it twice as
            * one: "changing worktree folder still crashes/resets the app."
            * The sentence existed; it was inside `More`, which is closed.
            */}
          {workspacePath !== undefined && (
            <p className="lc-settings__note lc-folder__warns">
              Locust reopens in the folder you choose. Stop anything running first.
            </p>
          )}
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
          <h2 className="lc-settings__heading">Teammates</h2>
          <p className="lc-settings__lede">
            {/*
              * Says what is TRUE NOW. It stated the relay-on behaviour whatever
              * the switch said, so with relay off the lede promised automatic
              * replies while the row under it said messages wait (design
              * pass, 2026-09-22).
              */}
            {relay
              ? `Teammates answer each other on their own, each on its own route, and stop after ${String(relayHopCap)} automatic ${relayHopCap === 1 ? 'reply' : 'replies'}.`
              : 'Teammates do not answer each other on their own. A message waits until its recipient next runs.'}
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
            <p>
              A teammate does one thing at a time, so a message that arrives while they are working waits
              until that run ends. A sender can mark a message urgent when waiting would make it useless --
              &ldquo;stop, I am editing that file&rdquo; is the case it exists for. Letting that stop the
              recipient part-way throws away whatever they had in flight, so it is off until you turn it on;
              their unfinished work stays in their own conversation either way.
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
              * Waiting their turn, or not.
              *
              * A teammate runs one mission at a time, so a message that
              * arrives mid-run waits for that run to end. Usually right, and
              * sometimes far too late: the message worth interrupting for is
              * "stop, I am editing that file", and delivering it once the
              * conflicting work is finished delivers it after the damage.
              *
              * Off by default and described as what it costs, because it
              * DISCARDS: the recipient's turn stops where it stands. Only a
              * sender that asked -- `when="now"` on its message -- can spend
              * it, and the message still goes through the ordinary waiting
              * path afterwards, so nothing here widens how far teammates may
              * go on their own.
              */}
            <div className="lc-settingrow">
              <span className="lc-settings__note">
                {interrupt
                  ? 'An urgent message stops the recipient part-way. Their unfinished work stays in their own conversation.'
                  : 'An urgent message still waits for the recipient to finish.'}
              </span>
              <button
                type="button"
                className={`lc-switch${interrupt ? ' is-on' : ''}`}
                role="switch"
                aria-checked={interrupt}
                aria-label={interrupt ? 'Switch this off' : 'Switch this on'}
                disabled={!relay}
                onClick={() => onInterruptChange(!interrupt)}
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
              <div className="lc-segmented is-numeric" role="radiogroup" aria-label="Automatic replies per exchange">
                {[2, 4, 8, 12, 16, 24].map((cap) => (
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

          </>
        )}
        {shownPage === 'runtimes' && (
          <>
        <section className="lc-settings__section">
          <h2 className="lc-settings__heading">Runtimes &amp; accounts</h2>
          <p className="lc-settings__lede">
            Each runtime uses the account already signed in on this machine. Locust adds nothing of its own.
          </p>
          {/*
            Only when NOTHING is installed, which is what someone who has just
            installed Locust and nothing else is looking at. The list is
            ordered for people who already have these; a fresh machine reads
            "Codex CLI" first and is told it needs a ChatGPT account, which
            makes the app look like it costs money to open. One of them needs
            no account at all, and that is the sentence that belongs here.
          */}
          {runtimes.length > 0 && !runtimes.some((runtime) => runtime.installed) && (
            <p className="lc-settings__lede lc-settings__lede--start">
              None of these are on this machine yet. The quickest start is <b>OpenCode</b>: one command, no
              account, and its free model runs as soon as it is installed. The others below are worth adding
              when you want a stronger model, and each needs its own sign-in.
            </p>
          )}
          <More>
            <p>
              Locust never pools subscriptions or proxies your requests. Under each runtime is what it has
              set up for itself -- MCP servers and hooks, read from its own files -- so a tool a teammate
              reaches for, or a script that runs mid-mission, is never a surprise. Locust changes nothing there.
            </p>
          </More>
          <div className="lc-runtimelist lc-settingcard">
            {/*
              * On a machine with nothing installed the lede says the quickest
              * start is OpenCode and the list under it opened with Codex,
              * Claude, Cursor, Copilot -- OpenCode fifth (QA, 2026-09-06). The
              * sentence and the list disagreed about where to look. Once
              * anything IS installed the existing order stands: connected
              * first, which is what a person with a working setup wants.
              */}
            {(runtimes.some((runtime) => runtime.installed)
              ? // What you can use, first. Frame pass, 2026-09-15: two
                // runtimes that do not exist yet sat in the middle of six
                // that do, so the list had to be read tag by tag.
                runtimeListOrder(runtimes, (runtime) =>
                  routeRowStatus(runtime, integrationOf(runtime.id), false, limitedRuntimes.get(runtime.id)).tag
                )
              : [...runtimes].sort((left, right) =>
                  left.id === FREE_START_RUNTIME ? -1 : right.id === FREE_START_RUNTIME ? 1 : 0
                )
            ).map((runtime) => {
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
                    {status.tag === 'NOT INSTALLED' && installCommand(runtime.id) !== undefined && (
                      <InstallCommand command={installCommand(runtime.id)!} />
                    )}
                    {runtimeSetup?.[runtime.id] !== undefined && <RuntimeSetupLine setup={runtimeSetup[runtime.id]!} />}
                    {/*
                      * What the person set up inside THIS CLI. It used to sit
                      * on the Automations screen under a heading that
                      * otherwise meant "things you can run", which is what
                      * made its inertness read as brokenness. An agent file
                      * in Codex's config directory is a fact about Codex, and
                      * under Codex it needs no apology.
                      */}
                    <CliArtifacts artifacts={(cliArtifacts ?? []).filter((entry) => entry.runtime === runtime.id)} />
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
                  {/*
                    * A red tag that does not say what to do is half a message.
                    * The first-run panel has printed this command since it was
                    * built; Settings -- the screen a person opens when a
                    * runtime is wrong -- drew the same red tag and stopped
                    * there (Grok's audit, 2026-09-13).
                    */}
                  {status.tag === 'SIGN IN' && <SignInButton runtime={runtime.id} />}
                </div>
              )
            })}
          </div>
        </section>
        <section className="lc-settings__section">
          <h2 className="lc-settings__heading">Connectors</h2>
          <p className="lc-settings__lede">
            {askConnectors
              ? 'Asking. A Claude Code teammate stops and asks before every connector call.'
              : 'Not asking. A teammate may use any connector your Claude Code can reach, without asking.'}
          </p>
          <More>
            <p>
              A connector is not on this machine: it acts on the service it reaches, so no permission mode
              governs it. By default a teammate may use whichever connectors your own Claude Code has, the
              way you can -- the question was answered when you connected them.
            </p>
            <p>
              Switch this on and every connector call stops the run and asks you first, with the exact
              input it would send. Approve once, allow that connector for the rest of the mission, or deny
              with a reason the teammate reads. It is checked when a run starts, so the next mission
              follows the switch without a restart. Auto never asks either way.
            </p>
          </More>
          <div className="lc-settingrows">
            <div className="lc-settingrow">
              <span className="lc-settings__note">
                {askConnectors
                  ? 'On. Every connector call raises an approval card first.'
                  : 'Off. Connectors you have are used without asking.'}
              </span>
              <button
                type="button"
                className={`lc-switch${askConnectors ? ' is-on' : ''}`}
                role="switch"
                aria-checked={askConnectors}
                aria-label={askConnectors ? 'Stop asking before connector calls' : 'Ask before every connector call'}
                onClick={() => onAskConnectorsChange(!askConnectors)}
              >
                <span className="lc-switch__knob" />
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

          </>
        )}
        {shownPage === 'teammates' && (
          <>
        <section className="lc-settings__section">
          <h2 className="lc-settings__heading">Swarm</h2>
          <p className="lc-settings__lede">
            {swarm
              ? 'On. Every mission runs at its model\u2019s maximum effort.'
              : 'Off. Each mission runs at the effort its route is set to.'}
          </p>
          <More>
            <p>
              Swarm is a statement about every mission rather than about one of them: while it is on, each
              run is given the highest effort the model it lands on reports, and the effort control says who
              is holding it. A model that reports no levels is unaffected -- there is nothing to raise.
            </p>
            <p>
              The mark on the composer is the same switch seen from the other side. It is the glance; this
              is the record, and the way to take it back from a screen that has no composer on it -- which
              is every screen but the workroom, and the workroom itself while a mission is running.
            </p>
          </More>
          <div className="lc-settingrows">
            <div className="lc-settingrow">
              <span className="lc-settings__note">
                {swarm
                  ? 'On. Every mission runs at its model\u2019s maximum.'
                  : 'Off. The mark on the composer switches it back on.'}
              </span>
              <button
                type="button"
                className={`lc-switch${swarm ? ' is-on' : ''}`}
                role="switch"
                aria-checked={swarm}
                aria-label={swarm ? 'Switch this off' : 'Switch this on'}
                onClick={() => onSwarmChange(!swarm)}
              >
                <span className="lc-switch__knob" />
              </button>
            </div>
          </div>

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
          <h2 className="lc-settings__heading">Plans</h2>
          <p className="lc-settings__lede">
            {keepATodoList
              ? 'Asking for a plan. Teammates that can keep a todo list are asked to, and the board fills in as they work.'
              : 'Not asking. A teammate keeps a list only if it decides to on its own.'}
          </p>
          <More>
            <p>
              Codex, Cursor and OpenCode each have a tool for keeping a todo list, and the board in a room
              draws whatever they put in it. This asks them to use it: add the steps once they are known,
              mark one in progress, mark it done when it is done.
            </p>
            <p>
              It is off by default because it is not free -- the bookkeeping costs tokens and changes how a
              teammate narrates itself. It is worth switching on when you are watching the board rather
              than reading every line.
            </p>
            <p>
              Claude Code is never asked. It has no such tool, so the request would be an instruction it
              cannot follow and the board would stay empty with no explanation. This switch does nothing
              for a Claude Code teammate, in either position.
            </p>
          </More>
          <div className="lc-settingrows">
            <div className="lc-settingrow">
              <span className="lc-settings__note">
                {keepATodoList
                  ? 'On. Codex, Cursor and OpenCode teammates are asked to keep the board current.'
                  : 'Off. Nothing is asked for; a teammate may still keep one.'}
              </span>
              <button
                type="button"
                className={`lc-switch${keepATodoList ? ' is-on' : ''}`}
                role="switch"
                aria-checked={keepATodoList}
                aria-label={keepATodoList ? 'Stop asking teammates to keep a todo list' : 'Ask teammates to keep a todo list'}
                onClick={() => onKeepATodoListChange(!keepATodoList)}
              >
                <span className="lc-switch__knob" />
              </button>
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

          </>
        )}
        {shownPage === 'appearance' && (
          <>
        <section className="lc-settings__section">
          <h2 className="lc-settings__heading">Sidebar</h2>
          <div className="lc-settingrows">
          {/*
            * The shell layout. It was decided by window width alone, so the
            * only way to get the compact rail was to shrink the window and the
            * only way out of it was to grow one (Colin, 2026-09-07: "can we
            * have it be an optional toggle as well?"). Auto still follows the
            * width, and it is what everyone gets until they choose.
            */}
          <div className="lc-settingrow">
            <span className="lc-settings__note">
              Sidebar layout{layout === 'auto' ? ` — following this window, currently ${layoutMode}` : ''}
            </span>
            <div className="lc-segmented" role="radiogroup" aria-label="Sidebar layout">
              {(
                [
                  ['auto', 'Auto'],
                  ['wide', 'Full'],
                  ['compact', 'Rail']
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={layout === value}
                  className={`lc-button${layout === value ? ' is-active' : ''}`}
                  onClick={() => onLayoutChange(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          </div>
        </section>
        <section className="lc-settings__section">
          <h2 className="lc-settings__heading">The send button</h2>
          <p className="lc-settings__lede">
            {metal === 'off'
              ? 'Off. A plain button, and no shader running in the composer.'
              : metalMotion === 'always'
                ? `Always on. ${metal === 'chromatic' ? 'Chromatic' : metal === 'silver' ? 'Silver' : 'Gold'}, moving whether or not you are there.`
                : `On hover. ${metal === 'chromatic' ? 'Chromatic' : metal === 'silver' ? 'Silver' : 'Gold'}, still until you point at it.`}
          </p>
          <More>
            <p>
              Every option here is one the design pass put forward, on screen rather than buried in the
              source, because a look is settled by seeing it rather than by describing it.
            </p>
            <p>
              Its recommendation was silver at Standard, on hover only -- the argument being that in this
              app a thing that moves means work is happening, so a button that shimmers all the time says
              "running" on a screen where nothing is. Always on is here so you can disagree with that
              after looking at it.
            </p>
            <p>
              Off is not only a matter of taste: the effect is WebGL, and a plain button costs nothing and
              cannot fail to appear.
            </p>
          </More>
          <div className="lc-settingrows">
            <div className="lc-settingrow">
              <span className="lc-settings__note">Which metal.</span>
              <div className="lc-segmented" role="radiogroup" aria-label="Which metal">
                {(
                  [
                    ['off', 'Off'],
                    ['chromatic', 'Chromatic'],
                    ['silver', 'Silver'],
                    ['gold', 'Gold']
                  ] as const
                ).map(([option, label]) => (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={metal === option}
                    className={`lc-button${metal === option ? ' is-active' : ''}`}
                    onClick={() => onMetalChange({ metal: option })}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="lc-settingrow">
              <span className="lc-settings__note">How strong.</span>
              <div className="lc-segmented" role="radiogroup" aria-label="How strong the metal is">
                {(
                  [
                    ['subtle', 'Subtle'],
                    ['standard', 'Standard'],
                    ['strong', 'Strong']
                  ] as const
                ).map(([option, label]) => (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={metalStrength === option}
                    disabled={metal === 'off'}
                    className={`lc-button${metalStrength === option ? ' is-active' : ''}`}
                    onClick={() => onMetalChange({ metalStrength: option })}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="lc-settingrow">
              <span className="lc-settings__note">When it moves.</span>
              <div className="lc-segmented" role="radiogroup" aria-label="When the metal moves">
                {(
                  [
                    ['hover', 'On hover'],
                    ['always', 'Always on']
                  ] as const
                ).map(([option, label]) => (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={metalMotion === option}
                    disabled={metal === 'off'}
                    className={`lc-button${metalMotion === option ? ' is-active' : ''}`}
                    onClick={() => onMetalChange({ metalMotion: option })}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="lc-settingrow">
              <span className="lc-settings__note">
                The cursor bend -- a liquid dent that rides the ring as you move across it.
              </span>
              <div className="lc-segmented" role="radiogroup" aria-label="The cursor bend">
                {(
                  [
                    [true, 'On'],
                    [false, 'Off']
                  ] as const
                ).map(([option, label]) => (
                  <button
                    key={String(option)}
                    type="button"
                    role="radio"
                    aria-checked={metalBend === option}
                    disabled={metal === 'off'}
                    className={`lc-button${metalBend === option ? ' is-active' : ''}`}
                    onClick={() => onMetalChange({ metalBend: option })}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>
        <section className="lc-settings__section">
          <h2 className="lc-settings__heading">Reply text size</h2>
          <p className="lc-settings__lede">
            {replySize === 'largest'
              ? 'Largest. For reading at a distance, or a long reply you want to sit with.'
              : replySize === 'large'
                ? 'Large. A step up without turning the thread into a slide.'
                : 'Standard. The size a reply has always been set at.'}
          </p>
          <More>
            <p>
              A teammate's reply is the one thing on this screen you read rather than scan, so it is set
              in a serif and sized on its own -- the app's own chrome stays where it is whatever you pick
              here.
            </p>
            <p>
              The line length follows the size rather than staying put, so a bigger reply gets a wider
              paragraph and about the same number of words to a line. Measured, not assumed: roughly 74
              characters at Standard and 72 at Large.
            </p>
          </More>
          <div className="lc-settingrows">
            <div className="lc-settingrow">
              <span className="lc-settings__note">How big to set it.</span>
              <div className="lc-segmented" role="radiogroup" aria-label="How big to set a reply">
                {(
                  [
                    ['standard', 'Standard'],
                    ['large', 'Large'],
                    ['largest', 'Largest']
                  ] as const
                ).map(([option, label]) => (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={replySize === option}
                    className={`lc-button${replySize === option ? ' is-active' : ''}`}
                    onClick={() => onReplySizeChange(option)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>
        <section className="lc-settings__section">
          <h2 className="lc-settings__heading">The boot screen</h2>
          <p className="lc-settings__lede">
            {tube === 'off'
              ? 'Off. Locust goes straight to the workspace while it finds your runtimes.'
              : tube === 'subtle'
                ? 'Subtle. The screen without the flicker or the glare.'
                : 'Full. The whole monitor while your runtimes are found.'}
          </p>
          <More>
            <p>
              Finding the runtimes on this machine takes as long as it takes -- each one is a real command
              and some of them are slow to answer. The screen shows that happening rather than a spinner
              standing in for it, and every line on it is something the app actually read.
            </p>
            <p>
              It only ever covers the empty middle of the window. The sidebar, the folder and the message
              box stay where they are, so you can pick a teammate or start typing without waiting for it,
              and clicking anywhere on it puts it away.
            </p>
          </More>
          <div className="lc-settingrows">
            <div className="lc-settingrow">
              <span className="lc-settings__note">How much of it to draw.</span>
              {/* `lc-button is-active` is what every other segmented choice
                * in this app already uses -- inventing a class for this one
                * would be a second spelling of a solved thing. */}
              <div className="lc-segmented" role="radiogroup" aria-label="How much of the boot screen to draw">
                {(
                  [
                    ['full', 'Full'],
                    ['subtle', 'Subtle'],
                    ['off', 'Off']
                  ] as const
                ).map(([option, label]) => (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={tube === option}
                    className={`lc-button${tube === option ? ' is-active' : ''}`}
                    onClick={() => onTubeChange(option)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

        </section>

          </>
        )}
        {shownPage === 'app' && (
          <>
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
          <p className="lc-settings__note">
            This is {changelog?.version ?? 'this version'}. Every version, and what it changed, is in{' '}
            <button type="button" className="lc-linkbutton" onClick={() => setPage('whatsnew')}>
              What’s new
            </button>
            .
          </p>
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
        <section className="lc-settings__section">
          <h2 className="lc-settings__heading">Trash</h2>
          <p className="lc-settings__lede">
            Deleting a conversation takes it out of every list at once. The record itself waits here, so a
            deletion you did not mean can be undone.
          </p>
          <TrashControl onList={onListTrash} onRestore={onRestoreMission} onEmpty={onEmptyTrash} />
        </section>
        <section className="lc-settings__section">
          <h2 className="lc-settings__heading">Report a problem</h2>
          <p className="lc-settings__lede">
            If Locust crashes or behaves oddly, this is the file to send.
          </p>
          <ProblemReport />
        </section>

          </>
        )}
        {shownPage === 'whatsnew' && (
        <section className="lc-settings__section">
          <h2 className="lc-settings__heading">What’s new</h2>
          <p className="lc-settings__lede">Every version of Locust, newest first. This is {changelog?.version ?? 'the one running'}.</p>
          <WhatsNew changelog={changelog} />
        </section>
        )}
        </div>
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
