/**
 * THE FOLDER'S PULL REQUEST, IN THE CONVERSATION'S HEADER (0.720).
 *
 * t3code shows a thread's pull request -- open, merged, its checks -- where
 * the work is. Locust could open one (Commit and open a pull request) and
 * then said nothing more about it. Now, while the folder's branch has a pull
 * request on GitHub, the header says which, whether it is open, draft,
 * merged or closed, and how its checks stand; pressing it opens it.
 *
 * Read with the person's own `gh pr view --json` for the branch the folder is
 * on, the same GitHub CLI Commit uses. The shapes are gh 2.96.0's, MEASURED
 * 2026-10-10 on a public repository's pull requests: `statusCheckRollup` holds
 * CheckRuns (status, conclusion) and StatusContexts (state).
 */

export const FOLDER_PULL_REQUEST_CHANNEL = 'folder:pull-request'

/** The fields asked of gh, in its own names. */
export const PULL_REQUEST_FIELDS = 'number,title,url,state,isDraft,statusCheckRollup,reviewDecision,mergeable'

export type PullRequestState = 'open' | 'draft' | 'merged' | 'closed'
export type PullRequestChecks = 'passing' | 'failing' | 'pending' | 'none'

export interface FolderPullRequest {
  readonly number: number
  readonly title: string
  readonly url: string
  readonly state: PullRequestState
  readonly checks: PullRequestChecks
  /** How many checks there are, and how many have not passed (failed, or not yet finished). */
  readonly checkCount: number
  readonly notPassed: number
  readonly review?: 'approved' | 'changes-requested' | 'review-required'
  /** GitHub says it cannot merge into its base as it stands (`mergeable: CONFLICTING`, 0.731). */
  readonly conflicts?: true
}

const FAILED = new Set(['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'ERROR'])
const PASSED = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED'])

/** One check, as passed, failed or still going. */
function checkOf(check: Record<string, unknown>): 'passed' | 'failed' | 'pending' {
  if (check.__typename === 'StatusContext') {
    const state = String(check.state ?? '')
    return PASSED.has(state) ? 'passed' : FAILED.has(state) ? 'failed' : 'pending'
  }
  if (check.status !== 'COMPLETED') return 'pending'
  const conclusion = String(check.conclusion ?? '')
  return PASSED.has(conclusion) ? 'passed' : FAILED.has(conclusion) ? 'failed' : 'pending'
}

/** `gh pr view --json <PULL_REQUEST_FIELDS>` -> the pull request, or undefined when it is not one. */
export function pullRequestOf(json: string): FolderPullRequest | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const pr = parsed as Record<string, unknown>
  const number = typeof pr.number === 'number' && Number.isInteger(pr.number) && pr.number > 0 ? pr.number : undefined
  const url = typeof pr.url === 'string' && /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/.test(pr.url) ? pr.url : undefined
  if (number === undefined || url === undefined) return undefined
  const raw = String(pr.state ?? '').toUpperCase()
  const state: PullRequestState = raw === 'MERGED' ? 'merged' : raw === 'CLOSED' ? 'closed' : pr.isDraft === true ? 'draft' : 'open'
  const checks = (Array.isArray(pr.statusCheckRollup) ? pr.statusCheckRollup : []).filter(
    (one): one is Record<string, unknown> => typeof one === 'object' && one !== null
  )
  const read = checks.map(checkOf)
  const failed = read.filter((one) => one === 'failed').length
  const pending = read.filter((one) => one === 'pending').length
  const review =
    pr.reviewDecision === 'APPROVED' ? 'approved' : pr.reviewDecision === 'CHANGES_REQUESTED' ? 'changes-requested' : pr.reviewDecision === 'REVIEW_REQUIRED' ? 'review-required' : undefined
  return {
    number,
    title: typeof pr.title === 'string' ? pr.title.replace(/\s+/g, ' ').trim().slice(0, 200) : '',
    url,
    state,
    checks: read.length === 0 ? 'none' : failed > 0 ? 'failing' : pending > 0 ? 'pending' : 'passing',
    checkCount: read.length,
    notPassed: failed + pending,
    ...(review === undefined ? {} : { review }),
    ...(pr.mergeable === 'CONFLICTING' ? { conflicts: true as const } : {})
  }
}

const STATE_WORD: Record<PullRequestState, string> = { open: 'Open', draft: 'Draft', merged: 'Merged', closed: 'Closed' }

/** "Open · checks passing", "Merged", "Draft · 2 of 9 checks failing". */
export function pullRequestLine(pr: FolderPullRequest): string {
  const parts = [STATE_WORD[pr.state]]
  // A merged or closed one's checks are history.
  if (pr.state === 'open' || pr.state === 'draft') {
    if (pr.checks === 'passing') parts.push(pr.checkCount === 1 ? 'its check passed' : `all ${String(pr.checkCount)} checks passed`)
    else if (pr.checks === 'failing') parts.push(`${String(pr.notPassed)} of ${String(pr.checkCount)} checks not passed`)
    else if (pr.checks === 'pending') parts.push('checks running')
    if (pr.review === 'approved') parts.push('approved')
    else if (pr.review === 'changes-requested') parts.push('changes requested')
  }
  return parts.join(' · ')
}

/**
 * A WATCHED PULL REQUEST, AND WHAT IS NEWS ABOUT IT (0.731). The plan's "a teammate that watches a PR": it checks
 * the PR every few minutes and wakes when a check fails, someone reviews, or the branch conflicts. Locust watches
 * the folder's pull request while the person has asked it to, and says what changed -- in the conversation, with
 * a press that hands it to the teammate, and as a notification while the window is elsewhere. It never starts a
 * run on its own: what a fix costs stays the person's call.
 */
export const PULL_REQUEST_WATCH_CHANNEL = 'folder:pull-request-watch'
/** main -> renderer: news about the watched pull request. */
export const PULL_REQUEST_NEWS_CHANNEL = 'folder:pull-request-news'

export interface PullRequestNews {
  readonly number: number
  readonly url: string
  /** "2 of 9 checks failed", "changes were requested", joined. */
  readonly said: string
  /** Something a teammate could fix: a failed check, requested changes, a conflict. */
  readonly needsWork: boolean
}

/** What changed between two looks at one pull request that a person would want to hear; undefined for nothing. */
export function pullRequestNews(before: FolderPullRequest, now: FolderPullRequest): PullRequestNews | undefined {
  if (before.number !== now.number) return undefined
  const said: string[] = []
  let needsWork = false
  if (before.state !== now.state && (now.state === 'merged' || now.state === 'closed')) {
    said.push(now.state === 'merged' ? 'it was merged' : 'it was closed')
  } else {
    if (now.checks === 'failing' && before.checks !== 'failing') {
      said.push(`${String(now.notPassed)} of ${String(now.checkCount)} checks did not pass`)
      needsWork = true
    } else if (now.checks === 'passing' && before.checks !== 'passing' && before.checks !== 'none') {
      said.push(now.checkCount === 1 ? 'its check passed' : `all ${String(now.checkCount)} checks passed`)
    }
    if (now.review !== before.review && now.review === 'changes-requested') {
      said.push('changes were requested')
      needsWork = true
    } else if (now.review !== before.review && now.review === 'approved') {
      said.push('it was approved')
    }
    if (now.conflicts === true && before.conflicts !== true) {
      said.push('it conflicts with its base branch')
      needsWork = true
    }
  }
  if (said.length === 0) return undefined
  const sentence = said.join(', and ')
  return { number: now.number, url: now.url, said: sentence.charAt(0).toUpperCase() + sentence.slice(1), needsWork }
}
