import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'

import type { PublicBranchReview } from '../../../shared/ipc.js'
import { fileCounts, parseUnifiedDiff } from '../diff.js'
import { agoLabel } from '../teammateWork.js'
import { DiffView } from './DiffView.js'
import { Icon } from './Icon.js'

/**
 * REVIEW CHANGES (0.439): a teammate's own branch, seen as a whole.
 *
 * Colin picked idea #2 of PRODUCT-SUGGESTIONS-2026-09-28: each turn on Own
 * branch is committed to `locust/<name>` (turn-checkpoint.ts), and this is
 * the first of the three buttons on top -- the branch against where it left
 * the person's branch, whole or turn by turn, in the diff view the thread
 * already has. It only reads: undo and landing come after.
 */
export function ReviewChanges({
  teammate,
  onClose
}: {
  readonly teammate: { readonly teammateId: string; readonly name: string }
  readonly onClose: () => void
}): ReactElement {
  const [review, setReview] = useState<PublicBranchReview>()
  const [problem, setProblem] = useState<string>()
  /** The whole change, or one turn by its sha. */
  const [showing, setShowing] = useState<string>('whole')
  const [turnText, setTurnText] = useState<{ readonly sha: string; readonly diff: string }>()
  const [refreshed, setRefreshed] = useState(0)

  useEffect(() => {
    const bridge = window.desktop
    if (bridge === undefined) return
    let current = true
    setProblem(undefined)
    void bridge.reviewBranch(teammate.teammateId).then((answer) => {
      if (!current) return
      if (answer.ok) setReview(answer.data)
      else setProblem(answer.error.message)
    }).catch(() => current && setProblem('The branch could not be read. Nothing on it was changed.'))
    return () => {
      current = false
    }
  }, [teammate.teammateId, refreshed])

  useEffect(() => {
    const bridge = window.desktop
    if (bridge === undefined || showing === 'whole' || turnText?.sha === showing) return
    let current = true
    void bridge.turnDiff(teammate.teammateId, showing).then((answer) => {
      if (!current) return
      if (answer.ok) setTurnText({ sha: showing, diff: answer.data.diff })
      else setProblem(answer.error.message)
    }).catch(() => current && setProblem('That turn could not be read. The branch is as it was.'))
    return () => {
      current = false
    }
  }, [teammate.teammateId, showing, turnText?.sha])

  const text = showing === 'whole' ? review?.diff : turnText?.sha === showing ? turnText.diff : undefined
  const files = text === undefined ? [] : parseUnifiedDiff(text)
  const turns = review?.turns ?? []

  return (
    <aside className="lc-viewer" aria-label="Review changes">
      <div className="lc-viewer__head">
        <Icon name="diff" size={14} />
        <span className="lc-beside__who">
          <span className="lc-viewer__name">Review {teammate.name}'s changes</span>
          <span className="lc-beside__title lc-mono">
            {review === undefined ? 'Reading the branch…' : `${review.branch}${review.against === undefined ? '' : ` against ${review.against}`}`}
          </span>
        </span>
        <span className="lc-viewer__spacer" />
        <button type="button" className="lc-viewer__action" aria-label="Read it again" title="Read the branch again" onClick={() => setRefreshed((count) => count + 1)}>
          <Icon name="refresh" size={13} />
        </button>
        <button type="button" className="lc-viewer__close" aria-label="Close" title="Close" onClick={onClose}>
          <Icon name="close" size={13} />
        </button>
      </div>
      <div className="lc-review__body">
        {problem !== undefined && <p className="lc-review__note is-warn" role="status">{problem}</p>}
        {review !== undefined && (
          <>
            <p className="lc-review__note">
              {turns.length === 0
                ? `Nothing saved on ${review.branch} yet. Each turn ${teammate.name} finishes is saved there as it ends.`
                : `${String(turns.length)} ${turns.length === 1 ? 'turn' : 'turns'} saved on ${review.branch} since it left ${review.against ?? 'your checkout'}. Nothing here is in your branch until you merge it.`}
            </p>
            {review.uncommitted.length > 0 && (
              <p className="lc-review__note is-warn" role="status">
                Not saved on the branch yet ({String(review.uncommitted.length)}): {review.uncommitted.slice(0, 5).join(', ')}
                {review.uncommitted.length > 5 ? ` and ${String(review.uncommitted.length - 5)} more` : ''}. A turn may still be running, or these were edited by hand.
              </p>
            )}
            {turns.length > 0 && (
              <div className="lc-review__turns" role="tablist" aria-label="What to show">
                <button
                  type="button"
                  role="tab"
                  aria-selected={showing === 'whole'}
                  className={`lc-review__turn${showing === 'whole' ? ' is-active' : ''}`}
                  onClick={() => setShowing('whole')}
                >
                  <span className="lc-review__subject">The whole change</span>
                  <span className="lc-review__meta lc-mono">{String(new Set(turns.flatMap((turn) => turn.files)).size)} files</span>
                </button>
                {turns.map((turn, index) => (
                  <button
                    key={turn.sha}
                    type="button"
                    role="tab"
                    aria-selected={showing === turn.sha}
                    className={`lc-review__turn${showing === turn.sha ? ' is-active' : ''}`}
                    title={`${turn.sha.slice(0, 12)}: ${turn.files.join(', ')}`}
                    onClick={() => setShowing(turn.sha)}
                  >
                    <span className="lc-review__subject">
                      <span className="lc-review__index lc-mono">{String(index + 1)}</span> {turn.subject}
                    </span>
                    <span className="lc-review__meta lc-mono">
                      {String(turn.files.length)} {turn.files.length === 1 ? 'file' : 'files'}
                      {agoLabel(turn.at) === undefined ? '' : ` · ${agoLabel(turn.at) ?? ''}`}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {showing === 'whole' && review.diff === undefined && turns.length > 0 && (
              <p className="lc-review__note">The whole change is too large to show at once. Pick a turn to see it turn by turn.</p>
            )}
            {text !== undefined && text.trim().length === 0 && turns.length > 0 && (
              <p className="lc-review__note">No difference in text: the change is only to file modes or binary files.</p>
            )}
            <div className="lc-review__files">
              {files.map((file) => {
                const counts = fileCounts(file)
                return (
                  <section key={`${showing}:${file.path}`} aria-label={file.path}>
                    <div className="lc-review__path lc-mono">
                      <span className="lc-review__name">{file.path}</span>
                      {file.status !== 'MODIFIED' && <span className="lc-review__status">{file.status.toLowerCase()}</span>}
                      <span className="lc-diff__addmark">+{counts.added}</span> <span className="lc-diff__delmark">−{counts.removed}</span>
                    </div>
                    <DiffView file={file} truncated={false} reported={undefined} />
                  </section>
                )
              })}
            </div>
          </>
        )}
      </div>
    </aside>
  )
}
