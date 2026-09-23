import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { AppChangelog, AppChangelogEntry } from '../../shared/ipc.js'
import { ReleaseNotes, WHATS_NEW_PAGE, WhatsNew, WhatsNewSplash, changelogDate } from './components/WhatsNew.js'

/**
 * WHAT'S NEW, READ LIKE CLAUDE CODE'S.
 *
 * Colin's frame of Claude Code's panel (2026-09-23): each build's date, its
 * version as a small mono badge, its changes under NEW / IMPROVED / FIXED, a
 * line between builds. What's new in Settings is every build; the splash after
 * a big update is the same builds in a dialog, with the way to all of them.
 */

const build = (version: string, date: string, groups: AppChangelogEntry['groups']): AppChangelogEntry => ({ version, date, groups })

describe('a date', () => {
  it('reads as words, from the digits -- never through a clock that shifts it a day', () => {
    expect(changelogDate('2026-09-23')).toBe('September 23, 2026')
    expect(changelogDate('2026-01-05')).toBe('January 5, 2026')
    expect(changelogDate(undefined)).toBeUndefined()
    expect(changelogDate('someday')).toBe('someday')
  })
})

describe('one build', () => {
  it('says its date, wears its version as a badge, and groups its changes under their labels', () => {
    const html = renderToStaticMarkup(
      <ReleaseNotes
        entry={build('0.281.0', '2026-09-23', [
          { label: 'New', text: "- **What's new, in Settings.** Every version." },
          { label: 'Improved', text: '- **No banner.** Gone.' }
        ])}
      />
    )
    expect(html).toContain('September 23, 2026')
    expect(html).toMatch(/class="lc-release__version lc-mono">0\.281\.0</)
    expect(html).toMatch(/class="lc-release__label lc-mono">New</)
    expect(html).toMatch(/class="lc-release__label lc-mono">Improved</)
    expect(html).toContain('<strong>What')
  })

  it('written before the groups, carries no label', () => {
    const html = renderToStaticMarkup(<ReleaseNotes entry={build('0.100.0', '2026-09-01', [{ text: '- An old change.' }])} />)
    expect(html).not.toContain('lc-release__label')
    expect(html).toContain('An old change.')
  })
})

describe("Settings' What's new", () => {
  const many: AppChangelog = {
    version: '0.281.0',
    firstRun: false,
    entries: Array.from({ length: WHATS_NEW_PAGE + 5 }, (_, index) => build(`0.${String(281 - index)}.0`, '2026-09-23', [{ text: `- Change ${String(index)}.` }]))
  }

  it('draws the newest builds first, and offers the older ones rather than drawing all of them at once', () => {
    const html = renderToStaticMarkup(<WhatsNew changelog={many} />)
    expect(html.match(/<article class="lc-release"/g)).toHaveLength(WHATS_NEW_PAGE)
    expect(html.indexOf('0.281.0')).toBeLessThan(html.indexOf('0.280.0'))
    expect(html).toContain('Show older versions')
  })

  it('says so when the build shipped without its changelog, and while it is being read', () => {
    expect(renderToStaticMarkup(<WhatsNew changelog={{ version: '0.281.0', firstRun: false, entries: [] }} />)).toContain('without its changelog')
    expect(renderToStaticMarkup(<WhatsNew changelog={undefined} />)).toContain('Reading what changed')
  })
})

describe('the splash after a big update', () => {
  it('shows the big builds, and the way to every other one', () => {
    const html = renderToStaticMarkup(
      <WhatsNewSplash
        entries={[build('0.277.0', '2026-09-22', [{ text: '- **Every teammate is a bot.**' }])]}
        onSeeEverything={() => undefined}
        onClose={() => undefined}
      />
    )
    expect(html).toContain('role="dialog"')
    expect(html).toContain('What’s new in Locust')
    expect(html).toContain('Every teammate is a bot')
    expect(html).toContain('September 22, 2026')
    expect(html).toContain('See every version')
    expect(html).toContain('Got it')
  })
})
