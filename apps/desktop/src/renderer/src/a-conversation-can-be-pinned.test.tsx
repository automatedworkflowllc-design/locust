import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'

import { createTeammateStore, MAX_MISSION_PINS } from '../../main/teammate-store.js'
import { Sidebar } from './components/Sidebar.js'
import type { SidebarMission } from './components/Sidebar.js'

/*
 * A CONVERSATION CAN BE PINNED (0.729), as Claude's own list keeps its starred ones: the plan's "Settle, snooze and
 * pin conversations", its first part. Pinned conversations sit at the top of the sidebar, newest pin first, and the
 * pins are kept with the names people give conversations, so they come back after a restart.
 */
const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })))
})
const folder = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'locust-pins-'))
  roots.push(root)
  return root
}

describe('pinning a conversation', () => {
  it('is kept, newest pin first, and still there after Locust opens again', async () => {
    const root = await folder()
    const teammates = createTeammateStore({ rootDirectory: root })
    await teammates.pinMission('m_1', true)
    await teammates.pinMission('m_2', true)
    await teammates.pinMission('m_1', true)
    expect(await teammates.missionPins()).toEqual(['m_1', 'm_2'])
    await teammates.pinMission('m_2', false)
    expect(await createTeammateStore({ rootDirectory: root }).missionPins()).toEqual(['m_1'])
  })

  it('takes no id it would not take for a name, and stops at the cap with a reason', async () => {
    const teammates = createTeammateStore({ rootDirectory: await folder() })
    await expect(teammates.pinMission('../escape', true)).rejects.toThrow()
    for (let at = 0; at < MAX_MISSION_PINS; at += 1) await teammates.pinMission(`m_${String(at)}`, true)
    await expect(teammates.pinMission('m_one_more', true)).rejects.toThrow(/At most 50/)
    // Unpinning one at the cap still works, and makes room.
    await teammates.pinMission('m_0', false)
    await teammates.pinMission('m_one_more', true)
    expect((await teammates.missionPins())[0]).toBe('m_one_more')
  })
})

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
