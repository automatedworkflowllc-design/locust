import { Fragment, useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'

import type { MissionRuntimeId, NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

import type {
  MissionApprovalDecision,
  MissionApprovalRequest,
  PublicPeerMessage,
  PublicRecoveredMission,
  PublicTeammate
} from '../../../shared/ipc.js'
import { buildThread, cancellationSummary, decisionStanding, errorAlreadyShown, foldNoticeKeys, lastPlanOf, modeRefusedATool, readPlan, threadMarkers, threadPeerCards, turnAttachments, turnPromptLine, usageWindowLabel } from '../missionView.js'
import type { GroupBoundary, GroupLeaving, LiveStarter, TurnSwitch } from '../missionView.js'
import { parseAgentText } from '../agentText.js'
import { folderName, ranOnLine } from '../ranOn.js'
import { useFollowBottom } from '../useFollowBottom.js'
import { JumpToBottom } from './JumpToBottom.js'
import { ledgerFailureRows, ledgerFailureSentence } from '../ledgerFailure.js'
import { runtimeDisplayName } from '../../../shared/runtimes.js'
import { liveActivityOf } from '../faceState.js'
import { costLabel, costLineOrWhyNot, runCostOf } from '../cost.js'
import type { FaceActivity } from '../faceState.js'
import { checkpointLabel, ledgerVerificationLabel, missionPhaseView, shortMissionId } from '../status.js'
import { ActivityCard } from './ActivityCard.js'
import { MemoryCard } from './MemoryCard.js'
import { memoriesOfTurn } from '../conversationMemories.js'
import type { MemoryCardLine } from './MemoryCard.js'
import { AttachedImage } from './AttachedImage.js'
import { isImagePath } from '../../../shared/image-files.js'
import { Icon } from './Icon.js'
import { ApprovalCard } from './ApprovalCard.js'
import { CancellationCard } from './CancellationCard.js'
import { AgentAvatar, AgentText, DiagnosticLine, LiveStepCard, PlanSteps } from './ThreadItems.js'
import { DecisionCard } from './DecisionCard.js'
import { ResumeCard } from './ResumeCard.js'
import { resumeOffer } from '../resume.js'
import { HandoffDivider } from './HandoffDivider.js'
import { TimeMarker } from './TimeMarker.js'
import { PeerThread } from './PeerThread.js'
import type { ThreadItem, ThreadPeerCard } from '../missionView.js'
import type { DecisionOption } from '../../../shared/decision.js'

/**
 * The files a teammate handed over, and what the host said when a press
 * could not be honoured.
 *
 * Its own component because it holds state, and it holds state for the
 * reason every other control in this app that talks to the host does: the
 * answer has to be shown. `revealFile` returns `{ok, message}` for a path
 * outside the workspace or a file that is not there, and the first version of
 * this dropped it on the floor -- `void bridge.revealFile(...).catch(...)`.
 *
 * That is the shape this project keeps paying for. Grok found it on outbound
 * links (pass 2, finding 3): a refused press and a press that worked looked
 * identical, and nothing whatsoever appeared on screen. The handover drive
 * found the same thing here on 2026-09-20 -- a reply that said it had written
 * `notes/summary.md`, a card that drew a button for it, and no such file on
 * disk. A model can name a file it never wrote, so this card must be able to
 * say so.
 *
 * The refusal clears on the next press: a stale message beside a button that
 * now works is the same lie pointing the other way.
 */
function HandedFiles({
  files,
  workspacePath,
  onOpenFile
}: {
  readonly files: readonly { readonly path: string; readonly note?: string }[]
  readonly workspacePath: string | undefined
  /** Open it in the panel beside the conversation. Absent: the name reveals instead. */
  readonly onOpenFile?: (path: string) => void
}): ReactElement {
  const [refused, setRefused] = useState<string>()
  const ask = (action: 'revealFile' | 'saveCopy', path: string): void => {
    const bridge = window.desktop
    setRefused(undefined)
    if (bridge === undefined || workspacePath === undefined) return
    void bridge[action](`${workspacePath}/${path}`)
      .then((answer) => setRefused(answer.ok ? undefined : answer.message))
      // The host never answered. Say what is still true: nothing moved.
      .catch(() => setRefused('Locust could not reach that file. Nothing was changed.'))
  }
  return (
    <div className="lc-handedfiles">
      {files.map((file) => (
        <span key={file.path} className="lc-handedfile">
          <button
            type="button"
            className="lc-handedfile__open"
            /*
              * THE NOTE IS IN THE TOOLTIP, because the note is what truncates.
              *
              * The row is a pill and the note is the teammate's own words
              * about the file, so it ellipsises -- and the title said only
              * "Show <path> in the file manager", which left the cut-off half
              * unrecoverable. Colin saw exactly that on a real handover
              * (2026-09-20: "evening continuation: workroom/relay/q…").
              */
            title={(() => {
              const what = onOpenFile === undefined ? `Show ${file.path} in the file manager` : `Open ${file.path}`
              return file.note === undefined ? what : `${file.note}\n\n${what}`
            })()}
            onClick={() => (onOpenFile === undefined ? ask('revealFile', file.path) : onOpenFile(file.path))}
          >
            <Icon name="file" size={12} />
            <span className="lc-handedfile__path">{file.path}</span>
            {file.note !== undefined && <span className="lc-handedfile__note">{file.note}</span>}
          </button>
          {/*
            * SAVE A COPY, the way every other client offers a download
            * (Colin, 2026-09-20: "give it the little download icon ... in
            * case the user wants to easily move it to another folder").
            *
            * On a desktop app the file is already on disk, so this is a copy
            * to a place the person picks in a native save dialog rather than
            * a download. Reveal answers "where is it"; this answers "I want
            * it somewhere else". Neither one ever opens it.
            */}
          <button
            type="button"
            className="lc-handedfile__save"
            aria-label={`Save a copy of ${file.path}`}
            title="Save a copy…"
            onClick={() => ask('saveCopy', file.path)}
          >
            <Icon name="download" size={12} />
          </button>
        </span>
      ))}
      {refused !== undefined && (
        <span className="lc-handedfile__refusal" role="status">
          {refused}
        </span>
      )}
    </div>
  )
}

/**
 * One transcript's worth of items. Extracted so a handed-off mission can render
 * TWO of them -- what the first runtime did, the divider, then what the second
 * one did -- without either half being re-derived differently from the other.
 *
 * EXPORTED for the same reason, one step further: a room renders N of them,
 * one per teammate answering a post. Colin, 2026-09-12: "we already have this
 * exact same system we just need to be able to have it work with multiple in
 * one chat." The room used to draw its own little card showing a teammate's
 * LAST message and nothing else -- no thinking, no tool calls, no plan, and
 * none of the earlier messages of the same turn, which is what he saw going
 * missing. Rendering the real thing is both less code and more of the truth.
 */
export function ThreadItems({
  items,
  owner,
  activity,
  workspacePath,
  decision,
  onOpenFile,
  planMode = false,
  faces = true
}: {
  readonly items: readonly ThreadItem[]
  /**
   * Draw the teammate's face beside what they said. Off where something
   * around these items already shows it -- a room's answer card has the face
   * in its own header, and drawing it again one row down was the same
   * teammate announced twice (design pass, 2026-09-22). The gutter stays, so
   * the text keeps its indent.
   */
  readonly faces?: boolean
  /** Open a handed file in the panel beside the conversation. */
  readonly onOpenFile?: (path: string) => void
  /** The turn was sent in Plan mode; see `Thread`'s prop of the same name. */
  readonly planMode?: boolean
  readonly owner: PublicTeammate | undefined
  /** What the live run is doing; only the working line draws it. */
  readonly activity: FaceActivity
  readonly workspacePath: string | undefined
  /** The folder now open, so the receipt names one only for its own missions. */
  readonly workspaceId?: string | undefined
  /** How to answer a question the run ended on. Absent on earlier turns. */
  readonly decision:
    | { readonly onChoose: (option: DecisionOption) => void; readonly busy: boolean; readonly standing: string }
    | undefined
}): ReactElement {
  /*
   * The orb the live line is showing, if this turn is still going.
   *
   * The plan's running step and the live line make the SAME claim — this is
   * what is happening now — so they show the same mark rather than two
   * opinions about one turn. Read off the items, which is the only place both
   * of them can agree by construction.
   */
  const live = items.find((entry) => entry.type === 'live-step')
  const runningOrb = live !== undefined && live.type === 'live-step' ? live.orb : undefined
  /*
   * ONE FACE PER RUN OF SPEECH, not one per paragraph.
   *
   * A finished turn drew the teammate's face three times in a row down the
   * left edge -- once for "Making your HELLO file", once for "File created",
   * once for "DONE" (design pass, 2026-09-22). Colin, the same day: the face
   * is already one of "so many indicators". Consecutive things the teammate
   * SAID share the face of the first; anything between them -- a tool fold,
   * a plan with outcomes, the live line -- starts a new run.
   */
  const continuesSpeech = (index: number): boolean => {
    const before = items[index - 1]
    return before !== undefined && (before.type === 'agent-message' || before.type === 'plan')
  }
  const face = (index: number): ReactElement =>
    !faces || continuesSpeech(index) ? <span className="lc-agentline__gutter" /> : <AgentAvatar teammate={owner} />
  return (
    <>
      {items.map((item, index) => {
        if (item.type === 'agent-message') {
          return (
            <div className="lc-agentline" key={item.key}>
              {face(index)}
              <div className="lc-agentline__body">
                <AgentText text={item.text} streaming={item.streaming === true} />
              </div>
            </div>
          )
        }
        if (item.type === 'plan') {
          /*
           * A Plan-mode turn is the teammate's ANSWER, so it sits where their
           * prose sits: beside the face, no box, at reading size.
           *
           * It was an `lc-card` -- the register this app reserves for
           * something holding a control -- carrying a PLAN label, a
           * `0 of 5 done` counter and five identical dots. Nothing here holds
           * a control and nothing here is standing; it is the reply. Drawing
           * it as a box was the defect, and the census goes to thirteen by
           * deleting a species rather than adding one (design, 2026-09-09).
           *
           * The plan INSIDE a fold is untouched. One is a record of work, the
           * other is an answer, which is exactly why the same markup was wrong
           * in one of the two places.
           */
          return (
            <div className="lc-agentline" key={item.key}>
              {face(index)}
              <div className="lc-agentline__body">
                {/*
                  * OUTCOMES WHEN THE PLAN WAS ACTUALLY CARRIED OUT.
                  *
                  * This passed `false` unconditionally, which draws the
                  * plain numbered list above -- no markers, no `N of M
                  * done`. That is right for a Plan-MODE turn, where the plan
                  * IS the answer and nothing ran, and it is what the comment
                  * above describes. It was wrong for every other turn.
                  *
                  * Measured in Colin's own ledger, 2026-09-15: 29
                  * `plan.updated` events across his Cursor missions, and the
                  * last update of each one all `TODO_STATUS_COMPLETED`. So
                  * the app knew three of three steps were done and drew
                  * three identical lines that looked exactly like a plan
                  * nothing had happened to -- while the fold underneath
                  * quietly said "3 of 3 steps". "plans are still bugged and
                  * not showing in the UI" is the fair reading of that.
                  *
                  * `touchedNothing` was the distinction the code already
                  * made and already carried, so it decided this too. It is
                  * the wrong one on its own, and in the same way the
                  * "Plan mode -- nothing was changed" sentence beside it was
                  * wrong (Fable, pass 1, finding 4): a turn in ACCEPT EDITS
                  * that answers a question without editing anything also
                  * touched nothing, and its working to-do list was then
                  * drawn as though the plan were the deliverable -- ordinals,
                  * reading size, no PLAN header -- which lands in the middle
                  * of a conversation as a stray numbered line. Colin, seeing
                  * it in his own app, 2026-09-19: "the task/plan looked like
                  * it was showing up glitchy and not our usual ui".
                  *
                  * The plan is the ANSWER only when the person asked for a
                  * plan: Plan mode, and nothing done. Everything else is a
                  * list of work with states to report.
                  */}
                <PlanSteps
                  steps={item.steps}
                  doneCount={item.doneCount}
                  outcomes={!(planMode && item.touchedNothing === true)}
                  underway={runningOrb !== undefined}
                  finished={item.finished === true}
                />
                {/*
                  * Derived, and true: this run changed nothing, and the mode is
                  * why. The same class of fact the trace line carries, said in
                  * the standing register.
                  *
                  * It points at the mode control on the composer rather than
                  * offering a "run this plan" button, because that button does
                  * not exist -- and the question behind it is what a turn IS,
                  * which is a product decision to answer before anything is
                  * drawn.
                  */}
                {planMode && item.steps.length > 0 && item.touchedNothing === true && (
                  <p className="lc-planmode">
                    Plan mode — nothing was changed. Switch the mode below and send again to have{' '}
                    {owner?.name ?? 'your teammate'} do it.
                  </p>
                )}
              </div>
            </div>
          )
        }
        if (item.type === 'files') {
          // Drawn below, from the host's own answer: see `HandedFiles`.
          /*
           * A file the teammate handed over, drawn as the mirror of a file
           * the PERSON attached: the same row of buttons, the same control,
           * the same answer to "where is it". Colin, 2026-09-19: "the user
           * should have the ability to receive files ... just like Claude",
           * sent with a screenshot where he asked for a file and got a path
           * as a sentence.
           *
           * REVEAL, NEVER OPEN. `window.desktop.revealFile` shows the file in
           * the file manager; the host refuses `shell.openPath` on purpose,
           * because opening would RUN a `.bat` or a `.ps1` the model had just
           * written. Do not add an Open button here.
           *
           * Indented to the body, not to the page: these belong to the reply
           * above them, which is why they are inside `lc-agentline`.
           */
          return (
            <div className="lc-agentline" key={item.key}>
              <span className="lc-agentline__gutter" />
              <div className="lc-agentline__body">
                <HandedFiles files={item.files} workspacePath={workspacePath} {...(onOpenFile === undefined ? {} : { onOpenFile })} />
              </div>
            </div>
          )
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
              {...(onOpenFile === undefined ? {} : { onOpenFile })}
              planUnderway={runningOrb !== undefined}
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
              register={item.register}
              waiting={item.waiting ?? false}
              {...(item.orb === undefined ? {} : { orb: item.orb })}
              owner={owner}
              activity={activity}
              face={faces}
            />
          )
        }
        if (item.type === 'limit') {
          // Red is for a run that cannot continue. An approaching-limit
          // warning is not that: the mission ran fine, and a full-width red
          // card on every turn trains a person to ignore the colour that is
          // supposed to mean "stopped".
          // The reset instant is the ledger's; a person reads a local time.
          if (item.kind === 'temporary-rate-limit') {
            return <DiagnosticLine key={item.key} level="warning" message={usageWindowLabel(item.message)} />
          }
          return (
            <div className="lc-card is-terminal is-red" key={item.key}>
              <div className="lc-card__head">
                <span>Usage limit reached</span>
                <span className="lc-tag is-red">{item.kind}</span>
              </div>
              <div className="lc-card__body">{usageWindowLabel(item.message)}</div>
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
function ReceiptCard({
  mission,
  workspacePath,
  workspaceId
}: {
  readonly mission: PublicRecoveredMission
  readonly workspacePath?: string | undefined
  readonly workspaceId?: string | undefined
}): ReactElement {
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
          <span className={verification === 'ledger verified' ? 'lc-tone-green' : 'lc-tone-amber'}>{verification}</span>
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
        {/*
          * SCOPE, stated positively -- the design agent's ruling, 2026-09-11,
          * on whether to say what a run could not have checked. It should
          * not: choosing which absences matter is a judgement about what the
          * diff means, and without that judgement the list is true of every
          * run and becomes furniture. What IS knowable with certainty is that
          * a run happened on one machine in one environment, and that is
          * architecture rather than a guess.
          *
          * "Ran on Windows" tells a person who changed a path handler
          * everything a macOS warning would have, and tells a person who
          * changed a copy string nothing -- correctly.
          */}
        <dt>Ran on</dt>
        <dd className="lc-mono">
          {ranOnLine({
            platform: window.desktop?.platform ?? '',
            // Named only when this mission is one of the open folder's own: a
            // recovered mission records its workspace as an id, not a path,
            // so printing today's folder beside an older run would be a claim
            // nothing supports.
            ...(workspaceId !== undefined && mission.workspaceId === workspaceId
              ? { folder: folderName(workspacePath) ?? '' }
              : {})
          })}
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
        <dt>{costLabel(runCostOf(mission.events))}</dt>
        <dd className="lc-mono">{costLineOrWhyNot(runCostOf(mission.events))}</dd>
        <dt>Ledger</dt>
        <dd className={verification === 'ledger verified' ? 'lc-tone-green' : 'lc-tone-amber'}>{verification}</dd>
      </dl>
      )}
    </div>
  )
}

export interface ThreadProps {
  readonly prompt: string
  /** The folder now open, so the receipt names one only for its own missions. */
  readonly workspaceId?: string | undefined
  /** Who started the current turn; a host-briefed one is not the person's words. */
  readonly startedBy?: LiveStarter
  /** Open the run a peer message reached; undefined for one nothing received yet. */
  /** Open a handed file in the panel beside the conversation. */
  readonly onOpenFile?: (path: string) => void
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
  /** Offered only where the runtime never started, so nothing can repeat. */
  readonly onRunAgain?: () => void
  /** Open the conversation a received message was written in. */
  readonly onOpenSenderRun?: (missionId: string) => () => void
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
  /** M28: why the last Resume from checkpoint did not start, shown on the card. */
  readonly resumeRefusal?: string
  /**
   * What THIS run was permitted to do. Taken from the live run rather than
   * from `restoredMission`, which is set only for a mission recovered from
   * the ledger -- so reading it there made every live read-only run say it
   * could edit files, which is the one claim on the card that must not be
   * loose. Caught on screen 2026-09-05, not by a test.
   */
  readonly sandbox?: 'read-only' | 'workspace-write' | 'full-access'
  /**
   * The run was sent in Plan mode. The "Plan mode — nothing was changed"
   * sentence hangs on this, not on the shape of the reply: a run in Accept
   * edits that answered a question has steps and touched nothing too, and
   * was being told to switch modes two inches above a composer reading
   * Accept edits (Fable, pass 1, finding 4, with the ledger).
   */
  readonly planMode?: boolean
  readonly earlierTurns: readonly {
    readonly missionId: string
    readonly prompt: string
    readonly events: readonly NormalizedRuntimeEvent[]
    /** What that turn exchanged with peers. Drawn with the turn, not with the last one. */
    readonly peerMessages?: readonly PublicPeerMessage[]
    /** Who started it. A host-briefed turn is not drawn as the person's words. */
    readonly startedBy?: LiveStarter
    /** Set when that turn was a reply sent to another runtime: its divider goes above it. */
    readonly switchedFrom?: TurnSwitch
  }[]
  /**
   * Where this conversation's group began briefing it, if it is in one with
   * instructions and the join was recorded. Drawn at that point in the
   * thread -- after the last turn that ran without them -- never at the top.
   */
  readonly groupBoundary?: GroupBoundary
  /**
   * Join lines for memberships that have ENDED, so the turns they briefed
   * still say so. Grok, three passes running: after leaving, only the stop
   * was marked. Drawn with the same note as the current join, above its own
   * leaving line.
   */
  readonly pastBoundaries?: readonly GroupBoundary[]
  /** Where earlier groups' words stopped briefing this conversation; drawn as the join line's mirror. */
  readonly groupLeavings?: readonly GroupLeaving[]
  readonly events: readonly NormalizedRuntimeEvent[]
  readonly running: boolean
  readonly restoredMission: PublicRecoveredMission | undefined
  /** The turn being shown, so its own memories are drawn under it. */
  readonly shownMissionId?: string
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
  /** A QUESTION's answers, keyed by question id. Distinct from `onAnswer`, which
   *  answers a decision block in the transcript -- different surface, different act. */
  readonly onAnswerQuestion: (approvalId: string, answers: Readonly<Record<string, readonly string[]>>) => void
  readonly decidingIds: readonly string[]
  /** True once the run has been stopped by the user. */
  readonly cancelled: boolean
  /**
   * Set when this run continues one that was stopped for a route switch. The
   * prior run's events are rendered above the divider so the transcript reads
   * as one piece of work, while the divider keeps the two runtimes' authorship
   * distinguishable -- which the durable record insists on.
   */
  /**
   * Set when this turn is a reply sent to another runtime than the turn
   * before it. The divider goes ABOVE the reply: the turns before it were
   * said on one runtime, this one and what follows on the other. (A running
   * mission handed over is `handoff`, drawn after the prompt instead.)
   */
  readonly switchedFrom?: TurnSwitch
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
  onOpenFile,
  onOpenPeerRun,
  earlierTurns,
  planMode = false,
  groupBoundary,
  pastBoundaries = [],
  groupLeavings = [],
  coldStart = false,
  onRunWithEdits,
  onRunAgain,
  onOpenSenderRun,
  wasPlan,
  onAnswer,
  onResume,
  resumeRefusal,
  sandbox,
  workspacePath,
  workspaceId,
  events,
  running,
  restoredMission,
  shownMissionId,
  error,
  errorIsPersistence,
  ledgerPath,
  startedAt,
  startedAtIso,
  approvals,
  onDecide,
  onAnswerQuestion,
  decidingIds,
  cancelled,
  switchedFrom,
  handoff,
  peers
}: ThreadProps): ReactElement {
  // What the run was allowed, hoisted so EVERY turn can be told -- not just
  // the newest. `no files changed` existed only on the last turn, so scrolling
  // up in a conversation showed the silence the line exists to break.
  const mayEdit = sandbox !== undefined && sandbox !== 'read-only'
  /*
   * AN EARLIER TURN'S WORK IS BUILT ONCE, not on every render.
   *
   * It depends on that turn's events, whether this run may edit, the folder
   * and the teammate -- none of which move while somebody reads, or while a
   * teammate streams anywhere in the app. Rebuilding it anyway re-derived
   * every fold, diff and file row of the whole conversation on every commit:
   * measured on Colin's largest conversation (30 turns, 11.7k nodes) at 34 ms
   * a re-render with nothing changed, more than two frames (2026-09-22).
   *
   * The SAME element object comes back while its inputs hold, and React skips
   * a subtree whose element has not changed -- the folds keep their state,
   * because nothing about them was touched.
   *
   * In order, because each turn is told what the ones before it said: the
   * plan it started from (`carriedPlan`) and the notices already carried
   * (`saidBefore`).
   */
  const earlier = useMemo(() => {
    const said = new Set<string>()
    const elements = earlierTurns.map((turn, index) => {
      const built = buildThread(turn.events, {
        running: false,
        mayEdit,
        carriedPlan: index === 0 ? [] : lastPlanOf(earlierTurns[index - 1]!.events),
        saidBefore: new Set(said),
        // Said for the latest turn and never for these, so a turn whose whole
        // reply was a message to a teammate read "ended without a reply ...
        // Sending it again usually works" the moment another turn followed
        // it -- over the message it had sent, inviting a second copy
        // (drive-brief-once, 2026-09-24, the same on 0.320).
        spokeToPeers: (turn.peerMessages ?? []).length > 0,
        ...(workspacePath === undefined ? {} : { workspacePath })
      })
      for (const key of foldNoticeKeys(built)) said.add(key)
      return (
        <ThreadItems
          items={built}
          owner={peers.self}
          activity="idle"
          workspacePath={workspacePath}
          decision={undefined}
        />
      )
    })
    return { elements, said }
  }, [earlierTurns, mayEdit, workspacePath, peers.self])
  const earlierWork = earlier.elements
  const items = buildThread(events, {
    running,
    latestTurn: true,
    // What the turn before left the plan at: see `carriedPlan`.
    carriedPlan: lastPlanOf(earlierTurns.at(-1)?.events ?? []),
    saidBefore: earlier.said,
    awaitingDecision: approvals.length > 0,
    spokeToPeers: peers.messages.length > 0,
    mayEdit,
    // Only the orb reads this: `solving` is the one of the four mapped states
    // no open tool can answer for, because planning is the turn's mode.
    planMode,
    ...(workspacePath === undefined ? {} : { workspacePath }),
    ...(startedAtIso === undefined ? {} : { startedAt: startedAtIso })
  })
  /*
   * A read-only run whose answer carries code is where "run it again, with
   * edits allowed" is worth offering -- and that is ALL it is.
   *
   * The sentence beside it used to say the runtime "could not write to the
   * workspace", on the reasoning quoted here for years: that it wrote the
   * change and was not permitted to apply it. Grok measured what that costs
   * (2026-09-14, finding 2): a plain Ask-mode question -- give me a markdown
   * link, a fenced javascript block and a table -- answered correctly, with a
   * banner underneath saying the run could not write to the workspace.
   *
   * Nothing tried to write. The person asked for an example and was told the
   * app had attempted to edit their folder and failed. The offer is still
   * right; the claim about what happened was invented. It says what is true
   * of the mode now and makes no claim about an attempt.
   *
   * Asked of the parsed reply rather than the prose, so a stray backtick
   * cannot fake it.
   */
  /*
   * A run the MODE stopped is not a run that went wrong, and the two need
   * different offers. See `modeRefusedATool`.
   */
  const refusedByMode = modeRefusedATool(error)
  const answeredWithCode = items.some(
    (item) => item.type === 'agent-message' && parseAgentText(item.text).some((block) => block.kind === 'code')
  )
  // The current turn is the last in the sequence, so its own marker is the
  // one whose index is past every earlier turn.
  const markers = threadMarkers([...earlierTurns.map((turn) => turn.events), events])
  /*
   * The group's line, and its instructions on request -- shown AS THE
   * GROUP'S: read-only here, with the way to edit going to the group's own
   * header, so nobody edits shared text believing it is their own.
   */
  // Which join notes are opened to their words, by the moment they joined:
  // one per line, because two groups' words are two different things.
  const [viewingJoins, setViewingJoins] = useState<ReadonlySet<string>>(new Set())
  const joinNote = (boundary: GroupBoundary, index: number): ReactElement => {
    const open = viewingJoins.has(boundary.joinedAt)
    return (
      <div key={`join-${boundary.joinedAt}-${String(index)}`} className="lc-thread__note lc-thread__groupnote">
        <span>
          {boundary.groupName}&apos;s instructions brief every turn from here
          {' · '}
          <button
            type="button"
            className="lc-linkbutton"
            onClick={() =>
              setViewingJoins((held) => {
                const next = new Set(held)
                if (next.has(boundary.joinedAt)) next.delete(boundary.joinedAt)
                else next.add(boundary.joinedAt)
                return next
              })
            }
          >
            {open ? 'hide' : 'view'}
          </button>
        </span>
        {open && (
          <blockquote className="lc-thread__groupwords">
            {boundary.instructions}
            <span className="lc-thread__groupedit lc-mono">edit in Group settings</span>
          </blockquote>
        )}
      </div>
    )
  }
  // Every join line, oldest first, the current membership's last: it is the
  // one still in force, so it sits nearest the turns it governs.
  const joins: readonly GroupBoundary[] = [...pastBoundaries, ...(groupBoundary === undefined ? [] : [groupBoundary])]
  const joinNotes = (test: (beforeTurn: number) => boolean) =>
    joins.filter((boundary) => test(boundary.beforeTurn)).map((boundary, index) => joinNote(boundary, index))
  // The mirror line. A leave and a join at the same index are drawn in that
  // order, which is the order they happened in.
  const leavingNotes = (test: (beforeTurn: number) => boolean) =>
    groupLeavings.filter((leaving) => test(leaving.beforeTurn)).map((leaving, index) => (
      <div key={`left-${String(leaving.beforeTurn)}-${String(index)}`} className="lc-thread__note lc-thread__groupnote lc-thread__groupnote--left">
        <span>{leaving.groupName}&apos;s instructions no longer apply from here</span>
      </div>
    ))
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
      {...(onOpenSenderRun === undefined ? {} : { onOpenSenderRun })}
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
  // The whole of it -- following, the eased walk, and the way back down --
  // now lives in `useFollowBottom`, because the room and the peer thread need
  // the same behaviour and had none of it (Colin, 2026-09-13: "lets have all
  // chats auto scroll the same way").
  const follow = useFollowBottom()

  // A mission the person just opened starts at its newest line, wherever the
  // previous one had been left. Opening a conversation JUMPS -- walking would
  // make a person watch the whole of somebody else's finished answer scroll
  // past.
  useEffect(() => {
    follow.jumpNow()
    // Identity of the conversation on screen: the recovered mission when there
    // is one, else this run's start time. Either changes exactly when the
    // person opens a different conversation, which is the moment to jump.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restoredMission?.missionId, startedAtIso])

  return (
    <div className="lc-thread" ref={follow.ref} onScroll={follow.onScroll}>
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
                <TimeMarker at={marker.at} minutesIn={marker.minutesIn} elapsed={marker.elapsed} note={marker.note} {...(marker.day === undefined ? {} : { day: marker.day })} />
              )}
              {leavingNotes((beforeTurn) => beforeTurn === index)}
              {joinNotes((beforeTurn) => beforeTurn === index)}
              {turn.switchedFrom !== undefined && <HandoffDivider {...turn.switchedFrom} />}
              {userTurn(turnPromptLine(turn), turnAttachments(turn))}
              {cardsFor(index, 'before-work').map(peerCard)}
              {earlierWork[index]}
              {cardsFor(index, 'after-work').map(peerCard)}
              {/* What that turn taught the team, under that turn. */}
              <MemoryCard lines={memoriesOfTurn(peers.memories ?? [], turn.missionId)} />
            </Fragment>
          )
        })}

        {currentMarker !== undefined && (
          <TimeMarker at={currentMarker.at} minutesIn={currentMarker.minutesIn} elapsed={currentMarker.elapsed} note={currentMarker.note} {...(currentMarker.day === undefined ? {} : { day: currentMarker.day })} />
        )}
        {leavingNotes((beforeTurn) => beforeTurn === earlierTurns.length)}
        {joinNotes((beforeTurn) => beforeTurn === earlierTurns.length)}
        {coldStart && (
          /*
           * WHERE THIS TURN BEGAN, said where the turn begins.
           *
           * Said plainly because the alternative is a person assuming the
           * model read the turn above it. The conversation is one thread; the
           * runtime's memory of it is not.
           *
           * It used to render at the very END of the thread -- after the
           * approvals, hard against the composer, which is where LIVE and
           * PENDING things live. Colin, 2026-09-14, looking at one: "is that
           * alert at the bottom about memory bc of the update, also its not
           * disappearing". Both readings were the placement's fault. It is
           * not an alert and there is nothing to dismiss: it is a durable
           * fact about where this turn started, and it belongs beside the
           * time marker that opens the turn, above the work it describes.
           */
          <div className="lc-thread__note">
            Started without the earlier messages — the turn before this one left no session to resume
          </div>
        )}

        {/*
          The seam of a reply sent to another runtime, above the reply. The
          window had no word of the switch until 0.310, so the thread ran on
          as if one runtime had answered both turns.
        */}
        {switchedFrom !== undefined && <HandoffDivider {...switchedFrom} />}
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
          {...(onOpenFile === undefined ? {} : { onOpenFile })}
          items={items}
          owner={peers.self}
          activity={liveActivityOf(events, running)}
          workspacePath={workspacePath}
          planMode={planMode}
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
        {/*
          * The CURRENT turn's memories, under the current turn -- and the
          * card is per turn now, not one at the foot of the conversation.
          * A memory learned on turn one used to be drawn under turn five,
          * which read as something the last reply had just done (Colin,
          * 2026-09-11).
          */}
        <MemoryCard lines={memoriesOfTurn(peers.memories ?? [], shownMissionId)} />
        {/* Joined after the last turn started: the NEXT turn is the first briefed, so the line sits below this one. */}
        {leavingNotes((beforeTurn) => beforeTurn > earlierTurns.length)}
        {joinNotes((beforeTurn) => beforeTurn > earlierTurns.length)}

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
            onAnswer={(answers) => onAnswerQuestion(request.approvalId, answers)}
          />
        ))}

        {stopped !== undefined && <CancellationCard summary={stopped} stoppedAt={stoppedAt} />}

        {/*
          * A MODE REFUSAL IS ONE CARD, NOT TWO (beta review of 0.255.0, #8).
          *
          * It drew a "Run again with edits allowed" line and then, under it,
          * a red "The run could not continue" card that said the same thing
          * again and ended on the runtime's raw `permission requested: bash
          * ... auto-rejecting`. A safety boundary doing its job read as two
          * failures, with the remedy above the problem. The refusal below
          * now carries the runtime's own words in a fold instead.
          */}
        {error !== undefined && !refusedByMode && !errorAlreadyShown(items, error) && (
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

        {/* After the card that says what happened: the problem, then the remedy. */}
        {onRunWithEdits !== undefined && (wasPlan === true || answeredWithCode || refusedByMode) && (
          // Deliberately not an error: the run did exactly what its mode
          // allows. This is the one click that would otherwise be a mode
          // change and a retyped prompt. A plan run says so in its own
          // words -- the point of planning is that carrying it out is the
          // next, separate decision.
          <div className="lc-rerun">
            <span>
              {wasPlan === true
                ? 'This is the plan, not the work: nothing in the workspace has changed.'
                : refusedByMode
                  ? 'Ask mode does not change files, so this run stopped rather than write one. Nothing in the workspace has changed.'
                  : 'Ask mode answers in the conversation, so this stayed in the reply. Nothing in the workspace has changed.'}
            </span>
            <button type="button" className="lc-button" onClick={onRunWithEdits}>
              <Icon name="diff" size={13} /> {wasPlan === true ? 'Build this plan' : 'Run again with edits allowed'}
            </button>
            {refusedByMode && error !== undefined && (
              <details className="lc-rerun__said">
                <summary>What the runtime said</summary>
                <p>{error}</p>
              </details>
            )}
          </div>
        )}

        {/*
          * NOT offered when the mode is what refused it. Sol's beta finding
          * 3: pressing this would hit the same boundary, correctly, for
          * ever -- and the sentence beside it ("running this again cannot
          * repeat anything") is a button admitting it does nothing. The
          * offer that belongs there is the mode switch above.
          */}
        {onRunAgain !== undefined && !refusedByMode && (
          /*
           * One press, where retyping was the only way forward.
           *
           * Offered ONLY where the runtime never started -- no session, no
           * tool, nothing touched -- so pressing this cannot repeat work.
           * A run that got as far as doing something is deliberately not
           * offered it: whether the half it did matters is the person's
           * call, and the app does not get to make it for them.
           *
           * The case that produced this is a Cursor start failing on its own
           * config file while a second copy of it held that file open
           * (Colin, 2026-09-14). It is transient, it is not his fault, and
           * the message he had typed was still right.
           */
          <div className="lc-rerun">
            <span>Nothing had started, so running this again cannot repeat anything.</span>
            <button type="button" className="lc-button" onClick={onRunAgain}>
              <Icon name="play" size={13} /> Run it again
            </button>
          </div>
        )}

        {/*
          An interrupted mission kept everything needed to carry on and, until
          now, offered no way to. The offer sits ABOVE the receipt: the receipt
          is the record, this is the thing to do about it.
        */}
        {restoredMission !== undefined && onResume !== undefined && (
          <ResumeCard offer={resumeOffer(restoredMission)} onResume={onResume} busy={running} {...(resumeRefusal === undefined ? {} : { refusal: resumeRefusal })} />
        )}
        {restoredMission !== undefined && (
          <ReceiptCard
            mission={restoredMission}
            workspacePath={workspacePath}
            {...(workspaceId === undefined ? {} : { workspaceId })}
          />
        )}
      </div>
      <JumpToBottom shown={follow.away} onClick={follow.toBottom} />
    </div>
  )
}
