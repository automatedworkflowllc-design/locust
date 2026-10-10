import type { ReactElement } from 'react'

import type { PullRequestNews } from '../../../shared/pull-request.js'

/**
 * What changed about the watched pull request, above the message box (0.731, shared/pull-request.ts). When it is
 * something a teammate could fix, one press writes the ask into the box -- the person still presses Send, so a
 * watch never spends on its own.
 */
export function PullRequestNewsBanner({
  news,
  teammateName,
  onAsk,
  onOpen,
  onDismiss
}: {
  readonly news: PullRequestNews
  readonly teammateName: string | undefined
  readonly onAsk: (text: string) => void
  readonly onOpen: (url: string) => void
  readonly onDismiss: () => void
}): ReactElement {
  return (
    <div className={`lc-notice lc-prnews${news.needsWork ? ' is-work' : ' is-plain'}`} role="status" aria-live="polite">
      <span className="lc-prnews__said">
        Pull request #{news.number}: {news.said}.
      </span>
      <span className="lc-prnews__actions">
        {news.needsWork && (
          <button type="button" className="lc-button" onClick={() => onAsk(pullRequestAsk(news))}>
            {teammateName === undefined ? 'Ask to fix it' : `Ask ${teammateName} to fix it`}
          </button>
        )}
        <button type="button" className="lc-button" onClick={() => onOpen(news.url)}>
          Open on GitHub
        </button>
        <button type="button" className="lc-ghostbutton" onClick={onDismiss} aria-label="Dismiss">
          Dismiss
        </button>
      </span>
    </div>
  )
}

/** The words the ask puts in the box, for the person to send or change. */
export function pullRequestAsk(news: PullRequestNews): string {
  return `Pull request #${String(news.number)} (${news.url}): ${news.said}. Look at what is wrong, fix it on this branch, and push the fix.`
}
