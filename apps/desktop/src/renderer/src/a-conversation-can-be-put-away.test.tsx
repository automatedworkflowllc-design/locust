import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { Sidebar } from './components/Sidebar.js'
import type { SidebarMission } from './components/Sidebar.js'
import { isPutAway, snoozeChoices } from './settled.js'
import type { SettledEntry } from './settled.js'

/*
 * SETTLE AND SNOOZE (0.730): a finished conversation moves out of the sidebar, for good or until a time, and comes
 * back by itself when something new happens in it. How it is kept is main/a-conversation-can-be-put-away.test.ts.
 */
describe('a conversation put away', () => {
  const settled: SettledEntry = { at: '2026-10-10T12:00:00.000Z' }
  const snoozed: SettledEntry = { at: '2026-10-10T12:00:00.000Z', until: '2026-10-10T18:00:00.000Z' }

  it('is out of the list while settled, or until its snooze ends', () => {
    const noon = new Date('2026-10-10T13:00:00.000Z')
    expect(isPutAway('2026-10-10T11:00:00.000Z', settled, noon)).toBe(true)
    expect(isPutAway('2026-10-10T11:00:00.000Z', snoozed, noon)).toBe(true)
    expect(isPutAway('2026-10-10T11:00:00.000Z', snoozed, new Date('2026-10-10T18:00:01.000Z'))).toBe(false)
    expect(isPutAway('2026-10-10T11:00:00.000Z', undefined, noon)).toBe(false)
  })

  it('comes back when something new happens in it', () => {
    expect(isPutAway('2026-10-10T12:30:00.000Z', settled, new Date('2026-10-10T13:00:00.000Z'))).toBe(false)
  })
})

describe('the snooze times offered', () => {
  // Built from local clock times, so the test holds in any time zone.
  const local = (year: number, month: number, day: number, hour: number, minute = 0): Date => new Date(year, month - 1, day, hour, minute)

  it('on a Friday morning: an hour, this evening, tomorrow, Monday', () => {
    const friday = local(2026, 10, 9, 10, 30)
    expect(snoozeChoices(friday).map((choice) => [choice.label, new Date(choice.until).getTime()])).toEqual([
      ['For an hour', local(2026, 10, 9, 11, 30).getTime()],
      ['Until this evening (6 PM)', local(2026, 10, 9, 18).getTime()],
      ['Until tomorrow (9 AM)', local(2026, 10, 10, 9).getTime()],
      ['Until Monday (9 AM)', local(2026, 10, 12, 9).getTime()]
    ])
  })

  it('leaves out an evening already here, and a Monday that is tomorrow', () => {
    const sundayNight = local(2026, 10, 11, 20)
    expect(snoozeChoices(sundayNight).map((choice) => choice.label)).toEqual(['For an hour', 'Until tomorrow (9 AM)'])
  })
})

const row = (missionId: string, title: string, extra: Partial<SidebarMission> = {}): SidebarMission =>
  ({ missionId, title, phase: 'completed', integrityIssueCount: 0, lastAt: '2026-10-10T05:00:00.000Z', ...extra }) as SidebarMission
const noop = (): void => undefined
const sidebar = (missions: readonly SidebarMission[], settled: Readonly<Record<string, SettledEntry>>, selectedMissionId?: string): string =>
  renderToStaticMarkup(
    <Sidebar
      runtimes={[]}
      missions={missions}
      teammates={[]}
      viewByTeammate={{}}
      routineStepByTeammate={{}}
      missionOwners={{}}
      selectedMissionId={selectedMissionId}
      selectedTeammateId={undefined}
      onSelectMission={noop}
      onMissionMenu={noop}
      onTeammateMenu={noop}
      pendingApprovals={{}}
      liveActivity={{}}
      starting={[]}
      recentlyDone={[]}
      recentlyReceived={[]}
      onSelectTeammate={noop}
      onNewConversationWith={noop}
      onOpenHub={noop}
      onAddMenu={noop}
      composerShown={false}
      onOpenSettings={noop}
      onOpenMissions={noop}
      onOpenTeammates={noop}
      rooms={[]}
      routines={[]}
      currentRoomId={undefined}
      onOpenRoom={noop}
      onOpenRooms={noop}
      onOpenAutomations={noop}
      onHome={noop}
      groups={[]}
      settled={settled}
    />
  )

describe('the sidebar', () => {
  const missions = [row('m_a', 'Alpha'), row('m_b', 'Bravo')]
  const settled = { m_b: { at: '2026-10-10T06:00:00.000Z' } }

  it('leaves a settled conversation out', () => {
    const html = sidebar(missions, settled)
    expect(html).toContain('>Alpha<')
    expect(html).not.toContain('>Bravo<')
  })

  it('keeps it while it is the one open, so its menu can bring it back', () => {
    expect(sidebar(missions, settled, 'm_b')).toContain('>Bravo<')
  })
})
