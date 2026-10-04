import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { seedAvatar } from '../../shared/avatar.js'
import type { PublicTeammate } from '../../shared/ipc.js'
import { BoardScreen } from './components/BoardScreen.js'
import type { SidebarMission } from './components/Sidebar.js'

/**
 * A BOARD OF CONVERSATIONS (0.585). The screen over `conversationBoard`:
 * each column titled and counted, each card a face, a title and one line of
 * state, the whole card opening the conversation. Quiet, it says so.
 */

const row = (over: Partial<SidebarMission> & { missionId: string }): SidebarMission =>
  ({ title: over.missionId, phase: 'completed', integrityIssueCount: 0, ...over })

const WREN = { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', avatar: seedAvatar('tm_wren'), role: 'Code & Migrations', createdAt: '2026-10-01T00:00:00.000Z' } as unknown as PublicTeammate
const NOW = new Date('2026-10-04T06:00:00.000Z')

const screen = (missions: readonly SidebarMission[], facts: { needsYou?: ReadonlySet<string>; toLookAt?: ReadonlySet<string> } = {}, waiting: ReadonlyMap<string, string> = new Map()): string =>
  renderToStaticMarkup(
    <BoardScreen
      missions={missions}
      rooms={[]}
      trashed={new Set()}
      facts={facts}
      waitingFor={waiting}
      teammates={[WREN]}
      missionOwners={{ asks: 'tm_wren', live: 'tm_wren' }}
      onOpen={() => undefined}
      now={NOW}
    />
  )

describe('the board', () => {
  it('draws each column with its count, and each card with its face, title and state', () => {
    const html = screen(
      [
        row({ missionId: 'asks', title: 'Rename the invoices', phase: 'running', lastAt: '2026-10-04T05:58:00.000Z' }),
        row({ missionId: 'live', title: 'Fix the cart total', phase: 'running', lastAt: '2026-10-04T05:50:00.000Z' }),
        row({ missionId: 'ended', title: 'Write the brief', phase: 'completed', lastAt: '2026-10-04T05:30:00.000Z' }),
        row({ missionId: 'old', title: 'Yesterday', phase: 'completed', lastAt: '2026-10-03T05:00:00.000Z' })
      ],
      { needsYou: new Set(['asks']), toLookAt: new Set(['ended']) },
      new Map([['asks', 'Run a command: git mv invoices old-invoices']])
    )
    for (const title of ['Needs you', 'Working', 'Ready to look at', 'Done']) expect(html).toContain(title)
    expect(html).toContain('1 waiting on you · 1 working')
    expect(html).toContain('data-column="needs-you"')
    expect(html).toContain('Run a command: git mv invoices old-invoices')
    expect(html).toContain('Rename the invoices')
    expect(html).toContain('>working<')
    expect(html).toMatch(/finished · /)
    // The owner's face and name on its cards.
    expect(html).toContain('data-bot')
    expect(html).toContain('Wren')
    // A card the column order puts first: the one waiting.
    expect(html.indexOf('Rename the invoices')).toBeLessThan(html.indexOf('Fix the cart total'))
  })

  it('says it is quiet, and lists what is done, when nothing needs the person (control)', () => {
    const html = screen([row({ missionId: 'old', title: 'Yesterday', phase: 'completed', lastAt: '2026-10-03T05:00:00.000Z' })])
    expect(html).toContain('all quiet')
    expect(html).toContain('Nothing is waiting on you and nothing is running.')
    expect(html).not.toContain('Needs you')
    expect(html).not.toContain('>Working<')
    expect(html).toContain('Yesterday')
  })
})
