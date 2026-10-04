import { describe, expect, it } from 'vitest'

import type { SidebarMission } from './components/Sidebar.js'
import { RAIL_ROWS_SHOWN, railCountBadge, railEmptyLine, railRows, shortAgo } from './railFlyout.js'

const NOW = new Date('2026-09-08T12:00:00.000Z')
const row = (missionId: string, phase: SidebarMission['phase'], lastAt?: string): SidebarMission => ({
  missionId,
  title: missionId,
  phase,
  integrityIssueCount: 0,
  ...(lastAt === undefined ? {} : { lastAt })
})

describe('which conversations the rail flyout lists, and in what order', () => {
  it('puts the live one first, then newest first', () => {
    const rows = railRows([
      row('old', 'completed', '2026-09-01T00:00:00.000Z'),
      row('new', 'completed', '2026-09-08T11:00:00.000Z'),
      row('live', 'running', '2026-09-07T00:00:00.000Z')
    ])
    expect(rows.shown.map((entry) => entry.missionId)).toEqual(['live', 'new', 'old'])
  })

  it('never lets an unknown age outrank a known recent one', () => {
    // The control on the sort. A missing timestamp parses to 0, which sorts
    // LAST -- a row we know nothing about must not float to the top.
    const rows = railRows([row('dated', 'completed', '2026-09-08T11:00:00.000Z'), row('undated', 'completed')])
    expect(rows.shown[0]?.missionId).toBe('dated')
  })

  it('shows at most six and says how many there are', () => {
    // "A panel that scrolls through everything is the full sidebar again, in
    // a popover." The Missions screen is where everything lives.
    const many = Array.from({ length: 9 }, (_, index) => row(`m${String(index)}`, 'completed', `2026-09-0${String(1 + (index % 8))}T00:00:00.000Z`))
    const rows = railRows(many)
    expect(rows.shown).toHaveLength(RAIL_ROWS_SHOWN)
    expect(rows.countLabel).toBe('6 of 9')
    expect(railRows(many.slice(0, 3)).countLabel).toBe('3')
  })
})

describe('the count badge on a rail avatar', () => {
  it('is drawn only past one conversation', () => {
    // "Suppressed at 1, because 1 is what a single click already gets you."
    expect(railCountBadge(0)).toBeUndefined()
    expect(railCountBadge(1)).toBeUndefined()
    expect(railCountBadge(2)).toBe('2')
    expect(railCountBadge(14)).toBe('14')
  })
})

describe('an age a 268px row has room for', () => {
  it('reads now, minutes, hours, days, weeks', () => {
    const at = (secondsAgo: number): string => new Date(NOW.getTime() - secondsAgo * 1000).toISOString()
    expect(shortAgo(at(5), NOW)).toBe('now')
    expect(shortAgo(at(5 * 60), NOW)).toBe('5m')
    expect(shortAgo(at(2 * 3_600), NOW)).toBe('2h')
    expect(shortAgo(at(3 * 86_400), NOW)).toBe('3d')
    expect(shortAgo(at(15 * 86_400), NOW)).toBe('2w')
  })

  it('says nothing for a missing or unreadable time rather than a wrong one', () => {
    expect(shortAgo(undefined, NOW)).toBeUndefined()
    expect(shortAgo('not a date', NOW)).toBeUndefined()
  })
})

describe('the empty case', () => {
  it('names the teammate and points at the composer', () => {
    expect(railEmptyLine('Juno')).toBe('Nothing yet — pick Juno and write below.')
  })
})
