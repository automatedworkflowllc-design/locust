import type { ReactElement } from 'react'

import type { MissionApprovalDecision, MissionApprovalRequest } from '../../../shared/ipc.js'
import { dataSentLine } from '../../../shared/approval-data.js'
import { Icon } from './Icon.js'
import { DiffView } from './DiffView.js'
import { fileCounts, parseUnifiedDiff } from '../diff.js'

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
  busy
}: {
  readonly request: MissionApprovalRequest
  readonly onDecide: (decision: MissionApprovalDecision) => void
  readonly busy: boolean
}): ReactElement {
  const isQuestion = request.kind === 'question'
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
        <span className="lc-rail__meta">Codex CLI · this workspace</span>
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
    </div>
  )
}
