import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { PullRequestNewsBanner, pullRequestAsk } from './components/PullRequestNewsBanner.js'
import { PullRequestWatchToggle } from './components/PullRequestChip.js'

/*
 * A WATCHED PULL REQUEST'S NEWS (0.731): said above the box; when it is something to fix, one press writes the
 * ask into the box for the person to send -- a watch never spends on its own.
 */
const noop = (): void => undefined
const news = { number: 12, url: 'https://github.com/acme/shop/pull/12', said: '1 of 3 checks did not pass', needsWork: true }

describe('the news about a watched pull request', () => {
  it('says what changed and offers the teammate the fix, as words in the box', () => {
    const html = renderToStaticMarkup(<PullRequestNewsBanner news={news} teammateName="Wren" onAsk={noop} onOpen={noop} onDismiss={noop} />)
    expect(html).toContain('Pull request #12: 1 of 3 checks did not pass.')
    expect(html).toContain('Ask Wren to fix it')
    expect(html).toContain('Open on GitHub')
    expect(pullRequestAsk(news)).toBe('Pull request #12 (https://github.com/acme/shop/pull/12): 1 of 3 checks did not pass. Look at what is wrong, fix it on this branch, and push the fix.')
  })

  it('offers no fix for news with nothing to fix', () => {
    const html = renderToStaticMarkup(<PullRequestNewsBanner news={{ ...news, said: 'It was approved', needsWork: false }} teammateName="Wren" onAsk={noop} onOpen={noop} onDismiss={noop} />)
    expect(html).not.toContain('to fix it')
    expect(html).toContain('is-plain')
  })

  it('has a Watch toggle that says which it is', () => {
    expect(renderToStaticMarkup(<PullRequestWatchToggle watching={false} onToggle={noop} />)).toContain('>Watch<')
    expect(renderToStaticMarkup(<PullRequestWatchToggle watching onToggle={noop} />)).toContain('aria-pressed="true"')
  })
})
