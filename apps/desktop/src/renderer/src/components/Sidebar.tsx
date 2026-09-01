import type { ReactElement } from 'react'

import type { PublicRecoveredMission, PublicRuntimeStatus, PublicTeammate } from '../../../shared/ipc.js'
import mark from '../assets/locust-mark.svg'
import wordmark from '../assets/locust-wordmark.svg'
import { connectedRuntimeCount, missionPhaseView, shortMissionId, teammateStatusView } from '../status.js'
import { faceForName } from './NewTeammateDialog.js'
import { PixelFace } from './PixelFace.js'
import { Icon } from './Icon.js'

export interface SidebarMission {
  readonly missionId: string
  readonly title: string
  readonly phase: PublicRecoveredMission['phase'] | 'running'
  readonly integrityIssueCount: number
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
  readonly onSelectTeammate: (teammateId: string) => void
  readonly onNewTeammate: () => void
  readonly onOpenSettings: () => void
}): ReactElement {
  const connected = connectedRuntimeCount(runtimes)
  const unowned = missions.filter((mission) => missionOwners[mission.missionId] === undefined)
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
        <input type="text" placeholder="Search missions" aria-label="Search missions" />
      </div>

      <div className="lc-sidebar__scroll">
        {teammates.length > 0 && <div className="lc-sectionlabel">Teammates</div>}
        {teammates.map((teammate) => {
          const owned = missions.filter((mission) => missionOwners[mission.missionId] === teammate.teammateId)
          const status = teammateStatusView({
            runtime: runtimes.find((entry) => entry.id === 'codex'),
            hasRunningMission: owned.some((mission) => mission.phase === 'running'),
            pendingApprovals: 0,
            roleLabel: teammate.role
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
                <PixelFace hue={teammate.hue} pixels={faceForName(teammate.name)} size={30} />
                <span className="lc-row__text">
                  <span className="lc-row__name">
                    {teammate.name}
                    {status.pulse && <span className={`lc-dot is-pulsing lc-tone-${status.tone} lc-namedot`} />}
                  </span>
                  <span className={`lc-row__meta lc-tone-${status.tone === 'muted' ? 'muted' : status.tone}`}>
                    {status.label}
                  </span>
                </span>
              </button>
              {owned.length > 0 && (
                <div className="lc-teammate__missions">
                  {owned.map((mission) => (
                    <button
                      type="button"
                      key={mission.missionId}
                      className={`lc-teammate__mission${
                        mission.missionId === selectedMissionId ? ' is-active' : ''
                      }`}
                      onClick={() => onSelectMission(mission.missionId)}
                    >
                      <span
                        className={`lc-dot lc-tone-${missionPhaseView(mission.phase, mission.integrityIssueCount > 0).tone}`}
                      />
                      <span>{mission.title}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}

        {unowned.length > 0 && (
          <>
            <div className="lc-sectionlabel">{teammates.length > 0 ? 'Other missions' : 'Missions'}</div>
            {unowned.map((mission) => {
              const view = missionPhaseView(mission.phase, mission.integrityIssueCount > 0)
              return (
                <button
                  type="button"
                  key={mission.missionId}
                  className="lc-row"
                  aria-current={mission.missionId === selectedMissionId}
                  onClick={() => onSelectMission(mission.missionId)}
                >
                  <span
                    className={`lc-dot lc-tone-${view.tone}${mission.phase === 'running' ? ' is-pulsing' : ''}`}
                  />
                  <span className="lc-row__text">
                    <span className="lc-row__name">{mission.title}</span>
                    <span className="lc-row__meta">
                      {view.label} · <span className="lc-mono">{shortMissionId(mission.missionId)}</span>
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
        <span className={`lc-connected${connected > 0 ? ' is-live' : ''}`}>
          {connected} connected
        </span>
      </div>
    </nav>
  )
}
