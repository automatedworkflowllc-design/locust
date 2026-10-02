import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { Sidebar } from './components/Sidebar.js'
import type { SidebarMission } from './components/Sidebar.js'

/**
 * A CONVERSATION WITH NO TEAMMATE WEARS ITS MODEL'S MARK.
 *
 * Colin, 2026-10-02, of a sidebar row with an empty dashed box where the face
 * goes: "if a teammate isnt assigned we can just use the logo for whatever
 * model is chosen". A model of your own has no mark, so it keeps the box.
 */
const row = (missionId: string, extra: Partial<SidebarMission> = {}): SidebarMission =>
  ({ missionId, title: 'yo', phase: 'completed', integrityIssueCount: 0, lastAt: '2026-10-02T05:00:00.000Z', ...extra }) as SidebarMission

const noop = (): void => undefined

function sidebar(missions: readonly SidebarMission[]): string {
  return renderToStaticMarkup(
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
    />
  )
}

describe('a conversation nobody was given', () => {
  it("wears its model's mark where the face goes, named", () => {
    const html = sidebar([row('mission_claude', { runtime: 'claude', model: 'claude-opus-5-5' })])
    expect(html).toContain('lc-conv__runtime')
    expect(html).toContain('data-runtime="claude"')
    expect(html).toContain('aria-label="Claude Code"')
    expect(html).not.toContain('lc-conv__nobody')
  })

  it('keeps the empty place for a model of your own, or a runtime not yet known', () => {
    expect(sidebar([row('mission_own', { runtime: 'opencode', model: 'own-0a1b2c3d/llama-local' })])).toContain('lc-conv__nobody')
    expect(sidebar([row('mission_starting')])).toContain('lc-conv__nobody')
  })
})
