import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { PublicGroup } from '../../shared/ipc.js'
import { Sidebar } from './components/Sidebar.js'
import type { SidebarMission } from './components/Sidebar.js'

/**
 * A groups file that would not read is a sentence in the sidebar, not an
 * empty list.
 *
 * Astra, 2026-09-16, against 0.154.0 with `groups.json` replaced by a
 * directory, then truncated, then padded past 4 MiB: "in all three cases the
 * group disappeared and the conversation appeared as an ordinary ungrouped
 * row. No warning appeared." The store had told unreadable apart from empty
 * since the rooms lesson, and the host relayed it as `ok: false`; the
 * sidebar's `if (!response.ok) return` then drew exactly what an empty
 * folder draws. Three layers agreed and the fourth said nothing.
 */

const mission: SidebarMission = {
  missionId: 'mission_1',
  title: 'Control renamed conversation',
  phase: 'completed',
  integrityIssueCount: 0,
  lastAt: '2026-09-14T05:00:00.000Z'
} as SidebarMission

const group: PublicGroup = { groupId: 'grp_1', name: 'State control', createdAt: '2026-09-14T05:00:00.000Z', instructions: '' }

const noop = (): void => undefined

function sidebar(props: { readonly groups?: readonly PublicGroup[]; readonly unreadable?: readonly string[] }): string {
  return renderToStaticMarkup(
    <Sidebar
      runtimes={[]}
      missions={[mission]}
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
      groups={props.groups ?? []}
      unreadable={props.unreadable}
    />
  )
}

describe('the groups file that would not read', () => {
  it('is said in the sidebar, above the conversations it could not sort', () => {
    const html = sidebar({ unreadable: ['groups'] })
    expect(html).toContain('Groups could not be read — everything is listed ungrouped.')
    expect(html).toContain('Nothing is saved over the file until it reads again.')
    expect(html).toContain('lc-sidebar__unreadable')
    // The conversation is still there to work with -- unreadable groups
    // never hide work -- and it carries no group heading it cannot vouch for.
    expect(html).toContain('Control renamed conversation')
    expect(html).not.toContain('Ungrouped')
  })

  it('is not said when there are simply no groups', () => {
    // The control: an empty folder and a broken file must not look alike,
    // in EITHER direction.
    const html = sidebar({})
    expect(html).not.toContain('Groups could not be read')
    expect(html).toContain('Control renamed conversation')
  })

  it('names every file that would not read, in one sentence, roster first', () => {
    // The roster is the one that matters: unreadable, it used to look like a
    // fresh install, and the next mission start would have made it one.
    const html = sidebar({ unreadable: ['routines', 'teammates'] })
    expect(html).toContain('Teammates and routines could not be read.')
    expect(html).toContain('Nothing is saved over them until they read again.')
  })

  it('is not said when the groups read fine', () => {
    const html = sidebar({ groups: [group] })
    expect(html).not.toContain('Groups could not be read')
    // Groups are retired and no longer drawn (Colin, 2026-09-29): the
    // folder is the heading, and a group's name is not on the sidebar.
    expect(html).not.toContain('State control')
  })
})
