import { useState } from 'react'
import type { ReactElement } from 'react'

import type { MissionApprovalDecision, MissionApprovalRequest, MissionQuestion } from '../../../shared/ipc.js'
import { runtimeDisplayName } from '../../../shared/runtimes.js'
import { dataSentLine } from '../../../shared/approval-data.js'
import { Icon } from './Icon.js'
import { DiffView } from './DiffView.js'
import { fileCounts, parseUnifiedDiff } from '../diff.js'


/**
 * A question, answered rather than authorized.
 *
 * The protocol files answers under each question's OWN id, and identifies a
 * chosen option by its LITERAL LABEL -- options carry no id and no index, and
 * the server matches the strings it gets back against the labels it sent. So
 * the label is what travels, and sending "3" for the third option answers with
 * the string "3".
 *
 * There is deliberately no "Always allow this session" here. The server has no
 * session-grant field for a question; offering one promised something the
 * protocol has no way to mean.
 */
function QuestionForm({
  questions,
  onAnswer,
  busy
}: {
  readonly questions: readonly MissionQuestion[]
  readonly onAnswer: (answers: Readonly<Record<string, readonly string[]>>) => void
  readonly busy: boolean
}): ReactElement {
  const [chosen, setChosen] = useState<Readonly<Record<string, string>>>({})
  const [typed, setTyped] = useState<Readonly<Record<string, string>>>({})

  const answersFor = (question: MissionQuestion): readonly string[] => {
    const values: string[] = []
    const pick = chosen[question.id]
    if (pick !== undefined) values.push(pick)
    const free = (typed[question.id] ?? '').trim()
    if (free.length > 0) values.push(free)
    return values
  }
  // Every question, or none: a partial answer is a question silently dropped,
  // and the model is told nothing rather than told less.
  const ready = questions.every((question) => answersFor(question).length > 0)

  return (
    <div className="lc-questions">
      {questions.map((question) => (
        <div key={question.id} className="lc-question">
          {question.header !== null && question.header.length > 0 && (
            <p className="lc-question__header lc-mono">{question.header}</p>
          )}
          <p className="lc-question__text">{question.question}</p>
          {question.options.length > 0 && (
            <div className="lc-question__options" role="radiogroup" aria-label={question.question}>
              {question.options.map((option) => (
                <button
                  key={option.label}
                  type="button"
                  role="radio"
                  aria-checked={chosen[question.id] === option.label}
                  className={`lc-question__option${chosen[question.id] === option.label ? ' is-chosen' : ''}`}
                  disabled={busy}
                  onClick={() => setChosen((current) => ({ ...current, [question.id]: option.label }))}
                >
                  <span className="lc-question__label">{option.label}</span>
                  {option.description !== null && option.description.length > 0 && (
                    <span className="lc-question__desc">{option.description}</span>
                  )}
                </button>
              ))}
            </div>
          )}
          {/* Free text where the question takes it: no options at all, or
              `isOther`, which is the protocol saying an unlisted answer is
              allowed. A secret answer is never echoed to the screen. */}
          {(question.options.length === 0 || question.isOther) && (
            <input
              className="lc-question__free"
              type={question.isSecret ? 'password' : 'text'}
              value={typed[question.id] ?? ''}
              disabled={busy}
              aria-label={question.options.length === 0 ? question.question : 'Something else'}
              placeholder={question.options.length === 0 ? 'Your answer' : 'Something else…'}
              onChange={(event) => setTyped((current) => ({ ...current, [question.id]: event.target.value }))}
            />
          )}
        </div>
      ))}
      <div className="lc-approval__actions">
        <button
          type="button"
          className="lc-primarybutton"
          disabled={busy || !ready}
          onClick={() => {
            const answers: Record<string, readonly string[]> = {}
            for (const question of questions) answers[question.id] = answersFor(question)
            onAnswer(answers)
          }}
        >
          {questions.length > 1 ? 'Send answers' : 'Send answer'}
        </button>
      </div>
      <p className="lc-approval__note">
        {/* No "Always": a question has no session grant in the protocol, and a
            button that cannot mean what it says is worse than one fewer. */}
        This goes back to the runtime as your answer. Stop the run below if you
        would rather not answer.
      </p>
    </div>
  )
}

