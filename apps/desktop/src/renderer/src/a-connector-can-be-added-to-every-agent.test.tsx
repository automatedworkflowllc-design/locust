import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { AddConnector, rowWords } from './components/AddConnector.js'
import { SETTINGS_PAGES, matchedHeadings } from './settingsPages.js'

/*
 * ADD A CONNECTOR, TO EVERY AGENT YOU CHOOSE (0.716), in Settings >
 * Connectors. main/a-connector-goes-to-every-agent.test.ts holds the words
 * each agent is given; this holds what the page says about it; the drive,
 * _tools/drive-a-connector-goes-to-every-agent.mjs, fills the form in the
 * running app against a throwaway home and reads each agent's file back.
 */
describe('Add a connector', () => {
  it('starts as one button, and says so when no agent here can take one', () => {
    const offered = renderToStaticMarkup(<AddConnector installed={['claude', 'codex']} />)
    expect(offered).toContain('Add a connector…')
    expect(offered).not.toContain('<form')
    expect(offered).not.toContain('disabled')

    const none = renderToStaticMarkup(<AddConnector installed={[]} />)
    expect(none).toContain('disabled')
    expect(none).toContain('None of the agents that can take one is installed here.')
  })

  it('says what each agent did in the connector list’s own words and tones', () => {
    expect(rowWords({ agent: 'claude', outcome: 'added' })).toEqual({ state: 'Added', tone: 'good' })
    expect(rowWords({ agent: 'codex', outcome: 'had' })).toEqual({ state: 'Had one', tone: 'muted', detail: 'It already has a connector by this name, and keeps its own.' })
    expect(rowWords({ agent: 'copilot', outcome: 'failed', said: 'Error: bad name' })).toEqual({ state: 'Not added', tone: 'amber', detail: 'Error: bad name' })
    expect(rowWords({ agent: 'opencode', outcome: 'kept', said: 'OpenCode has no command to remove one.' })).toEqual({
      state: 'Still has it',
      tone: 'amber',
      detail: 'OpenCode has no command to remove one.'
    })
    // An Undo that failed is not "not added": it was added, and is still there.
    expect(rowWords({ agent: 'claude', outcome: 'failed', undo: true }).state).toBe('Not taken back')
    expect(rowWords({ agent: 'claude', outcome: 'removed', undo: true }).state).toBe('Taken back')
  })

  it('is found by the words a person types for it', () => {
    const connectors = SETTINGS_PAGES.find((page) => page.id === 'connectors')!
    expect(connectors.headings).toContain('Add a connector')
    for (const typed of ['mcp server', 'add mcp', 'every agent']) expect(matchedHeadings(connectors, typed)).toContain('Add a connector')
  })
})
