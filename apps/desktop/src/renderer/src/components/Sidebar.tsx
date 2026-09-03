import { useState } from 'react'
import type { ReactElement } from 'react'

import type { PublicRecoveredMission, PublicRuntimeStatus, PublicTeammate } from '../../../shared/ipc.js'
import type { LiveActivity } from '../faceState.js'
import { runtimeDisplayName } from '../../../shared/runtimes.js'
import mark from '../assets/locust-mark.svg'
import wordmark from '../assets/locust-wordmark.svg'
import {
  connectedRuntimeCount,
  facePresenceFor,
  missionPhaseView,
  missionsMatching,
  runtimeIsUsable,
  shortMissionId,
  teammateStatusView
} from '../status.js'
import { PixelFace } from './PixelFace.js'
import { Icon } from './Icon.js'

export interface SidebarMission {
  /**
   * Who the mission belongs to, when the shell knows before the host has
   * recorded it -- a run that is still starting has no missionId to look up.
   */
  readonly ownerId?: string
  readonly missionId: string
  readonly title: string
  readonly phase: PublicRecoveredMission['phase'] | 'running'
  /** Which runtime this mission is on, when it is known. */
  readonly runtime?: PublicRecoveredMission['runtime']
  readonly integrityIssueCount: number
  /**
   * The mission that began this conversation, and the turn immediately
   * before this one. A reply is its own mission -- one run, one receipt --
   * so without these the sidebar lists an exchange as several entries while
   * the thread beside it shows it as one.
   */
  readonly rootId?: string
  readonly parentId?: string
  /** Every turn this row stands for, so selecting any of them lights it. */
  readonly memberIds?: readonly string[]
  /** Turns in the conversation; 1 is an ordinary single-run mission. */
  readonly turns?: number
}

/** Whether a row is the conversation the workroom is showing. */
function isShown(mission: SidebarMission, selectedMissionId: string | undefined): boolean {
  if (selectedMissionId === undefined) return false
  return (mission.memberIds ?? [mission.missionId]).includes(selectedMissionId)
}

/**
 * The workspace sidebar.
 *
 * There is no teammate list yet and none is drawn: teammates arrive in P2 as a
 * real local store. Showing the reference's four sample teammates here would
 * put fictional colleagues beside a live mission, which is the one thing the
 * design spec forbids -- so the region is simply absent until it is real.
 */
