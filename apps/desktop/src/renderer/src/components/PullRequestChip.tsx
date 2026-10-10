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
/** The pull requests this computer watches, by address (0.731): a per-person convenience, kept in the window. */
const WATCHED = 'locust.watchedPullRequests'
const watchedHere = (): readonly string[] => {
  try {
    const kept = JSON.parse(window.localStorage.getItem(WATCHED) ?? '[]') as unknown
    return Array.isArray(kept) ? kept.filter((url): url is string => typeof url === 'string').slice(0, 50) : []
  } catch {
    return []
  }
}
const keepWatched = (urls: readonly string[]): void => {
  try {
    window.localStorage.setItem(WATCHED, JSON.stringify(urls.slice(0, 50)))
  } catch {
    // A window that cannot keep it still watches until it closes.
  }
}

export function PullRequestChip({ running }: { readonly running: boolean }): ReactElement | null {
  const [pr, setPr] = useState<FolderPullRequest>()
  const [watching, setWatching] = useState(false)
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
  // A pull request watched before is watched again when it shows (0.731).
  useEffect(() => {
    if (pr === undefined || (pr.state !== 'open' && pr.state !== 'draft')) {
      setWatching(false)
      return
    }
    if (watchedHere().includes(pr.url)) void window.desktop?.watchPullRequest(pr.url, true).then(setWatching, () => setWatching(false))
    else setWatching(false)
  }, [pr?.url, pr?.state])
  const toggle = (): void => {
    if (pr === undefined) return
    const on = !watching
    keepWatched(on ? [pr.url, ...watchedHere().filter((url) => url !== pr.url)] : watchedHere().filter((url) => url !== pr.url))
    void window.desktop?.watchPullRequest(pr.url, on).then(setWatching, () => setWatching(false))
  }
  if (pr === undefined) return null
  return (
    <>
      <PullRequestChipView pr={pr} />
      {(pr.state === 'open' || pr.state === 'draft') && <PullRequestWatchToggle watching={watching} onToggle={toggle} />}
    </>
  )
}

/** Watch the pull request: Locust looks every few minutes and says when a check fails, a review lands or it conflicts. */
export function PullRequestWatchToggle({ watching, onToggle }: { readonly watching: boolean; readonly onToggle: () => void }): ReactElement {
  return (
    <button
      type="button"
      className={`lc-button lc-prwatch${watching ? ' is-on' : ''}`}
      aria-pressed={watching}
      title={watching ? 'Watching: Locust looks every few minutes and says when a check fails, a review lands or it conflicts. Press to stop.' : 'Watch it: Locust looks every few minutes and says when a check fails, a review lands or it conflicts.'}
      onClick={onToggle}
    >
      {watching ? 'Watching' : 'Watch'}
    </button>
  )
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
