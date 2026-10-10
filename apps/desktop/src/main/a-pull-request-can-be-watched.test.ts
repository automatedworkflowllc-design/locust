import { describe, expect, it } from 'vitest'

import { pullRequestNews, pullRequestOf, type FolderPullRequest } from '../shared/pull-request.js'
import { createPullRequestWatch } from './pull-request-watch.js'

/*
 * A PULL REQUEST CAN BE WATCHED (0.731): the plan's "a teammate that watches a PR -- it checks the PR every few
 * minutes and wakes when a check fails, someone reviews, or the branch conflicts". Locust looks, and says; the
 * person decides whether a teammate acts. `mergeable` is gh's own field, MEASURED 2026-10-10 on cli/cli's pull
 * requests: "MERGEABLE".
 */
const URL = 'https://github.com/acme/shop/pull/12'
const pr = (over: Partial<FolderPullRequest> = {}): FolderPullRequest => ({ number: 12, title: 'Fix totals', url: URL, state: 'open', checks: 'pending', checkCount: 3, notPassed: 3, ...over })

describe('what is news about a pull request', () => {
  it('a check that fails, a review that asks for changes, a conflict: each something to fix', () => {
    expect(pullRequestNews(pr(), pr({ checks: 'failing', notPassed: 1 }))).toEqual({ number: 12, url: URL, said: '1 of 3 checks did not pass', needsWork: true })
    expect(pullRequestNews(pr({ checks: 'passing', notPassed: 0 }), pr({ checks: 'passing', notPassed: 0, review: 'changes-requested' }))).toMatchObject({ said: 'Changes were requested', needsWork: true })
    expect(pullRequestNews(pr(), pr({ conflicts: true }))).toMatchObject({ said: 'It conflicts with its base branch', needsWork: true })
  })

  it('checks passing, an approval, a merge: news, nothing to fix', () => {
    expect(pullRequestNews(pr(), pr({ checks: 'passing', notPassed: 0 }))).toMatchObject({ said: 'All 3 checks passed', needsWork: false })
    expect(pullRequestNews(pr({ checks: 'passing', notPassed: 0 }), pr({ checks: 'passing', notPassed: 0, review: 'approved' }))).toMatchObject({ said: 'It was approved', needsWork: false })
    expect(pullRequestNews(pr(), pr({ state: 'merged' }))).toMatchObject({ said: 'It was merged', needsWork: false })
  })

  it('nothing changed, or a check still failing, is not news again', () => {
    expect(pullRequestNews(pr(), pr())).toBeUndefined()
    expect(pullRequestNews(pr({ checks: 'failing', notPassed: 1 }), pr({ checks: 'failing', notPassed: 2 }))).toBeUndefined()
  })

  it('reads a conflict off gh’s own field', () => {
    expect(pullRequestOf(JSON.stringify({ number: 12, url: URL, state: 'OPEN', mergeable: 'CONFLICTING', statusCheckRollup: [] }))?.conflicts).toBe(true)
    expect(pullRequestOf(JSON.stringify({ number: 12, url: URL, state: 'OPEN', mergeable: 'MERGEABLE', statusCheckRollup: [] }))?.conflicts).toBeUndefined()
  })
})

describe('the watch', () => {
  const watchOf = (reads: FolderPullRequest[]) => {
    const said: string[] = []
    let ticks: (() => void) | undefined
    let cleared = 0
    const watch = createPullRequestWatch({
      read: async () => reads.shift(),
      onNews: (news) => said.push(news.said),
      schedule: (task) => {
        ticks = task
        return 'timer'
      },
      clear: () => {
        cleared += 1
        ticks = undefined
      }
    })
    return { watch, said, tick: () => ticks?.(), ticking: () => ticks !== undefined, cleared: () => cleared }
  }

  it('looks at once, then on each tick, and says only what changed', async () => {
    const run = watchOf([pr(), pr(), pr({ checks: 'failing', notPassed: 1 })])
    run.watch.watch(URL, true)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(run.ticking()).toBe(true)
    await run.watch.look()
    expect(run.said).toEqual([])
    await run.watch.look()
    expect(run.said).toEqual(['1 of 3 checks did not pass'])
  })

  it('stops watching a merged one once it has said so, and the timer with it', async () => {
    const run = watchOf([pr(), pr({ state: 'merged' })])
    run.watch.watch(URL, true)
    await new Promise((resolve) => setTimeout(resolve, 0))
    await run.watch.look()
    expect(run.said).toEqual(['It was merged'])
    expect(run.watch.watching(URL)).toBe(false)
    expect(run.ticking()).toBe(false)
  })

  it('has no timer while nothing is watched', () => {
    const run = watchOf([])
    run.watch.watch(URL, true)
    run.watch.watch(URL, false)
    expect(run.ticking()).toBe(false)
    expect(run.cleared()).toBe(1)
  })
})
