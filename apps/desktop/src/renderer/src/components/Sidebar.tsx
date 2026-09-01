import type { ReactElement } from 'react'

import type { PublicRecoveredMission, PublicRuntimeStatus } from '../../../shared/ipc.js'
import mark from '../assets/locust-mark.svg'
import wordmark from '../assets/locust-wordmark.svg'
import { connectedRuntimeCount, missionPhaseView, shortMissionId } from '../status.js'
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
  selectedMissionId,
  onSelectMission,
  onOpenSettings
}: {
  readonly runtimes: readonly PublicRuntimeStatus[]
  readonly missions: readonly SidebarMission[]
  readonly selectedMissionId: string | undefined
  readonly onSelectMission: (missionId: string) => void
  readonly onOpenSettings: () => void
}): ReactElement {
  const connected = connectedRuntimeCount(runtimes)
  return (
    <nav className="lc-sidebar" aria-label="Workspace">
      <div className="lc-sidebar__brand">
        <img className="lc-brand__mark" src={mark} alt="" aria-hidden="true" />
        <img className="lc-brand__wordmark" src={wordmark} alt="Locust" />
        <button
          type="button"
          className="lc-iconbutton lc-brand__add"
          aria-label="New teammate"
          title="Teammates arrive with the roster"
          disabled
        >
          <Icon name="plus" size={14} />
        </button>
      </div>

      <div className="lc-search">
        <Icon name="search" size={13} />
        <input type="text" placeholder="Search missions" aria-label="Search missions" />
      </div>

      <div className="lc-sidebar__scroll">
        <div className="lc-sectionlabel">Missions</div>
        {missions.length === 0 ? (
          <p
            className="lc-row__meta"
            style={{ padding: '0 var(--lc-space-5)', textWrap: 'pretty' }}
          >
            No missions yet. Describe one below and it is recorded locally as it runs.
          </p>
        ) : (
          missions.map((mission) => {
            const view = missionPhaseView(mission.phase, mission.integrityIssueCount > 0)
            return (
              <button
                type="button"
                key={mission.missionId}
                className="lc-row"
                aria-current={mission.missionId === selectedMissionId}
                onClick={() => onSelectMission(mission.missionId)}
              >
                <span className={`lc-dot lc-tone-${view.tone}${mission.phase === 'running' ? ' is-pulsing' : ''}`} />
                <span className="lc-row__text">
                  <span className="lc-row__name">{mission.title}</span>
                  <span className="lc-row__meta">
                    {view.label} · <span className="lc-mono">{shortMissionId(mission.missionId)}</span>
                  </span>
                </span>
              </button>
            )
          })
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
