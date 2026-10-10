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
export const PULL_REQUEST_FIELDS = 'number,title,url,state,isDraft,statusCheckRollup,reviewDecision'

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
    ...(review === undefined ? {} : { review })
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
