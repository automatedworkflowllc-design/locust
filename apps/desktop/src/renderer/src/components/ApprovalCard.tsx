import type { ReactElement } from 'react'

import type { MissionApprovalDecision, MissionApprovalRequest } from '../../../shared/ipc.js'
import { Icon } from './Icon.js'

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
  const reversible =
    request.kind === 'command'
      ? 'Unknown — a command can do anything the workspace sandbox allows.'
      : request.kind === 'file-change'
        ? 'Yes for tracked files, if the workspace is under version control.'
        : 'Nothing is changed by answering.'

  return (
    <div className="lc-card is-amber" role="group" aria-label="Approval required">
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
        {!isQuestion && (
          <>
            <dt>Reversible</dt>
            <dd>{reversible}</dd>
          </>
        )}
      </dl>

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
