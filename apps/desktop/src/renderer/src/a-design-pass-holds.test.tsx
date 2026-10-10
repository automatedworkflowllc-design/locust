import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { PublicConnector } from '../../shared/ipc.js'
import { connectorDetail } from './connectorHealth.js'
import { UsageMeters } from './components/UsageMeters.js'
import { listTone, missionPhaseView } from './status.js'

/*
 * THE DESIGN PASS OF 10/09 (0.715), held. Colin: "Might be time to do a
 * design pass just to see if you're happy with the quality across the
 * board." Every screen was drawn on the everyday profile at his 1209x770 and
 * looked at (look-every-screen.mjs, look-the-rest.mjs); these are the ones
 * that were not clean, kept from coming back.
 */
describe('a list of conversations draws the settled case quiet', () => {
  it('a finished turn is muted in a list; the ones that need a look keep their colour', () => {
    expect(listTone(missionPhaseView('completed'))).toBe('muted')
    expect(listTone(missionPhaseView('running'))).toBe('live')
    expect(listTone(missionPhaseView('interrupted'))).toBe('red')
    expect(listTone(missionPhaseView('failed'))).toBe('red')
    // A record that did not read to its end is still worth a look.
    expect(listTone(missionPhaseView('completed', true))).toBe('amber')
    // A single turn's receipt still says it in blue: there it is the news.
    expect(missionPhaseView('completed').tone).toBe('blue')
  })
})

describe('a working connector says nothing twice', () => {
  const now = new Date('2026-10-09T22:00:00.000Z')
  const connector = (fields: Partial<PublicConnector>): PublicConnector =>
    ({ name: 'claude.ai Gmail', location: 'https://gmailmcp.googleapis.com/mcp', status: 'connected', lastConnectedAt: '2026-10-09T21:59:40.000Z', ...fields }) as PublicConnector

  it('connected a moment ago: no line under its name', () => {
    expect(connectorDetail(connector({}), now)).toBeUndefined()
  })

  it('one to act on keeps what to do, and an old reading keeps its age', () => {
    expect(connectorDetail(connector({ status: 'needs-auth', lastConnectedAt: undefined }), now)).toBe('Run /mcp in Claude Code and sign in to claude.ai Gmail. Not seen connected since Locust started.')
    expect(connectorDetail(connector({ lastConnectedAt: '2026-10-09T21:30:00.000Z' }), now)).toBe('Last connected 30 min ago.')
  })
})

describe('an agent’s limits are meters, toned one by one', () => {
  const now = new Date('2026-10-09T22:00:00.000Z')
  const said = 'Gemini: 5-hour window 100% left · Gemini: weekly window 67% left · resets 2026-10-10T20:49:00.000Z · Claude and GPT: weekly window 20% left · resets 2026-10-10T19:09:00.000Z · as of 2026-10-09T21:53:00.000Z'

  it('a meter a window, the whole sentence its tooltip, only the pressing window amber', () => {
    const html = renderToStaticMarkup(<UsageMeters said={said} now={now} />)
    expect(html.match(/class="lc-meter( is-[a-z]+)?"/g) ?? []).toHaveLength(3)
    expect(html.match(/lc-meter is-pressing/g) ?? []).toHaveLength(1)
    expect(html).toContain('Claude and GPT: weekly')
    expect(html).toContain('20% left')
    expect(html).toContain('as of')
    // The sentence is all still there, for the hover.
    expect(html).toContain('title="')
  })
})
