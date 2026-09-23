import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { seedAvatar } from '../../shared/avatar.js'
import type { PublicRoutine, PublicTeammate } from '../../shared/ipc.js'
import { Sidebar } from './components/Sidebar.js'
import type { SidebarMission } from './components/Sidebar.js'
import { routineOf } from './conversationList.js'
import { routineStepPhrase } from './routines.js'

/**
 * TWO ROWS WITH ONE TITLE ARE TOLD APART WITHOUT OPENING THEM.
 *
 * The 0.271 design recheck, finding 2: a room run made two rows beginning
 * "Each teammate: read READM..." and running the saved routine added a third,
 * and "the rows do not reliably identify Gem, Pip, or the routine". The room
 * half became one row in 0.288. What is left: a routine replays a
 * conversation's words, so its run wears the same title as the conversation
 * it was saved from. It carries the Routines clock now, and every row says
 * whose it is to a screen reader and on hover.
 */
const wren = { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-23T05:00:00.000Z', avatar: seedAvatar('tm_wren') } as PublicTeammate
const routine = { routineId: 'rt_morning', name: 'Morning check' } as unknown as PublicRoutine

const row = (missionId: string, extra: Partial<SidebarMission> = {}): SidebarMission =>
  ({ missionId, title: 'Read the README and list the TODOs', phase: 'completed', integrityIssueCount: 0, lastAt: '2026-09-23T05:00:00.000Z', ...extra }) as SidebarMission

const noop = (): void => undefined

function sidebar(
  missions: readonly SidebarMission[],
  routines: readonly PublicRoutine[],
  steps: Readonly<Record<string, { readonly name: string; readonly step: number; readonly of: number }>> = {}
): string {
  return renderToStaticMarkup(
    <Sidebar
      runtimes={[]}
      missions={missions}
      teammates={[wren]}
      viewByTeammate={{}}
      routineStepByTeammate={steps}
      missionOwners={Object.fromEntries(missions.map((mission) => [mission.missionId, 'tm_wren']))}
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
      onNewTeammate={noop}
      composerShown={false}
      onOpenSettings={noop}
      onOpenMissions={noop}
      onOpenTeammates={noop}
      rooms={[]}
      routines={routines}
      currentRoomId={undefined}
      onOpenRoom={noop}
      onOpenRooms={noop}
      onOpenAutomations={noop}
      onHome={noop}
      groups={[]}
    />
  )
}

describe("a routine's run in the sidebar", () => {
  it('carries the Routines clock, and the conversation it came from does not', () => {
    const html = sidebar([row('mission_person'), row('mission_replay', { routineId: 'rt_morning' })], [routine])
    expect(html.match(/lc-conv__routine/g)).toHaveLength(1)
    expect(html).toContain('aria-label="From the routine Morning check"')
  })

  it('says whose each row is, and which routine, on hover', () => {
    const html = sidebar([row('mission_person'), row('mission_replay', { routineId: 'rt_morning' })], [routine])
    expect(html).toContain('title="Read the README and list the TODOs · Wren"')
    expect(html).toContain('title="Read the README and list the TODOs · Wren · from the routine Morning check"')
    // The face names its teammate rather than hiding from a screen reader.
    expect(html).toContain('aria-label="Wren"')
  })

  it('still marks a run whose routine was since deleted', () => {
    const html = sidebar([row('mission_replay', { routineId: 'rt_gone' })], [])
    expect(html).toContain('aria-label="From a routine"')
  })

  it('says which step it is on while it runs, where its age would be', () => {
    const running = row('mission_replay', { routineId: 'rt_morning', phase: 'running' })
    const html = sidebar([running], [routine], { tm_wren: { name: 'Morning check', step: 2, of: 3 } })
    expect(html).toContain('title="Morning check: step 2 of 3">step 2 of 3</span>')
    // Finished, it is back to its age.
    expect(sidebar([row('mission_replay', { routineId: 'rt_morning' })], [routine], { tm_wren: { name: 'Morning check', step: 2, of: 3 } })).not.toContain('step 2 of 3')
  })

  it('names the step in the header, in place of "running"', () => {
    expect(routineStepPhrase({ kind: 'routine', routineId: 'rt_morning', step: 2 }, [{ routineId: 'rt_morning', name: 'Morning check', steps: ['a', 'b', 'c'] }])).toBe('routine Morning check, step 2 of 3')
    expect(routineStepPhrase({ kind: 'routine', routineId: 'rt_gone', step: 1 }, [])).toBe('routine, step 1')
    expect(routineStepPhrase({ kind: 'relay' }, [])).toBeUndefined()
    expect(routineStepPhrase(undefined, [])).toBeUndefined()
  })

  it('reads a routine from a live starter or a recorded one, and nothing else', () => {
    expect(routineOf({ kind: 'routine', routineId: 'rt_morning' })).toBe('rt_morning')
    expect(routineOf({ kind: 'relay' })).toBeUndefined()
    expect(routineOf(undefined)).toBeUndefined()
  })
})
