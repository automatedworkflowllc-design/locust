import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { Sidebar } from './components/Sidebar.js'
import type { SidebarMission } from './components/Sidebar.js'

/*
 * A CONVERSATION CAN BE PINNED (0.729), as Claude's own list keeps its starred ones: the plan's "Settle, snooze and
 * pin conversations", its first part. Pinned conversations sit at the top of the sidebar, newest pin first. How the
 * pins are kept is main/a-conversation-can-be-pinned.test.ts.
 */
const row = (missionId: string, title: string, extra: Partial<SidebarMission> = {}): SidebarMission =>
  ({ missionId, title, phase: 'completed', integrityIssueCount: 0, lastAt: '2026-10-10T05:00:00.000Z', ...extra }) as SidebarMission
const noop = (): void => undefined
const sidebar = (missions: readonly SidebarMission[], pinnedKeys: readonly string[]): string =>
  renderToStaticMarkup(
    <Sidebar
      runtimes={[]}
      missions={missions}
      teammates={[]}
      viewByTeammate={{}}
      routineStepByTeammate={{}}
      missionOwners={{}}
      selectedMissionId={undefined}
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
      pinnedKeys={pinnedKeys}
    />
  )

describe('the sidebar', () => {
  const missions = [row('m_a', 'Alpha'), row('m_b', 'Bravo'), row('m_c', 'Charlie', { rootId: 'm_root_c' })]

  it('puts the pinned ones on top, newest pin first, and the rest under Recents, each once', () => {
    const html = sidebar(missions, ['m_root_c', 'm_b'])
    const order = ['Pinned', 'Charlie', 'Bravo', 'Recents', 'Alpha'].map((word) => html.indexOf(`>${word}<`))
    expect(order.every((at) => at >= 0)).toBe(true)
    expect([...order].sort((left, right) => left - right)).toEqual(order)
    expect(html.split('>Bravo<').length - 1).toBe(1)
  })

  it('looks as it did with nothing pinned', () => {
    const html = sidebar(missions, [])
    expect(html).not.toContain('>Pinned<')
    expect(html).not.toContain('>Recents<')
  })
})