/**
 * The approval card.
 *
 * The design's rule for this surface is that it must answer four questions
 * before anyone can reasonably say yes: what would happen, where, whether it
 * can be undone, and who is asking. Everything shown here comes from the
 * runtime's own request -- when it did not say what it wants to do, the card
 * says THAT rather than filling the gap with a friendly summary.
 */
export function ApprovalCard({
  request,
  onDecide,
  onAnswer,
  busy
}: {
  readonly request: MissionApprovalRequest
  readonly onDecide: (decision: MissionApprovalDecision) => void
  /**
   * Answer a QUESTION, keyed by question id.
   *
   * Separate from `onDecide` because the two are different acts with different
   * payloads: an action is authorized, a question is answered. Sending a
   * decision for a question is what discarded the person's reply -- the server
   * cannot deserialize it, so it substituted an empty answer and told the model
   * they had said nothing.
   */
  readonly onAnswer: (answers: Readonly<Record<string, readonly string[]>>) => void
  readonly busy: boolean
}): ReactElement {
  const isQuestion = request.kind === 'question'
  const questions = request.questions ?? []
  // The change itself, when Codex sent it with the item (parity row 32).
  // Drawn with the same viewer the activity fold uses, so an approval and
  // its record read the same.
  const files = request.patch === undefined ? [] : parseUnifiedDiff(request.patch.text)
  // What would LEAVE this machine -- the question the card never answered, and
  // the only one of the four a person cannot work out for themselves. Claimed
  // as "nothing" for a file change, where that is provable, and never for a
  // command, where it is not. See shared/approval-data.ts.
  const dataSent = dataSentLine(request.kind, request.detail)
  const reversible =
    request.kind === 'command'
      ? 'Unknown — a command can do anything the workspace sandbox allows.'
      : request.kind === 'file-change'
        ? 'Yes for tracked files, if the workspace is under version control.'
        : request.kind === 'connector'
          ? 'Unknown — a connector acts on the service it reaches, and Locust cannot undo what happens there.'
          : 'Nothing is changed by answering.'

  // A card that waits on the person is brought into view when it appears.
  // Its buttons sat below the fold while the run said "waiting on you"
  // (seen driving the app, 2026-09-05).
  /*
   * This card no longer scrolls itself into view, and the thread does it.
   *
   * It used to call `scrollIntoView` on mount and again 300ms later, which
   * fixed a real defect -- its buttons sat under the composer while the run
   * said "waiting on you" (drive, 2026-09-05). But it moved the viewport
   * UNCONDITIONALLY, so a second approval in one run, or one arriving while
   * the person was scrolled up reading an earlier diff, took the screen away
   * mid-sentence. Flagged by the design agent, 2026-09-08.
   *
   * Guarding it with "only if they are at the bottom" does not work here
   * either: the card itself adds the height, so by the time this effect runs
   * the answer is always no. The thread's own follow (`stickToBottom.ts`)
   * remembers where the person was BEFORE the content grew, which is the only
   * place that question can be answered honestly -- and it scrolls to the very
   * bottom, so the buttons are in view for exactly the case the original fix
   * was for. One mechanism, in the one place that has the facts.
   */
  return (
    <div className="lc-card is-pending is-amber" role="group" aria-label="Approval required">
      <div className="lc-card__head">
        <span className="lc-approval__title">
          <Icon name="shield" size={13} />{' '}
          {isQuestion ? 'The runtime is asking you something' : 'Approval required — exact action'}
        </span>
        {/*
          * The header used to read "Codex CLI · this workspace" as a constant,
          * which contradicted the card's own Where row four lines down: on a
          * worktree teammate that row shows the worktree path while this said
          * "this workspace". A card whose two halves disagree about where an
          * action would happen is worse than one that says less, so when the
          * request names a folder the header defers to the Where row rather
          * than restating it wrongly.
          */}
        {/* Named by the request, not assumed: a Claude Code connector
            permission wore "Codex CLI" in its first drive (2026-09-10). */}
        <span className="lc-rail__meta">
          {runtimeDisplayName(request.runtime ?? 'codex')}
          {request.cwd === null ? ' · this workspace' : ''}
        </span>
      </div>

      <dl className="lc-receipt">
        <dt>Action</dt>
        <dd>{request.summary}</dd>
        {request.detail.length > 0 && (
          <>
            <dt>{isQuestion ? 'Question' : 'Exact'}</dt>
            <dd className="lc-mono lc-approval__detail">{request.detail}</dd>
          </>
        )}
        <dt>Where</dt>
        <dd className="lc-mono">{request.cwd ?? 'the mission workspace'}</dd>
        {dataSent !== undefined && (
          <>
            <dt>Data sent</dt>
            <dd>{dataSent}</dd>
          </>
        )}
        {!isQuestion && (
          <>
            <dt>Reversible</dt>
            <dd>{reversible}</dd>
          </>
        )}
      </dl>

      {request.patch !== undefined && (
        <div className="lc-approval__patch">
          <div className="lc-approval__patchhead lc-mono">
            <span>The change, as Codex would apply it</span>
            <span className="lc-activity__counts">
              <span className="lc-diff__addmark">+{request.patch.added}</span>
              <span className="lc-diff__delmark">−{request.patch.removed}</span>
            </span>
          </div>
          {files.length === 0 ? (
            <p className="lc-settings__note">Codex sent a change this build could not read as a diff.</p>
          ) : (
            files.map((file) => (
              <div key={file.path} className="lc-approval__file">
                {/* The viewer draws hunks; the file they belong to is said here. */}
                <div className="lc-filerow is-static">
                  <Icon name="file" size={14} />
                  <span className="lc-filerow__path">{file.path}</span>
                  <span className="lc-filerow__status">{file.status}</span>
                </div>
                <DiffView file={file} truncated={request.patch!.truncated} reported={request.patch!.truncated ? { added: request.patch!.added, removed: request.patch!.removed } : fileCounts(file)} />
              </div>
            ))
          )}
        </div>
      )}

      {/*
        * A question is ANSWERED; an action is authorized. They were the same
        * three buttons, and for a question all three were malformed -- the
        * server could not deserialize a decision as an answer, so it logged the
        * failure, substituted an empty answer map, and told the model the
        * person had said nothing. Whatever they picked went nowhere.
        *
        * `questions` is present only when the request carried them, so a
        * question this build cannot read still falls through to the
        * authorization controls rather than drawing a form with no fields.
        */}
      {isQuestion && questions.length > 0 ? (
        <QuestionForm questions={questions} onAnswer={onAnswer} busy={busy} />
      ) : (
        <>
          <div className="lc-approval__actions">
            <button
              type="button"
              className="lc-primarybutton"
              disabled={busy}
              onClick={() => onDecide('approve-once')}
            >
              {isQuestion ? 'Allow once' : 'Approve once'}
            </button>
            <button type="button" className="lc-ghostbutton" disabled={busy} onClick={() => onDecide('approve-always')}>
              Always allow this session
            </button>
            <button type="button" className="lc-denybutton" disabled={busy} onClick={() => onDecide('deny')}>
              Deny
            </button>
          </div>
          <p className="lc-approval__note">
            {/*
              "Always" is scoped to this session on purpose, and says so. A grant
              that outlives the run is a Settings decision, not one to take here.
            */}
            Nothing has happened yet. “Always” lasts until this mission ends.
          </p>
        </>
      )}
    </div>
  )
}
