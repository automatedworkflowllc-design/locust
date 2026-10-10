import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { PullRequestChipView } from './components/PullRequestChip.js'
import type { FolderPullRequest } from '../../shared/pull-request.js'

/*
 * THE FOLDER'S PULL REQUEST, IN THE HEADER (0.720). main/a-pull-request-
 * shows-in-the-header.test.ts holds how it is read; this holds what the chip
 * says.
 */
const pr = (over: Partial<FolderPullRequest>): FolderPullRequest => ({
  number: 17,
  title: 'Fix the cart total',
  url: 'https://github.com/someone/pebble/pull/17',
  state: 'open',
  checks: 'passing',
  checkCount: 2,
  notPassed: 0,
  ...over
})

describe('the pull request chip', () => {
  it('names the pull request by number and state, with GitHub’s mark, and the whole line on hover', () => {
    const shown = renderToStaticMarkup(<PullRequestChipView pr={pr({})} />)
    expect(shown).toContain('<svg class="lc-githubmark"')
    expect(shown).toContain('<span class="lc-prchip__number">#17</span>')
    expect(shown).toContain('>Open<')
    expect(shown).toContain('title="Pull request #17: Fix the cart total\nOpen · all 2 checks passed\nOpens on GitHub"')
    expect(shown).toContain('lc-tone-green')
  })

  it('wears its checks’ tone while open, and merged’s own once merged', () => {
    expect(renderToStaticMarkup(<PullRequestChipView pr={pr({ checks: 'failing', notPassed: 1 })} />)).toContain('lc-tone-red')
    expect(renderToStaticMarkup(<PullRequestChipView pr={pr({ checks: 'pending', notPassed: 1 })} />)).toContain('lc-tone-amber')
    const merged = renderToStaticMarkup(<PullRequestChipView pr={pr({ state: 'merged', checks: 'failing' })} />)
    expect(merged).toContain('lc-tone-blue')
    expect(merged).toContain('>Merged<')
    expect(renderToStaticMarkup(<PullRequestChipView pr={pr({ state: 'draft' })} />)).toContain('lc-tone-muted')
  })
})
