import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { PublicTeammate } from '../../shared/ipc.js'
import type { AwaySummary } from '../../shared/away.js'
import { AwayList } from './components/AwayList.js'

/**
 * SINCE YOU WERE AWAY, ON HOME (0.590, PRD R17). The list names what ended
 * while nobody was here -- failed first, then missed routine slots, then what
 * ran -- each a button that opens its record, with the counts in the head and
 * Got it beside them. A miss names its routine and when it was due.
 */
const NOW = new Date('2026-10-04T09:00:00.000Z')
const teammates = [{ teammateId: 'tm_wren', name: 'Wren' }] as unknown as PublicTeammate[]
const summary: AwaySummary = {
  since: '2026-10-03T22:00:00.000Z',
  ran: [
    { missionId: 'm1', title: 'Tidy the build folder', at: '2026-10-04T05:00:00.000Z', ownerId: 'tm_wren', routineId: 'rt_1' },
    { missionId: 'm2', title: 'Write the digest', at: '2026-10-04T06:00:00.000Z' }
  ],
  failed: [{ missionId: 'm3', title: 'Run the nightly tests', at: '2026-10-04T02:00:00.000Z', ownerId: 'tm_wren' }],
  missed: [{ routineId: 'rt_2', name: 'Morning digest', dueAt: '2026-10-04T07:00:00.000Z' }],
  waiting: 2
}
const draw = (held: AwaySummary = summary): string =>
  renderToStaticMarkup(<AwayList summary={held} teammates={teammates} onOpen={() => undefined} onOpenRoutines={() => undefined} onSeen={() => undefined} now={NOW} />)

describe('the list on Home', () => {
  it('heads with the counts and Got it, then failed, missed and ran, in that order, each naming who and when', () => {
    const html = draw()
    expect(html).toContain('Since you were away')
    expect(html).toContain('2 ran · 1 failed · 1 missed · 2 waiting on you')
    expect(html).toContain('>Got it<')
    expect(html).toContain('2 conversations are waiting on you')
    // Failed, then missed, then ran -- each kind in the order the summary gives it (the reducer sorts; this draws).
    const order = ['Run the nightly tests', 'Morning digest', 'Tidy the build folder', 'Write the digest'].map((title) => html.indexOf(title))
    expect(order.every((at) => at >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(html).toContain('data-kind="failed"')
    expect(html).toContain('data-kind="missed"')
    expect(html).toContain('data-kind="ran"')
    expect(html).toContain('Wren')
    expect(html).toContain('missed, due')
    expect(html).not.toContain('and ')
  })

  it('shows six of a kind and counts the rest, and says nothing about waiting when nobody is (control)', () => {
    const many: AwaySummary = {
      ...summary,
      waiting: 0,
      failed: [],
      missed: [],
      ran: Array.from({ length: 9 }, (_, i) => ({ missionId: `m${String(i)}`, title: `Turn ${String(i)}`, at: `2026-10-04T0${String(i)}:00:00.000Z` }))
    }
    const html = draw(many)
    expect(html).toContain('and 3 more in the sidebar')
    expect(html).not.toContain('waiting on you')
    expect((html.match(/data-kind="ran"/g) ?? []).length).toBe(6)
  })
})
