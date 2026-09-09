import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'

import type { MissionRuntimeId, NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

import type {
  MissionApprovalDecision,
  MissionApprovalRequest,
  PublicPeerMessage,
  PublicRecoveredMission,
  PublicTeammate
} from '../../../shared/ipc.js'
import { buildThread, cancellationSummary, decisionStanding, errorAlreadyShown, readPlan, threadMarkers, threadPeerCards, turnAttachments, turnPromptLine } from '../missionView.js'
import type { LiveStarter } from '../missionView.js'
import { parseAgentText } from '../agentText.js'
import { atBottom } from '../stickToBottom.js'
import { ledgerFailureRows, ledgerFailureSentence } from '../ledgerFailure.js'
import { runtimeDisplayName } from '../../../shared/runtimes.js'
import { liveActivityOf } from '../faceState.js'
import { costLine, runCostOf } from '../cost.js'
import type { FaceActivity } from '../faceState.js'
import { checkpointLabel, ledgerVerificationLabel, missionPhaseView, shortMissionId } from '../status.js'
import { ActivityCard } from './ActivityCard.js'
import { MemoryCard } from './MemoryCard.js'
import type { MemoryCardLine } from './MemoryCard.js'
import { AttachedImage } from './AttachedImage.js'
import { isImagePath } from '../../../shared/image-files.js'
import { Icon } from './Icon.js'
import { ApprovalCard } from './ApprovalCard.js'
import { CancellationCard } from './CancellationCard.js'
import { AgentAvatar, AgentText, DiagnosticLine, LiveStepCard, PlanCard } from './ThreadItems.js'
import { DecisionCard } from './DecisionCard.js'
import { ResumeCard } from './ResumeCard.js'
import { resumeOffer } from '../resume.js'
import { HandoffDivider } from './HandoffDivider.js'
import { TimeMarker } from './TimeMarker.js'
import { PeerThread } from './PeerThread.js'
import type { ThreadItem, ThreadPeerCard } from '../missionView.js'
import type { DecisionOption } from '../../../shared/decision.js'

/**
 * One transcript's worth of items. Extracted so a handed-off mission can render
 * TWO of them -- what the first runtime did, the divider, then what the second
 * one did -- without either half being re-derived differently from the other.
 */
function ThreadItems({
  items,
  owner,
  activity,
  workspacePath,
  decision
}: {
  readonly items: readonly ThreadItem[]
  readonly owner: PublicTeammate | undefined
  /** What the live run is doing; only the working line draws it. */
  readonly activity: FaceActivity
  readonly workspacePath: string | undefined
  /** How to answer a question the run ended on. Absent on earlier turns. */
  readonly decision:
    | { readonly onChoose: (option: DecisionOption) => void; readonly busy: boolean; readonly standing: string }
    | undefined
}): ReactElement {
  return (
    <>
      {items.map((item) => {
        if (item.type === 'agent-message') {
          return (
            <div className="lc-agentline" key={item.key}>
              <AgentAvatar teammate={owner} />
              <div className="lc-agentline__body">
                <AgentText text={item.text} streaming={item.streaming === true} />
              </div>
            </div>
          )
        }
        if (item.type === 'plan') {
          return <PlanCard key={item.key} steps={item.steps} doneCount={item.doneCount} />
        }
        if (item.type === 'activity') {
          return (
            <ActivityCard
              key={item.key}
              summary={item.summary}
              trace={item.trace}
              finished={item.finished}
              details={item.details}
              runtimeName={item.reportedBy === undefined ? undefined : runtimeDisplayName(item.reportedBy)}
              workspacePath={workspacePath}
              openByDefault={item.openByDefault === true}
              {...(item.plan === undefined ? {} : { plan: item.plan })}
              {...(item.notices === undefined ? {} : { notices: item.notices })}
            />
          )
        }
        if (item.type === 'live-step') {
          return (
            <LiveStepCard
              key={item.key}
              label={item.label}
              detail={item.detail}
              startedAt={item.startedAt}
              kind={item.kind}
              waiting={item.waiting ?? false}
              owner={owner}
              activity={activity}
            />
          )
        }
        if (item.type === 'limit') {
          // Red is for a run that cannot continue. An approaching-limit
          // warning is not that: the mission ran fine, and a full-width red
          // card on every turn trains a person to ignore the colour that is
          // supposed to mean "stopped".
          if (item.kind === 'temporary-rate-limit') {
            return <DiagnosticLine key={item.key} level="warning" message={item.message} />
          }
          return (
            <div className="lc-card is-terminal is-red" key={item.key}>
              <div className="lc-card__head">
                <span>Usage limit reached</span>
                <span className="lc-tag is-red">{item.kind}</span>
              </div>
              <div className="lc-card__body">{item.message}</div>
            </div>
          )
        }
        if (item.type === 'decision') {
          // Only where an answer can actually be given. buildThread already
          // withholds the item on earlier turns; this is the second half of
          // the same rule, so a card can never appear with no way to answer.
          if (decision === undefined) return null
          return (
            <DecisionCard
              key={item.key}
              request={item.request}
              teammateName={owner?.name}
              standing={decision.standing}
              busy={decision.busy}
              onChoose={decision.onChoose}
            />
          )
        }
        return <DiagnosticLine key={item.key} level={item.level} message={item.message} />
      })}
    </>
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
  const [open, setOpen] = useState(false)
  return (
    <div className={`lc-card is-terminal is-${view.tone === 'blue' ? 'blue' : view.tone === 'red' ? 'red' : 'amber'}`}>
      <div className="lc-card__head">
        <span>
          <span className="lc-mono lc-rail__meta">DURABLE RECEIPT</span>{' '}
          <span className={`lc-tag is-${view.tone}`}>{view.tag}</span>
        </span>
        <span className="lc-rail__meta">restored from local ledger</span>
      </div>
      {/*
        * Summarised, not spread out. It is the app's proof of durability and
        * it should exist; it should not be OPEN, because nobody reads "Events:
        * 41 recorded" twice (design review, 2026-09-06). Same gesture as the
        * activity fold, so there is one way to open a detail in this app
        * rather than two.
        *
        * Two things stay outside the disclosure: the verification word, and
        * the unverified count when it is not zero. An action that started and
        * never reported an outcome is the one row here a person needs without
        * asking for it.
        */}
      <button
        type="button"
        className="lc-receipt__summary"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span className="lc-mono lc-receipt__line">
          {mission.runtime} {mission.cliVersion ?? ''} / {mission.model}
          <span className="lc-separator">·</span>
          {checkpoints.length === 0 ? 'no checkpoints' : `${String(checkpoints.length)} checkpoints`}
          <span className="lc-separator">·</span>
          <span className={verification === 'verified' ? 'lc-tone-green' : 'lc-tone-amber'}>{verification}</span>
          {unsettled.length > 0 && (
            <>
              <span className="lc-separator">·</span>
              <span className="lc-tone-amber">
                {unsettled.length === 1 ? '1 unverified' : `${String(unsettled.length)} unverified`}
              </span>
            </>
          )}
        </span>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
      </button>
      {open && (
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
        <dt>Cost</dt>
        <dd className="lc-mono">{costLine(runCostOf(mission.events)) ?? 'not reported by the runtime'}</dd>
        <dt>Ledger</dt>
        <dd className={verification === 'verified' ? 'lc-tone-green' : 'lc-tone-amber'}>{verification}</dd>
      </dl>
      )}
    </div>
  )
}

export interface ThreadProps {
  readonly prompt: string
  /** Who started the current turn; a host-briefed one is not the person's words. */
  readonly startedBy?: LiveStarter
  /** Open the run a peer message reached; undefined for one nothing received yet. */
  readonly onOpenPeerRun: (messageId: string) => (() => void) | undefined
  /**
   * Earlier turns of the same conversation, oldest first, each with the words
   * the person typed for it. Empty for a first turn. They render above this
   * turn so the exchange reads as one, which is what it was.
   */
  readonly coldStart?: boolean
  /** The folder missions run in; paths render relative to it. */
  readonly workspacePath?: string
  /** Present only when re-running with edits allowed is possible; see App. */
  readonly onRunWithEdits?: () => void
  /** Whether that run was asked to PLAN rather than do; the offer then reads as the build step. */
  readonly wasPlan?: boolean
  /**
   * How a person answers a question the run ended on. Absent when this thread
   * cannot take a next turn at all, which is what keeps a card from appearing
   * with no way to answer it.
   */
  readonly onAnswer?: (option: DecisionOption) => void
  /**
   * Pick up an interrupted mission from its last checkpoint. Absent when this
   * thread cannot start a run at all, so the offer can never appear without a
   * way to accept it.
   */
  readonly onResume?: (epoch: number) => void
  /**
   * What THIS run was permitted to do. Taken from the live run rather than
   * from `restoredMission`, which is set only for a mission recovered from
   * the ledger -- so reading it there made every live read-only run say it
   * could edit files, which is the one claim on the card that must not be
   * loose. Caught on screen 2026-09-05, not by a test.
   */
  readonly sandbox?: 'read-only' | 'workspace-write' | 'full-access'
  readonly earlierTurns: readonly {
    readonly missionId: string
    readonly prompt: string
    readonly events: readonly NormalizedRuntimeEvent[]
    /** What that turn exchanged with peers. Drawn with the turn, not with the last one. */
    readonly peerMessages?: readonly PublicPeerMessage[]
    /** Who started it. A host-briefed turn is not drawn as the person's words. */
    readonly startedBy?: LiveStarter
  }[]
  readonly events: readonly NormalizedRuntimeEvent[]
  readonly running: boolean
  readonly restoredMission: PublicRecoveredMission | undefined
  readonly error: string | undefined
  readonly errorIsPersistence: boolean
  /** Where receipts are written; the ledger-failure card offers to open it. */
  readonly ledgerPath?: string
  /** Local wall-clock label for when the mission began. */
  readonly startedAt: string | undefined
  /** The same moment as an ISO string, for the waiting line's clock. */
  readonly startedAtIso?: string
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
    /** What this conversation taught the team, read from the memory list. */
    readonly memories?: readonly MemoryCardLine[]
  }
}

export function Thread({
  prompt,
  startedBy,
  onOpenPeerRun,
  earlierTurns,
  coldStart = false,
  onRunWithEdits,
  wasPlan,
  onAnswer,
  onResume,
  sandbox,
  workspacePath,
  events,
  running,
  restoredMission,
  error,
  errorIsPersistence,
  ledgerPath,
  startedAt,
  startedAtIso,
  approvals,
  onDecide,
  decidingIds,
  cancelled,
  handoff,
  peers
}: ThreadProps): ReactElement {
  // What the run was allowed, hoisted so EVERY turn can be told -- not just
  // the newest. `no files changed` existed only on the last turn, so scrolling
  // up in a conversation showed the silence the line exists to break.
  const mayEdit = sandbox !== undefined && sandbox !== 'read-only'
  const items = buildThread(events, {
    running,
    latestTurn: true,
    awaitingDecision: approvals.length > 0,
    spokeToPeers: peers.messages.length > 0,
    mayEdit,
    ...(workspacePath === undefined ? {} : { workspacePath }),
    ...(startedAtIso === undefined ? {} : { startedAt: startedAtIso })
  })
  // A read-only run whose answer carries code is the one case where "run it
  // again, with edits allowed" is certainly what a person wants: the runtime
  // wrote the change and was not permitted to apply it. Asked of the parsed
  // reply rather than of the prose, so a stray backtick cannot fake it.
  const answeredWithCode = items.some(
    (item) => item.type === 'agent-message' && parseAgentText(item.text).some((block) => block.kind === 'code')
  )
  // The current turn is the last in the sequence, so its own marker is the
  // one whose index is past every earlier turn.
  const markers = threadMarkers([...earlierTurns.map((turn) => turn.events), events])
  const currentMarker = markers.find((marker) => marker.beforeTurn === earlierTurns.length)
  // Every turn's exchange, not only the last one: the message a teammate SENT
  // was written on an earlier turn than the reply it drew, so a thread that
  // only drew the current turn showed the answer and never the question.
  // What the current turn is called: the person's words, or -- for a turn the
  // host briefed -- the message that caused it, or nothing at all.
  const currentLine = turnPromptLine({ prompt, startedBy, peerMessages: peers.messages })
  /*
   * The person's turn: what they typed, and under it the files they attached.
   *
   * The files used to be inside the bubble, because the host names them in a
   * line above the message for the runtime to act on and that whole string was
   * what the bubble drew. So the person read an instruction they had not
   * written, and the files -- the thing they actually did -- were a sentence
   * rather than something to look at or open.
   *
   * Rows, and the same reveal control the activity fold uses on a file a
   * teammate wrote: "where is it" is the question a file attracts, and it
   * should have the same answer wherever the file appears.
   */
  const userTurn = (line: string | undefined, attached: readonly string[]): ReactElement | undefined => {
    if (line === undefined && attached.length === 0) return undefined
    return (
      <>
        {line !== undefined && <div className="lc-bubble">{line}</div>}
        {attached.length > 0 && (
          <div className="lc-sentfiles">
            {attached.map((path) => (
              <button
                key={path}
                type="button"
                className="lc-sentfile"
                title={`Show ${path} in the file manager`}
                onClick={() => {
                  const bridge = window.desktop
                  if (bridge === undefined || workspacePath === undefined) return
                  void bridge.revealFile(`${workspacePath}/${path}`).catch(() => undefined)
                }}
              >
                {isImagePath(path) ? <AttachedImage path={path} /> : <Icon name="file" size={12} />}
                <span className="lc-sentfile__path">{path}</span>
              </button>
            ))}
          </div>
        )}
      </>
    )
  }
  const exchanges = threadPeerCards([...earlierTurns.map((turn) => turn.peerMessages ?? []), peers.messages])
  const peerCard = (card: ThreadPeerCard): ReactElement => (
    <PeerThread
      key={card.key}
      self={peers.self}
      peer={card.group.peer}
      messages={card.group.messages}
      teammates={peers.teammates}
      onOpenPeerRun={onOpenPeerRun}
    />
  )
  const cardsFor = (turnIndex: number, placement: ThreadPeerCard['placement']): readonly ThreadPeerCard[] =>
    exchanges.filter((card) => card.turnIndex === turnIndex && card.placement === placement)
  // Planned-step count comes from the last plan the provider sent, so
  // "never started" is measured against what it said it would do.
  const plannedSteps = events
    .filter((event) => event.type === 'plan.updated')
    .map((event) => (event.type === 'plan.updated' ? readPlan(event.payload.plan).length : 0))
    .at(-1) ?? 0
  const stopped = cancelled ? cancellationSummary(events, plannedSteps, workspacePath) : undefined
  const stoppedAt = cancelled
    ? new Date(events.at(-1)?.occurredAt ?? Date.now()).toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit'
      })
    : undefined
  // Follow the newest line while the person is at the bottom, and stop the
  // moment they scroll up to read something. See `stickToBottom.ts` for why
  // the "am I at the bottom" question has to be asked BEFORE the content
  // grows rather than after.
  const scroller = useRef<HTMLDivElement | null>(null)
  const following = useRef(true)
  const lastHeight = useRef(0)
  useLayoutEffect(() => {
    const box = scroller.current
    if (box === null) return
    const grew = box.scrollHeight > lastHeight.current
    lastHeight.current = box.scrollHeight
    if (following.current && grew) box.scrollTop = box.scrollHeight
  })
  // A mission the person just opened starts at its newest line, wherever the
  // previous one had been left.
  useEffect(() => {
    const box = scroller.current
    if (box === null) return
    following.current = true
    box.scrollTop = box.scrollHeight
    // Identity of the conversation on screen: the recovered mission when there
    // is one, else this run's start time. Either changes exactly when the
    // person opens a different conversation, which is the moment to jump.
  }, [restoredMission?.missionId, startedAtIso])

  return (
    <div
      className="lc-thread"
      ref={scroller}
      onScroll={(event) => {
        following.current = atBottom(event.currentTarget)
      }}
    >
      <div className="lc-thread__column">
        {/*
          * The mission id is PROVENANCE, and provenance lives on the workroom
          * header band where the 0.20 pass put it -- the header already reads
          * "Mission · 78243d5d · <model> · restored from the local ledger".
          * Drawing it here as well said the same thing twice, thirty pixels
          * apart (design review, 2026-09-06).
          *
          * The START TIME is not on the header, so it stays. What is left is
          * a time marker, which the thread already has a species for, rather
          * than a species of its own.
          */}
        {startedAt !== undefined && (
          <div className="lc-thread__marker lc-mono">Started {startedAt}</div>
        )}

        {/*
          Every turn the person actually typed, in order. A handed-off run is
          launched with a machine-written briefing instead, and drawing THAT as
          a user bubble would attribute to them something they never said --
          which is why a handoff contributes no bubble of its own here.
        */}
        {earlierTurns.map((turn, index) => {
          const marker = markers.find((candidate) => candidate.beforeTurn === index)
          return (
            <Fragment key={turn.missionId}>
              {marker !== undefined && (
                <TimeMarker at={marker.at} minutesIn={marker.minutesIn} note={marker.note} />
              )}
              {userTurn(turnPromptLine(turn), turnAttachments(turn))}
              {cardsFor(index, 'before-work').map(peerCard)}
              <ThreadItems items={buildThread(turn.events, { running: false, mayEdit, ...(workspacePath === undefined ? {} : { workspacePath }) })} owner={peers.self} activity="idle" workspacePath={workspacePath} decision={undefined} />
              {cardsFor(index, 'after-work').map(peerCard)}
            </Fragment>
          )
        })}

        {currentMarker !== undefined && (
          <TimeMarker at={currentMarker.at} minutesIn={currentMarker.minutesIn} note={currentMarker.note} />
        )}
        {userTurn(currentLine, turnAttachments({ prompt, ...(startedBy === undefined ? {} : { startedBy }) }))}

        {handoff !== undefined && (
          <>
            <ThreadItems items={buildThread(handoff.priorEvents, { running: false, mayEdit, ...(workspacePath === undefined ? {} : { workspacePath }) })} owner={peers.self} activity="idle" workspacePath={workspacePath} decision={undefined} />
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
        {cardsFor(earlierTurns.length, 'before-work').map(peerCard)}

        <ThreadItems
          items={items}
          owner={peers.self}
          activity={liveActivityOf(events, running)}
          workspacePath={workspacePath}
          decision={
            onAnswer === undefined
              ? undefined
              : { onChoose: onAnswer, busy: running, standing: decisionStanding({ sandbox: sandbox ?? restoredMission?.sandbox, events }) }
          }
        />

        {cardsFor(earlierTurns.length, 'after-work').map(peerCard)}
        {peers.notices.map((notice, index) => (
          <DiagnosticLine key={`peer_notice_${index}`} level="warning" message={notice} />
        ))}
        <MemoryCard lines={peers.memories ?? []} />

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

        {coldStart && (
          // Said plainly because the alternative is a person assuming the
          // model read the turn above it. The conversation is one thread; the
          // runtime's memory of it is not.
          <div className="lc-thread__marker lc-mono">
            Started without the earlier messages — the turn before this one left no session to resume
          </div>
        )}

        {onRunWithEdits !== undefined && (wasPlan === true || answeredWithCode) && (
          // Deliberately not an error: the run did exactly what its mode
          // allows. This is the one click that would otherwise be a mode
          // change and a retyped prompt. A plan run says so in its own
          // words -- the point of planning is that carrying it out is the
          // next, separate decision.
          <div className="lc-rerun">
            <span>
              {wasPlan === true
                ? 'This is the plan, not the work: nothing in the workspace has changed.'
                : 'This run could not write to the workspace, so the change is only in the reply.'}
            </span>
            <button type="button" className="lc-button" onClick={onRunWithEdits}>
              <Icon name="diff" size={13} /> {wasPlan === true ? 'Build this plan' : 'Run again with edits allowed'}
            </button>
          </div>
        )}

        {stopped !== undefined && <CancellationCard summary={stopped} stoppedAt={stoppedAt} />}

        {error !== undefined && !errorAlreadyShown(items, error) && (
          errorIsPersistence ? (
            /*
              The one moment the product's central claim breaks, drawn rather
              than shrugged at (design pass section: "a persistence-failure
              state"). It used to title itself "Mission held" and then say in
              the next sentence that the run had been stopped -- and stopped is
              what the host does. Both halves matter, so the card says which
              happened, splits what is safe from what is at risk, and offers
              the folder.
            */
            <div className="lc-card is-terminal is-red">
              <div className="lc-card__head">
                <span>
                  {/* The title leads with what HAPPENED, not with the fault.
                      "Can't write the mission ledger" describes the app's
                      problem; "Stopped" is the fact about the person's run
                      (design, 2026-09-08). */}
                  <Icon name="shield" size={13} /> Stopped — the mission ledger could not be written
                </span>
              </div>
              <div className="lc-card__body">
                <p className="lc-ledgerfail__why">{ledgerFailureSentence(error)}</p>
                <dl className="lc-ledgerfail">
                  {/*
                    * Nothing written at all: no recovered record AND no events
                    * on screen. A mid-run failure has events either way, and a
                    * failure to CREATE the mission has neither -- which is the
                    * case where "this mission can be reopened" is false.
                    */}
                  {ledgerFailureRows(
                    restoredMission?.checkpoints?.length,
                    restoredMission === undefined && events.length === 0
                  ).map((row) => (
                    <Fragment key={row.label}>
                      <dt className={`lc-ledgerfail__label is-${row.tone}`}>{row.label}</dt>
                      <dd className="lc-ledgerfail__text">{row.text}</dd>
                    </Fragment>
                  ))}
                </dl>
                {/*
                  * One action, and the path beside it.
                  *
                  * The design draws two -- Retry and "Change where the ledger
                  * lives" -- and neither exists to be wired. The ledger
                  * directory is a fixed `join(userData, 'mission-ledger')`
                  * with no setting behind it, so changing it is a feature; and
                  * the run is already dead, so retrying is what ResumeCard
                  * does. Drawing either would be a dead control, which is the
                  * rule this app has paid for more than once and the same
                  * discipline the design praised on the slash menu.
                  *
                  * The path is shown regardless, which is the half of that
                  * idea that costs nothing: someone told their ledger cannot
                  * be written and not told where it lives has been informed
                  * and not helped.
                  */}
                {ledgerPath !== undefined && ledgerPath.length > 0 && (
                  <div className="lc-ledgerfail__actions">
                    <button
                      type="button"
                      className="lc-button"
                      onClick={() => {
                        const bridge = window.desktop
                        if (bridge === undefined) return
                        void bridge.revealFile(ledgerPath).catch(() => undefined)
                      }}
                    >
                      Show the ledger folder
                    </button>
                    <span className="lc-ledgerfail__path lc-mono">{ledgerPath}</span>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="lc-card is-terminal is-red">
              <div className="lc-card__head">
                <span>
                  <Icon name="shield" size={13} /> The run could not continue
                </span>
              </div>
              <div className="lc-card__body">{error}</div>
            </div>
          )
        )}

        {/*
          An interrupted mission kept everything needed to carry on and, until
          now, offered no way to. The offer sits ABOVE the receipt: the receipt
          is the record, this is the thing to do about it.
        */}
        {restoredMission !== undefined && onResume !== undefined && (
          <ResumeCard offer={resumeOffer(restoredMission)} onResume={onResume} busy={running} />
        )}
        {restoredMission !== undefined && <ReceiptCard mission={restoredMission} />}
      </div>
    </div>
  )
}
