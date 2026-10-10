import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createFolderCommits } from './folder-commit.js'
import { pullRequestLine, pullRequestOf } from '../shared/pull-request.js'

/*
 * THE FOLDER'S PULL REQUEST, IN THE HEADER (0.720). The JSON below is gh
 * 2.96.0's own for two of a public repository's pull requests, MEASURED
 * 2026-10-10 (`gh pr view --json number,title,url,state,isDraft,
 * statusCheckRollup,reviewDecision`), cut to a few checks and renamed.
 */
const MERGED = JSON.stringify({
  isDraft: false,
  number: 1,
  reviewDecision: '',
  state: 'MERGED',
  statusCheckRollup: [
    { __typename: 'CheckRun', conclusion: 'SUCCESS', name: 'Lint, Typecheck, Test', status: 'COMPLETED', workflowName: 'CI' },
    { __typename: 'StatusContext', context: 'Review bot', state: 'SUCCESS', targetUrl: '' }
  ],
  title: 'oxc stack',
  url: 'https://github.com/someone/pebble/pull/1'
})
const OPEN = (checks: readonly object[], extra: object = {}) =>
  JSON.stringify({ isDraft: false, number: 17, reviewDecision: '', state: 'OPEN', statusCheckRollup: checks, title: 'Fix the cart total', url: 'https://github.com/someone/pebble/pull/17', ...extra })
const run = (conclusion: string, status = 'COMPLETED') => ({ __typename: 'CheckRun', conclusion, status, name: 'CI' })

describe('a pull request, read from gh', () => {
  it('reads its state and how its checks stand', () => {
    expect(pullRequestOf(MERGED)).toEqual({ number: 1, title: 'oxc stack', url: 'https://github.com/someone/pebble/pull/1', state: 'merged', checks: 'passing', checkCount: 2, notPassed: 0 })
    // A cancelled check is not a passed one (GitHub draws it as not successful); skipped ones are.
    expect(pullRequestOf(OPEN([run('SUCCESS'), run('SKIPPED'), run('CANCELLED')]))).toMatchObject({ state: 'open', checks: 'failing', checkCount: 3, notPassed: 1 })
    expect(pullRequestOf(OPEN([run('SUCCESS'), run('', 'IN_PROGRESS')]))).toMatchObject({ checks: 'pending', notPassed: 1 })
    expect(pullRequestOf(OPEN([], { isDraft: true, reviewDecision: 'APPROVED' }))).toMatchObject({ state: 'draft', checks: 'none', review: 'approved' })
  })

  it('takes only a GitHub pull request address', () => {
    expect(pullRequestOf(OPEN([], { url: 'https://evil.example/someone/pebble/pull/17' }))).toBeUndefined()
    expect(pullRequestOf('no pull requests found for branch "main"')).toBeUndefined()
  })

  it('says it in a line', () => {
    expect(pullRequestLine(pullRequestOf(MERGED)!)).toBe('Merged')
    expect(pullRequestLine(pullRequestOf(OPEN([run('SUCCESS'), run('SUCCESS')]))!)).toBe('Open · all 2 checks passed')
    expect(pullRequestLine(pullRequestOf(OPEN([run('SUCCESS'), run('FAILURE'), run('', 'QUEUED')]))!)).toBe('Open · 2 of 3 checks not passed')
    expect(pullRequestLine(pullRequestOf(OPEN([run('', 'IN_PROGRESS')], { reviewDecision: 'CHANGES_REQUESTED' }))!)).toBe('Open · checks running · changes requested')
  })
})

const TIMEOUT = 60_000
const made: string[] = []
afterEach(async () => {
  for (const dir of made.splice(0)) await rm(dir, { recursive: true, force: true })
})
const git = (args: readonly string[], cwd: string): Promise<string> =>
  new Promise((resolve, reject) => execFile('git', [...args], { cwd, windowsHide: true }, (error, stdout, stderr) => (error ? reject(new Error(String(stderr))) : resolve(String(stdout)))))

