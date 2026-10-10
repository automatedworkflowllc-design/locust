import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { GitHubCard, type GitHubCardProps } from './components/GitHubAccount.js'
import { SETTINGS_PAGES, matchedHeadings } from './settingsPages.js'

/*
 * YOUR GITHUB ON SETTINGS › CONNECTORS (0.720). main/your-github-is-
 * connected-through-gh.test.ts holds what gh is asked and how its answers
 * are read; this holds what the card says in each state.
 */
const nothing = (): void => {}
const card = (props: Partial<GitHubCardProps>): string =>
  renderToStaticMarkup(
    <GitHubCard
      account={undefined}
      signingIn={false}
      code={undefined}
      copied={false}
      said={undefined}
      onRead={nothing}
      onSignIn={nothing}
      onStop={nothing}
      onOpen={nothing}
      onCopied={nothing}
      {...props}
    />
  )

describe('your GitHub on the Connectors page', () => {
  it('wears GitHub’s mark and names who it is signed in as', () => {
    const shown = card({ account: { kind: 'signed-in', login: 'octo-cat', scopes: ['repo'] } })
    expect(shown).toContain('<svg class="lc-githubmark"')
    expect(shown).toContain('octo-cat')
    expect(shown).toContain('Signed in as octo-cat.')
    expect(shown).toContain('Open on GitHub')
    expect(shown).not.toContain('Sign in with GitHub')
  })

  it('offers a sign-in when nobody is signed in, and the CLI when it is missing', () => {
    expect(card({ account: { kind: 'signed-out' } })).toContain('Sign in with GitHub')
    expect(card({ account: { kind: 'expired', login: 'octo-cat' } })).toContain('Sign in with GitHub')
    const missing = card({ account: { kind: 'no-cli' } })
    expect(missing).toContain('Get the GitHub CLI')
    expect(missing).not.toContain('Sign in with GitHub')
    expect(card({})).toContain('Asking the GitHub CLI.')
  })

  it('shows the one-time code while the sign-in waits, with a way to stop', () => {
    const asking = card({ account: { kind: 'signed-out' }, signingIn: true })
    expect(asking).toContain('Asking GitHub for a code.')
    expect(asking).toContain('Stop')
    expect(asking).not.toContain('Sign in with GitHub')
    const waiting = card({ account: { kind: 'signed-out' }, signingIn: true, code: { code: 'AB12-CD34', url: 'https://github.com/login/device' } })
    expect(waiting).toContain('AB12-CD34')
    expect(waiting).toContain('Copy code and open GitHub')
    expect(card({ account: { kind: 'signed-out' }, signingIn: true, copied: true, code: { code: 'AB12-CD34', url: 'https://github.com/login/device' } })).toContain(
      'Copied. Open GitHub again'
    )
  })

  it('is found by the words a person types for it', () => {
    const connectors = SETTINGS_PAGES.find((page) => page.id === 'connectors')!
    expect(connectors.headings[0]).toBe('GitHub')
    for (const word of ['github', 'gh', 'pull request', 'source control']) {
      expect(matchedHeadings(connectors, word)).toContain('GitHub')
    }
  })
})