export function Sidebar({
  runtimes,
  missions,
  teammates,
  missionOwners,
  selectedMissionId,
  selectedTeammateId,
  onSelectMission,
  onMissionMenu,
  pendingApprovals,
  liveActivity,
  recentlyDone,
  recentlyReceived,
  onSelectTeammate,
  onNewTeammate,
  onOpenSettings
}: {
  readonly runtimes: readonly PublicRuntimeStatus[]
  readonly missions: readonly SidebarMission[]
  readonly teammates: readonly PublicTeammate[]
  readonly missionOwners: Readonly<Record<string, string>>
  readonly selectedMissionId: string | undefined
  /** Who the composer is addressing. Selecting a teammate makes them the next mission's owner. */
  readonly selectedTeammateId: string | undefined
  readonly onSelectMission: (missionId: string) => void
  /** Right-click on a mission row, so it can be acted on without opening it. */
  readonly onMissionMenu: (missionId: string, at: { readonly x: number; readonly y: number }) => void
  /** Approvals waiting on each teammate's live run, by teammate id. */
  readonly pendingApprovals: Readonly<Record<string, number>>
  /** What each teammate's live run is doing, by teammate id; absent means no live run. */
  readonly liveActivity: Readonly<Record<string, LiveActivity>>
  /** Teammates whose mission just finished, or who just received a message. */
  readonly recentlyDone: readonly string[]
  readonly recentlyReceived: readonly string[]
  readonly onSelectTeammate: (teammateId: string) => void
  readonly onNewTeammate: () => void
  readonly onOpenSettings: () => void
}): ReactElement {
  const [query, setQuery] = useState('')
  const connected = connectedRuntimeCount(runtimes)
  const unowned = missions.filter((mission) => (mission.ownerId ?? missionOwners[mission.missionId]) === undefined)
  const shownUnowned = missionsMatching(unowned, query)
  return (
    <nav className="lc-sidebar" aria-label="Workspace">
      <div className="lc-sidebar__brand">
        <span className="lc-brand__lockup">
          <img className="lc-brand__mark" src={mark} alt="" aria-hidden="true" />
          <img className="lc-brand__wordmark" src={wordmark} alt="Locust" />
        </span>
        <button
          type="button"
          className="lc-iconbutton"
          aria-label="New teammate"
          title="New teammate"
          onClick={onNewTeammate}
        >
          <Icon name="plus" size={14} />
        </button>
      </div>

      <div className="lc-search">
        <Icon name="search" size={13} />
        <input
          type="text"
          placeholder="Search missions"
          aria-label="Search missions"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          autoComplete="off"
        />
      </div>

      <div className="lc-sidebar__scroll">
        {teammates.length > 0 && <div className="lc-sectionlabel">Teammates</div>}
        {teammates.map((teammate) => {
          const owned = missions.filter(
            (mission) => (mission.ownerId ?? missionOwners[mission.missionId]) === teammate.teammateId
          )
          // What this teammate's rows show while a search is running. Their
          // status still comes from ALL their work: a teammate does not stop
          // working because someone typed in a box.
          const shownOwned = missionsMatching(owned, query)
          // The runtime this teammate's own work is on. Asking about Codex
          // for everyone told a person their teammate needed a sign-in while
          // she was visibly working on Claude Code.
          const theirRuntime = owned.find((mission) => mission.phase === 'running')?.runtime
            ?? owned.at(0)?.runtime
          const status = teammateStatusView({
            // A teammate with no work of their own is judged by nothing in
            // particular, so the roster says idle rather than borrowing some
            // other runtime's sign-in state.
            runtime: theirRuntime === undefined
              ? undefined
              : runtimes.find((entry) => entry.id === theirRuntime),
            anyRuntimeUsable: runtimes.some(runtimeIsUsable),
            hasRunningMission: owned.some((mission) => mission.phase === 'running'),
            pendingApprovals: pendingApprovals[teammate.teammateId] ?? 0,
            roleLabel: teammate.role,
            ...(liveActivity[teammate.teammateId] === undefined ? {} : { liveActivity: liveActivity[teammate.teammateId] }),
            recentlyDone: recentlyDone.includes(teammate.teammateId),
            recentlyReceived: recentlyReceived.includes(teammate.teammateId)
          })
          const selected = teammate.teammateId === selectedTeammateId
          return (
            <div key={teammate.teammateId} className={`lc-teammate${selected ? ' is-selected' : ''}`}>
              <button
                type="button"
                className="lc-row lc-row--button"
                aria-current={selected ? 'true' : undefined}
                title={`Message ${teammate.name}`}
                onClick={() => onSelectTeammate(teammate.teammateId)}
              >
                <PixelFace
                  hue={teammate.hue}
                  avatar={teammate.avatar}
                  size={30}
                  activity={status.activity}
                  presence={facePresenceFor(status.status)}
                  teammateId={teammate.teammateId}
                />
                <span className="lc-row__text">
                  <span className="lc-row__name">
                    {teammate.name}
                    {status.pulse && <span className={`lc-dot is-pulsing lc-tone-${status.tone} lc-namedot`} />}
                  </span>
                  <span className={`lc-row__meta lc-tone-${status.tone === 'muted' ? 'muted' : status.tone}`}>
                    {status.label}
                  </span>
                  {teammate.route !== undefined && (
                    // Which model this teammate IS. People pit models against
                    // each other on purpose, and that only reads if each row
                    // says who is who without opening a thread.
                    <span className="lc-row__route lc-mono" title="The route this teammate last ran on; replies on their own run here">
                      {runtimeDisplayName(teammate.route.runtime)} / {teammate.route.model}
                    </span>
                  )}
                </span>
              </button>
              {shownOwned.length > 0 && (
                <div className="lc-teammate__missions">
                  {shownOwned.map((mission) => (
                    <button
                      type="button"
                      key={mission.missionId}
                      className={`lc-teammate__mission${isShown(mission, selectedMissionId) ? ' is-active' : ''}`}
                      onContextMenu={(event) => {
                        event.preventDefault()
                        onMissionMenu(mission.missionId, { x: event.clientX, y: event.clientY })
                      }}
                      onClick={() => onSelectMission(mission.missionId)}
                    >
                      <span
                        className={`lc-dot lc-tone-${missionPhaseView(mission.phase, mission.integrityIssueCount > 0).tone}`}
                      />
                      <span>{mission.title}</span>
                      {(mission.turns ?? 1) > 1 && (
                        <span className="lc-teammate__turns lc-mono">{mission.turns}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}

        {shownUnowned.length > 0 && (
          <>
            <div className="lc-sectionlabel">{teammates.length > 0 ? 'Other missions' : 'Missions'}</div>
            {shownUnowned.map((mission) => {
              const view = missionPhaseView(mission.phase, mission.integrityIssueCount > 0)
              return (
                <button
                  type="button"
                  key={mission.missionId}
                  className="lc-row"
                  aria-current={isShown(mission, selectedMissionId)}
                  onClick={() => onSelectMission(mission.missionId)}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    onMissionMenu(mission.missionId, { x: event.clientX, y: event.clientY })
                  }}
                >
                  <span
                    className={`lc-dot lc-tone-${view.tone}${mission.phase === 'running' ? ' is-pulsing' : ''}`}
                  />
                  <span className="lc-row__text">
                    <span className="lc-row__name">{mission.title}</span>
                    <span className="lc-row__meta">
                      {view.label}
                      {(mission.turns ?? 1) > 1 && ` · ${String(mission.turns)} turns`} ·{' '}
                      <span className="lc-mono">{shortMissionId(mission.missionId)}</span>
                    </span>
                  </span>
                </button>
              )
            })}
          </>
        )}

        {/*
          Only one empty state, and only when it is true: no missions at all.
          When every mission belongs to a teammate they are already listed
          above, so an "other missions" section with a note in it would be a
          heading for nothing.
        */}
        {/*
          A search that matches nothing says so. Without this the sidebar
          simply empties, which reads as "you have no missions" rather than
          "none of them match".
        */}
        {query.trim().length > 0 && missionsMatching(missions, query).length === 0 && (
          <p className="lc-sidebar__empty lc-row__meta">No missions match that.</p>
        )}

        {missions.length === 0 && (
          <>
            <div className="lc-sectionlabel">Missions</div>
            <p className="lc-sidebar__empty lc-row__meta">
              {teammates.length === 0
                ? 'No missions yet. Describe one below and it is recorded locally as it runs.'
                : `No missions yet. Describe one below and ${teammates[0]!.name} picks it up.`}
            </p>
          </>
        )}
      </div>

      <div className="lc-sidebar__footer">
        <button type="button" onClick={onOpenSettings}>
          <Icon name="settings" size={15} />
          <span>Settings</span>
        </button>
        <span className="lc-connected">
          {connected} connected
        </span>
      </div>
    </nav>
  )
}
