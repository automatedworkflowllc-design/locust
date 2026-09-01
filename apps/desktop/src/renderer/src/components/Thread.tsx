import { useState } from 'react'
import type { ReactElement } from 'react'

import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

import type { PublicRecoveredMission } from '../../../shared/ipc.js'
import { buildThread } from '../missionView.js'
import { checkpointLabel, ledgerVerificationLabel, missionPhaseView, shortMissionId } from '../status.js'
import { Icon } from './Icon.js'

function ActivityCard({
  summary,
  details
}: {
  readonly summary: string
  readonly details: readonly { readonly kind: string; readonly name: string; readonly settled: boolean }[]
}): ReactElement {
  const [open, setOpen] = useState(false)
  return (
    <div className="lc-card">
      <button type="button" className="lc-activity" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span>{summary}</span>
        <span className="lc-rail__meta">{open ? 'hide' : 'show'}</span>
      </button>
      {open && (
        <div className="lc-activity__rows">
          {details.map((detail, index) => (
            <span key={`${detail.name}-${index}`}>
              {detail.kind} · {detail.name}
              {detail.settled ? '' : ' · still running'}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * The durable receipt. Every value is read from the recovered mission -- the
 * runtime it really ran on, the checkpoints really written, the actions the
 * ledger could not settle, and the ledger's own path. `verified` is a claim
 * about durability, so it is withheld whenever recovery reported an issue.
 */
function ReceiptCard({ mission }: { readonly mission: PublicRecoveredMission }): ReactElement {
  const view = missionPhaseView(mission.phase, mission.integrityIssueCount > 0)
  const verification = ledgerVerificationLabel(mission.integrityIssueCount)
  const checkpoints = mission.checkpoints ?? []
  const last = checkpoints.at(-1)
  const unsettled = last?.unsettledActions ?? []
  return (
    <div className={`lc-card is-${view.tone === 'blue' ? 'blue' : view.tone === 'red' ? 'red' : 'amber'}`}>
      <div className="lc-card__head">
        <span>
          <span className="lc-mono lc-rail__meta">DURABLE RECEIPT</span>{' '}
          <span className={`lc-tag is-${view.tone}`}>{view.tag}</span>
        </span>
        <span className="lc-rail__meta">restored from local ledger</span>
      </div>
      <dl className="lc-receipt">
        <dt>Runtime</dt>
        <dd className="lc-mono">
          {mission.runtime} {mission.cliVersion ?? ''} · {mission.model}
        </dd>
        <dt>Mission</dt>
        <dd className="lc-mono">{shortMissionId(mission.missionId)}</dd>
        <dt>Checkpoints</dt>
        <dd>
          {checkpoints.length === 0
            ? 'none written'
            : `${checkpoints.length} written · last ${checkpointLabel(last!.epoch)}`}
        </dd>
        {unsettled.length > 0 && (
          <>
            <dt>Unverified</dt>
            <dd className="lc-tone-amber">
              {unsettled.length === 1
                ? '1 action started and never reported an outcome'
                : `${unsettled.length} actions started and never reported an outcome`}
            </dd>
          </>
        )}
        <dt>Events</dt>
        <dd>
          {mission.eventCount} recorded{mission.eventsTruncated ? ' · window truncated for display' : ''}
        </dd>
        <dt>Ledger</dt>
        <dd className={verification === 'verified' ? 'lc-tone-lime' : 'lc-tone-amber'}>{verification}</dd>
      </dl>
    </div>
  )
}

export interface ThreadProps {
  readonly prompt: string
  readonly events: readonly NormalizedRuntimeEvent[]
  readonly running: boolean
  readonly missionId: string | undefined
  readonly restoredMission: PublicRecoveredMission | undefined
  readonly error: string | undefined
  readonly errorIsPersistence: boolean
}

export function Thread({
  prompt,
  events,
  running,
  missionId,
  restoredMission,
  error,
  errorIsPersistence
}: ThreadProps): ReactElement {
  const items = buildThread(events, { running })
  return (
    <div className="lc-thread">
      <div className="lc-thread__column">
        {missionId !== undefined && (
          <div className="lc-thread__marker lc-mono">Mission · {shortMissionId(missionId)}</div>
        )}

        <div className="lc-bubble">{prompt}</div>

        {items.map((item) => {
          if (item.type === 'agent-message') {
            return (
              <div className="lc-agentline" key={item.key}>
                <p>
                  {item.text}
                  {item.streaming && <span className="lc-caret" />}
                </p>
              </div>
            )
          }
          if (item.type === 'activity') {
            return <ActivityCard key={item.key} summary={item.summary} details={item.details} />
          }
          if (item.type === 'live-step') {
            return (
              <div className="lc-card is-live" key={item.key}>
                <div className="lc-card__head">
                  <span>
                    <span className="lc-dot is-pulsing lc-tone-lime" /> {item.label}
                  </span>
                  {item.detail !== undefined && <span className="lc-rail__meta">{item.detail}</span>}
                </div>
                <div className="lc-card__body">
                  <div className="lc-progress">
                    <span />
                  </div>
                </div>
              </div>
            )
          }
          if (item.type === 'limit') {
            return (
              <div className="lc-card is-red" key={item.key}>
                <div className="lc-card__head">
                  <span>
                    {item.kind === 'quota-exhausted' ? 'Usage limit reached' : 'Provider rate limit'}
                  </span>
                  <span className="lc-tag is-red">{item.kind}</span>
                </div>
                <div className="lc-card__body">{item.message}</div>
              </div>
            )
          }
          return (
            <div className={`lc-card is-${item.level === 'error' ? 'red' : 'amber'}`} key={item.key}>
              <div className="lc-card__head">
                <span>Runtime notice</span>
                <span className="lc-rail__meta">{item.level}</span>
              </div>
              <div className="lc-card__body">{item.message}</div>
            </div>
          )
        })}

        {error !== undefined && (
          <div className="lc-card is-red">
            <div className="lc-card__head">
              <span>
                <Icon name="shield" size={13} />{' '}
                {errorIsPersistence ? 'Mission held — receipts could not be written' : 'The run could not continue'}
              </span>
            </div>
            <div className="lc-card__body">
              {error}
              {errorIsPersistence && (
                <>
                  {' '}
                  The run was stopped rather than continued without a durable record.
                </>
              )}
            </div>
          </div>
        )}

        {restoredMission !== undefined && <ReceiptCard mission={restoredMission} />}
      </div>
    </div>
  )
}
