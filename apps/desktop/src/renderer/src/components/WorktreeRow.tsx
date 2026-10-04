import { useState } from 'react'
import type { ReactElement } from 'react'

import type { PublicWorktree } from '../../../shared/ipc.js'

/** What removing a worktree answered: nothing when it went, otherwise why not. */
export interface WorktreeRemoval {
  readonly message: string
  /** C1: the uncommitted changes removing it would delete, when that is why. */
  readonly changes?: readonly string[]
}

/** How many changed files the confirmation names before it counts the rest. */
const NAMED = 6

/**
 * One teammate's own branch in Settings, and its Remove (C1).
 *
 * Remove was one click, voided its answer, and the host forced the removal
 * -- so a teammate's uncommitted work was deleted under "Removing one keeps
 * its branch", and nothing was said. Now the host refuses a copy with
 * changes and names them; this row shows them and asks, in words that say
 * what is lost, before it sends the same list back as the agreement. Any
 * other answer -- a live run, a git failure -- is shown, not dropped.
 */
export function WorktreeRow({
  tree,
  onRemove
}: {
  readonly tree: PublicWorktree
  readonly onRemove: (teammateId: string, discard?: readonly string[]) => Promise<WorktreeRemoval | undefined>
}): ReactElement {
  const [answer, setAnswer] = useState<WorktreeRemoval>()
  const [working, setWorking] = useState(false)
  const who = tree.teammateName ?? tree.teammateId
  const remove = async (discard?: readonly string[]): Promise<void> => {
    setWorking(true)
    try {
      setAnswer(await onRemove(tree.teammateId, discard))
    } finally {
      setWorking(false)
    }
  }
  const changes = answer?.changes
  const named = changes?.slice(0, NAMED) ?? []
  const more = (changes?.length ?? 0) - named.length

  return (
    <div className="lc-worktreerow" data-teammate={tree.teammateId}>
      <span className="lc-worktreerow__who">{who}</span>
      <span className="lc-worktreerow__branch lc-mono" title={tree.path}>{tree.branch}</span>
      {changes === undefined ? (
        <button
          type="button"
          className="lc-ghostbutton"
          disabled={tree.busy || working}
          title={tree.busy ? 'A run is live in this worktree' : `Remove the worktree; the branch ${tree.branch} stays`}
          onClick={() => void remove()}
        >
          {tree.busy ? 'In use' : 'Remove'}
        </button>
      ) : (
        <span className="lc-worktreerow__confirm" role="group" aria-label={`Remove ${who}'s copy`}>
          <button type="button" className="lc-ghostbutton" disabled={working} onClick={() => setAnswer(undefined)}>
            Keep it
          </button>
          <button type="button" className="lc-ghostbutton lc-ghostbutton--danger" disabled={working} onClick={() => void remove(changes)}>
            Delete the changes and remove
          </button>
        </span>
      )}
      {answer !== undefined && (
        <p className="lc-worktreerow__note" role={changes === undefined ? 'alert' : 'status'}>
          {changes === undefined
            ? answer.message
            : `${who}'s copy has ${String(changes.length)} uncommitted ${changes.length === 1 ? 'change that is' : 'changes that are'} not on ${tree.branch}: ${named.join(', ')}${more > 0 ? `, and ${String(more)} more` : ''}. Removing it deletes ${changes.length === 1 ? 'it' : 'them'} for good.`}
        </p>
      )}
    </div>
  )
}