async function repository(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), 'locust-pr-ws-'))
  made.push(folder)
  await git(['init', '-q', '-b', 'main'], folder)
  await git(['config', 'user.email', 'you@example.test'], folder)
  await git(['config', 'user.name', 'You'], folder)
  await writeFile(join(folder, 'cart.py'), 'def total(items):\n    return 0\n')
  await git(['add', '.'], folder)
  await git(['commit', '-q', '-m', 'first'], folder)
  await git(['remote', 'add', 'origin', 'https://github.com/someone/pebble.git'], folder)
  // origin/HEAD by hand: there is nothing to fetch from.
  await git(['update-ref', 'refs/remotes/origin/main', 'HEAD'], folder)
  await git(['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main'], folder)
  return folder
}

/** A stand-in gh, signed in, with pull request 17 for one branch. */
function gh(calls: string[][], signedIn = true) {
  return async (program: 'git' | 'gh', args: readonly string[], cwd: string): Promise<string> => {
    calls.push([program, ...args])
    if (program === 'git') return git(args, cwd)
    if (args[0] === 'auth') {
      if (signedIn) return 'Logged in'
      throw new Error('not logged in')
    }
    // Asked from the branch checked out in the folder, as gh is (0.731).
    if (args[0] === 'pr' && args[1] === 'view') {
      const branch = (await git(['symbolic-ref', '--short', 'HEAD'], cwd)).trim()
      if (branch === 'locust/fix-the-cart-total') return OPEN([run('SUCCESS')])
      throw new Error(`no pull requests found for branch "${branch}"`)
    }
    throw new Error('unexpected gh call')
  }
}

describe('the folder’s pull request', () => {
  it('is the one for the branch the folder is on, asked of gh from that branch (0.731: a fork’s too)', { timeout: TIMEOUT }, async () => {
    const folder = await repository()
    await git(['checkout', '-q', '-b', 'locust/fix-the-cart-total'], folder)
    const calls: string[][] = []
    expect(await createFolderCommits({ runNetwork: gh(calls) }).pullRequest(folder)).toMatchObject({ number: 17, state: 'open', checks: 'passing' })
    expect(calls.find((call) => call[1] === 'pr')).toEqual(['gh', 'pr', 'view', '--json', 'number,title,url,state,isDraft,statusCheckRollup,reviewDecision,mergeable'])
  })

  it('is nothing on the default branch, on a branch with none, or when gh is signed out -- and gh is not asked on main', { timeout: TIMEOUT }, async () => {
    const folder = await repository()
    const calls: string[][] = []
    expect(await createFolderCommits({ runNetwork: gh(calls) }).pullRequest(folder)).toBeUndefined()
    expect(calls.some((call) => call[1] === 'pr')).toBe(false)
    await git(['checkout', '-q', '-b', 'other-work'], folder)
    expect(await createFolderCommits({ runNetwork: gh([]) }).pullRequest(folder)).toBeUndefined()
    await git(['checkout', '-q', '-b', 'locust/fix-the-cart-total'], folder)
    expect(await createFolderCommits({ runNetwork: gh([], false) }).pullRequest(folder)).toBeUndefined()
  })

  it('is kept a minute, asked again for another branch, and asked again after a sign-in', { timeout: TIMEOUT }, async () => {
    const folder = await repository()
    await git(['checkout', '-q', '-b', 'locust/fix-the-cart-total'], folder)
    const calls: string[][] = []
    const commits = createFolderCommits({ runNetwork: gh(calls) })
    await commits.pullRequest(folder)
    await commits.pullRequest(folder)
    expect(calls.filter((call) => call[1] === 'pr')).toHaveLength(1)
    commits.forgetSignIn()
    await commits.pullRequest(folder)
    expect(calls.filter((call) => call[1] === 'pr')).toHaveLength(2)
    await git(['checkout', '-q', '-b', 'other-work'], folder)
    expect(await commits.pullRequest(folder)).toBeUndefined()
    expect(calls.filter((call) => call[1] === 'pr')).toHaveLength(3)
  })
})
