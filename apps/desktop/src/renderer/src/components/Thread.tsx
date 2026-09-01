import { useState } from 'react'
import type { ReactElement } from 'react'

import type { MissionRuntimeId, NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

import type {
  MissionApprovalDecision,
  MissionApprovalRequest,
  PublicPeerMessage,
  PublicRecoveredMission,
  PublicTeammate
} from '../../../shared/ipc.js'
import { buildThread, cancellationSummary, peerGroups, readPlan } from '../missionView.js'
import { checkpointLabel, ledgerVerificationLabel, missionPhaseView, shortMissionId } from '../status.js'
import { Icon } from './Icon.js'
import { ApprovalCard } from './ApprovalCard.js'
import { CancellationCard } from './CancellationCard.js'
import { AgentAvatar, DiagnosticLine, LiveStepCard, PlanCard } from './ThreadItems.js'
import { HandoffDivider } from './HandoffDivider.js'
import { PeerThread } from './PeerThread.js'
import type { PeerGroup, ThreadItem } from '../missionView.js'

/**
 * One transcript's worth of items. Extracted so a handed-off mission can render
 * TWO of them -- what the first runtime did, the divider, then what the second
 * one did -- without either half being re-derived differently from the other.
 */
function ThreadItems({ items }: { readonly items: readonly ThreadItem[] }): ReactElement {
  return (
    <>
      {items.map((item) => {
        if (item.type === 'agent-message') {
          return (
            <div className="lc-agentline" key={item.key}>
              <AgentAvatar />
              <p>
                {item.text}
                {item.streaming && <span className="lc-caret" />}
              </p>
            </div>
          )
        }
        if (item.type === 'plan') {
          return <PlanCard key={item.key} steps={item.steps} doneCount={item.doneCount} />
        }
        if (item.type === 'activity') {
          return <ActivityCard key={item.key} summary={item.summary} details={item.details} />
        }
        if (item.type === 'live-step') {
          return (
            <LiveStepCard
              key={item.key}
              label={item.label}
              detail={item.detail}
              startedAt={item.startedAt}
            />
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
        return <DiagnosticLine key={item.key} level={item.level} message={item.message} />
      })}
    </>
  )
}

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
  /** Local wall-clock label for when the mission began. */
  readonly startedAt: string | undefined
  /** Approvals waiting on the user, oldest first. */
  readonly approvals: readonly MissionApprovalRequest[]
  readonly onDecide: (approvalId: string, decision: MissionApprovalDecision) => void
  readonly decidingIds: readonly string[]
  /** True once the run has been stopped by the user. */
  readonly cancelled: boolean
  /**
   * Set when this run continues one that was stopped for a route switch. The
   * prior run's events are rendered above the divider so the transcript reads
   * as one piece of work, while the divider keeps the two runtimes' authorship
   * distinguishable -- which the durable record insists on.
   */
  readonly handoff:
    | {
        readonly from: MissionRuntimeId
        readonly to: MissionRuntimeId
        readonly at: string | undefined
        readonly unsettledCount: number
        readonly omittedBriefing: readonly string[]
        readonly priorEvents: readonly NormalizedRuntimeEvent[]
      }
    | undefined
  /**
   * The workroom exchange around this mission. `self` is the teammate the
   * mission belongs to; `notices` are shares the host could not honour, said
   * in the thread rather than dropped.
   */
  readonly peers: {
    readonly self: PublicTeammate | undefined
    readonly teammates: readonly PublicTeammate[]
    readonly messages: readonly PublicPeerMessage[]
    readonly notices: readonly string[]
  }
}

export function Thread({
  prompt,
  events,
  running,
  missionId,
  restoredMission,
  error,
  errorIsPersistence,
  startedAt,
  approvals,
  onDecide,
  decidingIds,
  cancelled,
  handoff,
  peers
}: ThreadProps): ReactElement {
  const items = buildThread(events, { running })
  const exchanges = peerGroups(peers.messages)
  const peerCard = (group: PeerGroup): ReactElement => (
    <PeerThread
      key={`peer_${group.peer.teammateId || group.peer.name}`}
      self={peers.self}
      peer={group.peer}
      messages={group.messages}
      teammates={peers.teammates}
    />
  )
  // Planned-step count comes from the last plan the provider sent, so
  // "never started" is measured against what it said it would do.
  const plannedSteps = events
    .filter((event) => event.type === 'plan.updated')
    .map((event) => (event.type === 'plan.updated' ? readPlan(event.payload.plan).length : 0))
    .at(-1) ?? 0
  const stopped = cancelled ? cancellationSummary(events, plannedSteps) : undefined
  const stoppedAt = cancelled
    ? new Date(events.at(-1)?.occurredAt ?? Date.now()).toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit'
      })
    : undefined
  return (
    <div className="lc-thread">
      <div className="lc-thread__column">
        {missionId !== undefined && (
          <div className="lc-thread__marker lc-mono">
            Mission · {shortMissionId(missionId)}
            {startedAt !== undefined && ` · started ${startedAt}`}
          </div>
        )}

        {/*
          The user's own words, once. A handed-off run is launched with a
          machine-written briefing instead, and drawing THAT as a user bubble
          would attribute to the person something they never said.
        */}
        <div className="lc-bubble">{prompt}</div>

        {handoff !== undefined && (
          <>
            <ThreadItems items={buildThread(handoff.priorEvents, { running: false })} />
            <HandoffDivider
              from={handoff.from}
              to={handoff.to}
              at={handoff.at}
              unsettledCount={handoff.unsettledCount}
              omittedBriefing={handoff.omittedBriefing}
            />
          </>
        )}

        {/*
          Exchanges that were delivered to this run sit where they were in
          time: before the work. Ones this run only sent follow the work.
        */}
        {exchanges.filter((group) => group.received).map(peerCard)}

        <ThreadItems items={items} />

        {exchanges.filter((group) => !group.received).map(peerCard)}
        {peers.notices.map((notice, index) => (
          <DiagnosticLine key={`peer_notice_${index}`} level="warning" message={notice} />
        ))}

        {/*
          Approvals sit at the END of the thread, after everything that has
          happened. They are what the run is waiting on, so they belong where
          the reader's eye already is rather than buried in the transcript.
        */}
        {approvals.map((request) => (
          <ApprovalCard
            key={request.approvalId}
            request={request}
            busy={decidingIds.includes(request.approvalId)}
            onDecide={(decision) => onDecide(request.approvalId, decision)}
          />
        ))}

        {stopped !== undefined && <CancellationCard summary={stopped} stoppedAt={stoppedAt} />}

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
