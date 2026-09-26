import { useState } from 'react'
import type { ReactElement } from 'react'

import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

import type { MissionRouteSummary, PublicRecoveredMission } from '../../../shared/ipc.js'
import { costLabel, costLineOrWhyNot, runCostOf } from '../cost.js'
import { buildSignalRail, buildThread, producedFiles } from '../missionView.js'
import { accountPhrase, checkpointLabel, ledgerVerificationLabel, sandboxPhrase, shortMissionId } from '../status.js'
import { modelDisplayName } from '../routeName.js'
import { runtimeDisplayName } from '../../../shared/runtimes.js'
import { Icon } from './Icon.js'

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
  workspacePath,
  running,
  route,
  restoredMission,
  onClose
}: {
  readonly events: readonly NormalizedRuntimeEvent[]
  /** The folder this ran in, so artifact paths read the way a person writes them. */
  readonly workspacePath: string | undefined
  readonly running: boolean
  readonly route: MissionRouteSummary | undefined
  readonly restoredMission: PublicRecoveredMission | undefined
  readonly onClose: () => void
}): ReactElement {
  const [tab, setTab] = useState<Tab>('Activity')
  // What this run was ACTUALLY allowed to do, read from the start receipt --
  // not from whatever mode the composer happens to show now.
  /*
   * THREE states, not two, and the third was being described as its opposite.
   *
   * `writes` collapsed workspace-write and full-access together, so an Auto
   * run -- the one that may touch the whole machine -- was labelled
   * `workspace-write` and then told the reader "deny: anything outside the
   * workspace", which is exactly what Auto is for. The conversation header
   * said "may edit anything on this machine" two inches away. Of the two
   * surfaces the person is likelier to trust the specific-looking one, and it
   * was the wrong one (Grok's audit, 2026-09-13).
   *
   * The label now comes from `sandboxPhrase`, the same function the header
   * uses, so the two cannot drift again.
   */
  const sandbox = route?.sandbox
  const writes = sandbox === 'workspace-write' || sandbox === 'full-access'
  const anywhere = sandbox === 'full-access'
  const rows = buildSignalRail(events, { running })
  const [artifactNotice, setArtifactNotice] = useState<string | undefined>(undefined)
  // Every file this run touched, gathered from the same activity the fold
  // draws so the tab and the thread cannot disagree about what happened.
  const artifacts = producedFiles(
    buildThread(events, { running, mayEdit: writes, ...(workspacePath === undefined ? {} : { workspacePath }) })
      .flatMap((item) => ('details' in item && Array.isArray(item.details) ? item.details : [])),
    workspacePath
  )

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
            {/* "Signal rail" was the panel's own jargon (first-impressions pass, 0.354). */}
            <div className="lc-fieldlabel lc-mono lc-rail__label">What happened</div>
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
                <span className="lc-fieldlabel lc-mono">What it may do</span>
                <span className="lc-rail__meta">{sandboxPhrase(sandbox)}</span>
              </div>
              <div className="lc-permissions__rows">
                <div className="lc-permissions__row">
                  <span className="lc-tone-green">allow</span>
                  <span>read the files in this folder</span>
                </div>
                {writes ? (
                  <div className="lc-permissions__row">
                    <span className="lc-tone-green">allow</span>
                    <span>
                      {anywhere
                        ? 'change files anywhere your account can reach, in this folder and outside it'
                        : 'change files in this folder'}
                    </span>
                  </div>
                ) : (
                  <div className="lc-permissions__row">
                    <span className="lc-tone-red">deny</span>
                    <span>changing any file</span>
                  </div>
                )}
                {anywhere ? (
                  <div className="lc-permissions__row">
                    <span className="lc-tone-amber">allow</span>
                    <span>run any command your account can run, and reach any network</span>
                  </div>
                ) : (
                  <div className="lc-permissions__row">
                    <span className="lc-tone-red">deny</span>
                    <span>anything outside this folder, and any network access beyond the model's own</span>
                  </div>
                )}
              </div>
              {/*
                * In Locust's words, not the plumbing's: "The host fixes the
                * workspace, executable, argv and sandbox" (first-impressions
                * pass, 0.354). And no longer a sentence about `codex exec`
                * having no approval channel: Codex runs on its app-server now,
                * where Approve each asks per action, so that sentence had
                * become false about the run it sat under.
                */}
              <p className="lc-permissions__note">Locust sets the folder, the tool and these limits when the mission starts; nothing here changes while it runs.</p>
            </div>
          </>
        )}

        {/*
          * IN WORDS, WITH THE EXACT STRINGS ONE HOVER AWAY.
          *
          * These were the record's own spellings -- "codex 0.153.0",
          * "account-default", "codex-account:default" -- beside a composer
          * that says "Codex / Account Default" for the same run (the design
          * review, "Details in plain words"). The names are the chip's; the
          * identifiers stay in each value's title, which is where a person
          * goes to find the string to type somewhere else.
          */}
        {tab === 'Details' && (
          <dl className="lc-receipt lc-receipt--flush">
            <dt>Runtime</dt>
            <dd title={route === undefined ? undefined : `${route.runtime} ${route.cliVersion ?? ''}`.trim()}>
              {route === undefined ? 'unknown' : `${runtimeDisplayName(route.runtime)} ${route.cliVersion ?? ''}`.trim()}
            </dd>
            <dt>Model</dt>
            <dd title={route?.model}>{route === undefined ? 'unknown' : modelDisplayName(route.runtime, route.model)}</dd>
            <dt>Account</dt>
            <dd title={route?.resolvedRouteId}>{route === undefined ? 'unknown' : accountPhrase(route)}</dd>
            <dt>Mission</dt>
            <dd className="lc-mono" title={route?.missionId}>{route === undefined ? 'unknown' : shortMissionId(route.missionId)}</dd>
            <dt>Sandbox</dt>
            <dd>{route?.sandbox === undefined ? 'unknown' : sandboxPhrase(route.sandbox)}</dd>
            <dt>Events</dt>
            <dd>{events.length} recorded in this view</dd>
            {/* The Team card's rule: Cost for a priced run, Usage for tokens --
                this said Cost for token counts (review of 0.255.0, #10). */}
            <dt>{costLabel(runCostOf(events))}</dt>
            <dd className="lc-mono">
              {costLineOrWhyNot(runCostOf(events), running)}
            </dd>
          </dl>
        )}

        {tab === 'Artifacts' &&
          (artifacts.length === 0 ? (
            <Empty>
              No artifacts. A read-only mission produces none; artifacts appear once a run can write.
            </Empty>
          ) : (
            // The tab has made this promise since it was built and never kept
            // it: it said artifacts appear once a run can write, and then
            // showed the same empty line after runs that wrote plenty. The
            // rows come from the same entries the activity fold counts, so the
            // two cannot disagree about what this mission touched.
            <ul className="lc-artifacts">
              {artifacts.map((artifact) => (
                <li className="lc-artifacts__row" key={artifact.path}>
                  <span className="lc-artifacts__path" title={artifact.path}>
                    {artifact.shown}
                  </span>
                  {artifact.status !== undefined && <span className="lc-artifacts__status">{artifact.status}</span>}
                  <button
                    type="button"
                    className="lc-filerow__reveal"
                    title={`Show ${artifact.shown} in the file manager`}
                    aria-label={`Show ${artifact.shown} in the file manager`}
                    onClick={() => {
                      const bridge = window.desktop
                      if (bridge === undefined) return
                      setArtifactNotice(undefined)
                      void bridge
                        .revealFile(artifact.path)
                        .then((response) => {
                          if (!response.ok) setArtifactNotice(response.message)
                        })
                        .catch(() => setArtifactNotice('That file could not be shown. It is still where it was written.'))
                    }}
                  >
                    <Icon name="folder" size={13} />
                  </button>
                </li>
              ))}
              {artifactNotice !== undefined && <li className="lc-filerow__notice">{artifactNotice}</li>}
            </ul>
          ))}

        {tab === 'Receipt' &&
          (restoredMission === undefined ? (
            /*
             * Only two honest things to say without a record: it is not
             * written yet because the run is still going, or it is being
             * read. The old line -- "appears once this mission has been
             * recovered from the ledger" -- described a mechanism, sent the
             * person nowhere, and stood under runs whose record was already
             * on disk.
             */
            <Empty>
              {running
                ? 'The receipt is written when this run finishes: its phase, checkpoints, event count and whether the ledger verifies.'
                : 'Reading this run’s receipt from the ledger…'}
            </Empty>
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
                  ledgerVerificationLabel(restoredMission.integrityIssueCount) === 'ledger verified'
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
