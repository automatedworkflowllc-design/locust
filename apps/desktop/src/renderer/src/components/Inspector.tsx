import { useState } from 'react'
import type { ReactElement } from 'react'

import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

import type { MissionRouteSummary, PublicRecoveredMission } from '../../../shared/ipc.js'
import { buildSignalRail } from '../missionView.js'
import { checkpointLabel, ledgerVerificationLabel, shortMissionId } from '../status.js'

const TABS = ['Activity', 'Details', 'Artifacts', 'Receipt'] as const
type Tab = (typeof TABS)[number]

function Empty({ children }: { readonly children: string }): ReactElement {
  return <p className="lc-inspector__empty">{children}</p>
}

/**
 * The mission inspector. The Signal Rail is the honest home for detail: the
 * thread stays semantic and everything that actually happened lives here.
 *
 * The Tools & permissions block the reference draws is deliberately reduced to
 * what this build can prove. Codex runs read-only with no approval channel, so
 * a grid of allow/ask/deny rules would be a picture of a permission system that
 * does not exist yet -- it states the one policy that is real and says the rest
 * arrives with approvals.
 */
export function Inspector({
  events,
  running,
  route,
  restoredMission,
  onClose
}: {
  readonly events: readonly NormalizedRuntimeEvent[]
  readonly running: boolean
  readonly route: MissionRouteSummary | undefined
  readonly restoredMission: PublicRecoveredMission | undefined
  readonly onClose: () => void
}): ReactElement {
  const [tab, setTab] = useState<Tab>('Activity')
  // What this run was ACTUALLY allowed to do, read from the start receipt --
  // not from whatever mode the composer happens to show now.
  const writes = route?.sandbox === 'workspace-write'
  const rows = buildSignalRail(events, { running })

  return (
    <aside className="lc-inspector" aria-label="Mission inspector">
      <div className="lc-inspector__head">
        <span className="lc-inspector__title">Mission inspector</span>
        <button type="button" className="lc-inspector__close" aria-label="Close inspector" onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="lc-tabs" role="tablist" aria-label="Inspector sections">
        {TABS.map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={tab === name}
            className={`lc-tab${tab === name ? ' is-active' : ''}`}
            onClick={() => setTab(name)}
          >
            {name}
          </button>
        ))}
      </div>

      <div className="lc-inspector__scroll">
        {tab === 'Activity' && (
          <>
            <div className="lc-fieldlabel lc-mono lc-rail__label">Signal rail</div>
            {rows.length === 0 ? (
              <Empty>No events yet.</Empty>
            ) : (
              <div className="lc-rail">
                {rows.map((row) => (
                  <div className="lc-rail__event" key={row.key}>
                    <span className="lc-rail__gutter">
                      <span className={`lc-rail__dot lc-tone-${row.tone}${row.live ? ' is-pulsing' : ''}`} />
                      <span className="lc-rail__line" />
                    </span>
                    <span className="lc-rail__body">
                      <span className="lc-rail__name">{row.name}</span>
                      <span className="lc-rail__meta">{row.meta}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div className="lc-permissions">
              <div className="lc-permissions__head">
                <span className="lc-fieldlabel lc-mono">Tools &amp; permissions</span>
                <span className="lc-rail__meta">{writes ? 'workspace-write' : 'read-only'}</span>
              </div>
              <div className="lc-permissions__rows">
                <div className="lc-permissions__row">
                  <span className="lc-tone-green">allow</span>
                  <span>read files in the host-selected workspace</span>
                </div>
                {writes ? (
                  <div className="lc-permissions__row">
                    <span className="lc-tone-green">allow</span>
                    <span>write files inside that same workspace folder</span>
                  </div>
                ) : (
                  <div className="lc-permissions__row">
                    <span className="lc-tone-red">deny</span>
                    <span>every write to disk</span>
                  </div>
                )}
                <div className="lc-permissions__row">
                  <span className="lc-tone-red">deny</span>
                  <span>anything outside the workspace, and any network the runtime does not make itself</span>
                </div>
              </div>
              <p className="lc-permissions__note">
                The host fixes the workspace, executable, argv and sandbox. `codex exec` has no
                interactive approval channel, so consent is given when the mission starts rather
                than per action; mid-run approvals need the app-server protocol.
              </p>
            </div>
          </>
        )}

        {tab === 'Details' && (
          <dl className="lc-receipt lc-receipt--flush">
            <dt>Runtime</dt>
            <dd className="lc-mono">
              {route?.runtime ?? 'unknown'} {route?.cliVersion ?? ''}
            </dd>
            <dt>Model</dt>
            <dd className="lc-mono">{route?.model ?? 'unknown'}</dd>
            <dt>Route</dt>
            <dd className="lc-mono">{route?.resolvedRouteId ?? 'unknown'}</dd>
            <dt>Mission</dt>
            <dd className="lc-mono">{route === undefined ? 'unknown' : shortMissionId(route.missionId)}</dd>
            <dt>Sandbox</dt>
            <dd>{route?.sandbox ?? 'unknown'}</dd>
            <dt>Events</dt>
            <dd>{events.length} recorded in this view</dd>
          </dl>
        )}

        {tab === 'Artifacts' && (
          <Empty>
            No artifacts. A read-only mission produces none; artifacts appear once a run can write.
          </Empty>
        )}

        {tab === 'Receipt' &&
          (restoredMission === undefined ? (
            <Empty>The durable receipt appears once this mission has been recovered from the ledger.</Empty>
          ) : (
            <dl className="lc-receipt lc-receipt--flush">
              <dt>Phase</dt>
              <dd>{restoredMission.phase}</dd>
              <dt>Checkpoints</dt>
              <dd>
                {restoredMission.checkpoints.length === 0
                  ? 'none written'
                  : `${restoredMission.checkpoints.length} · last ${checkpointLabel(
                      restoredMission.checkpoints[restoredMission.checkpoints.length - 1]!.epoch
                    )}`}
              </dd>
              <dt>Events</dt>
              <dd>{restoredMission.eventCount}</dd>
              <dt>Ledger</dt>
              <dd
                className={
                  ledgerVerificationLabel(restoredMission.integrityIssueCount) === 'verified'
                    ? 'lc-tone-green'
                    : 'lc-tone-amber'
                }
              >
                {ledgerVerificationLabel(restoredMission.integrityIssueCount)}
              </dd>
            </dl>
          ))}
      </div>
    </aside>
  )
}
