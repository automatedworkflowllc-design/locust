import { useCallback, useEffect, useState } from 'react'
import type { ReactElement } from 'react'

import { pullRequestLine } from '../../../shared/pull-request.js'
import type { FolderPullRequest } from '../../../shared/pull-request.js'
import { GitHubMark } from './GitHubAccount.js'

/**
 * THE FOLDER'S PULL REQUEST, IN THE HEADER (0.720, shared/pull-request.ts).
 *
 * Shown only while the branch the folder is on has a pull request on GitHub:
 * its number, its state, and a dot for its checks; the whole line on hover;
 * press it and it opens on GitHub. Read when the conversation is shown, when
 * a run ends and when the window comes back, like Commit: never on a timer.
 */
export function PullRequestChip({ running }: { readonly running: boolean }): ReactElement | null {
  const [pr, setPr] = useState<FolderPullRequest>()
  const read = useCallback(async (): Promise<void> => {
    setPr(await window.desktop?.folderPullRequest().catch(() => undefined))
  }, [])
  useEffect(() => {
    if (running) return
    void read()
    const again = (): void => void read()
    window.addEventListener('focus', again)
    return () => window.removeEventListener('focus', again)
  }, [running, read])
  return pr === undefined ? null : <PullRequestChipView pr={pr} />
}

/** The chip itself, from the pull request: what a test draws. */
export function PullRequestChipView({ pr }: { readonly pr: FolderPullRequest }): ReactElement {
  const line = pullRequestLine(pr)
  const tone = pr.state === 'merged' ? 'blue' : pr.state === 'closed' || pr.state === 'draft' ? 'muted' : pr.checks === 'failing' ? 'red' : pr.checks === 'pending' ? 'amber' : 'green'
  return (
    <button
      type="button"
      className="lc-button lc-prchip"
      data-state={pr.state}
      data-checks={pr.checks}
      title={`Pull request #${String(pr.number)}: ${pr.title}\n${line}\nOpens on GitHub`}
      aria-label={`Pull request ${String(pr.number)}, ${line}. Opens on GitHub.`}
      onClick={() => void window.desktop?.openLink(pr.url).catch(() => undefined)}
    >
      <GitHubMark size={13} />
      <span className="lc-prchip__number">#{pr.number}</span>
      <span className={`lc-prchip__dot lc-tone-${tone}`} aria-hidden="true" />
      <span className="lc-prchip__state">{line.split(' · ')[0]}</span>
    </button>
  )
}
