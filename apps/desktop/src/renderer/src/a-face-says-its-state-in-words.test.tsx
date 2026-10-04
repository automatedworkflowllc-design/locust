import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { seedAvatar } from '../../shared/avatar.js'
import type { PublicTeammate } from '../../shared/ipc.js'
import { Sidebar } from './components/Sidebar.js'
import { stateInWords } from './status.js'
import type { TeammateStatusView } from './status.js'

/**
 * A FACE SAYS ITS STATE IN WORDS.
 *
 * On the faces strip and in the compact rail a bot stands with no words
 * beside it: "working" and "waiting on you" were motion, a dot and a colour,
 * and a screen reader heard only the name (the harness pass, 2026-09-23 --
 * B4's remainder; Yurt's #4, High Contrast, had already taken colour away).
 * The state goes in the description; the name stays what pressing the face
 * does, which is also how every drive finds one.
 */
const wren = { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-23T05:00:00.000Z', avatar: seedAvatar('tm_wren') } as PublicTeammate
const sable = { teammateId: 'tm_sable', name: 'Sable', hue: 'clay', role: 'Ops & Scheduling', createdAt: '2026-09-23T05:00:01.000Z', avatar: seedAvatar('tm_sable') } as PublicTeammate

const working: TeammateStatusView = { status: 'working', activity: 'working', label: 'Code & Migrations · working', tone: 'live', pulse: true }
const waiting: TeammateStatusView = { status: 'approval-needed', activity: 'waiting', label: 'Code & Migrations · waiting on you', tone: 'amber', pulse: false }
const signedOut: TeammateStatusView = { status: 'blocked', activity: 'blocked', label: 'Runtime sign-in required', tone: 'red', pulse: false }

const noop = (): void => undefined

function sidebar(views: Readonly<Record<string, TeammateStatusView>>, compact = false): string {
  return renderToStaticMarkup(
    <Sidebar
      runtimes={[]}
      missions={[]}
      teammates={[wren, sable]}
      viewByTeammate={views}
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
      compact={compact}
    />
  )
}

describe('a state in words', () => {
  it('is what the teammate is doing, or why they are blocked', () => {
    expect(stateInWords(working)).toBe('working')
    expect(stateInWords(waiting)).toBe('waiting on you')
    expect(stateInWords(signedOut)).toBe('Runtime sign-in required')
  })
})

describe('the faces strip', () => {
  it('tells a screen reader what each face is doing, and keeps the name the drives find it by', () => {
    const html = sidebar({ tm_wren: working, tm_sable: signedOut })
    expect(html).toContain('aria-label="Wren — open their conversation" aria-description="working"')
    expect(html).toContain('aria-label="Sable — open their conversation" aria-description="Runtime sign-in required"')
  })
})

describe('the compact rail', () => {
  it('says the state its hidden row would have shown', () => {
    const html = sidebar({ tm_wren: waiting, tm_sable: working }, true)
    expect(html).toMatch(/aria-label="Message Wren · Code &amp; Migrations" aria-description="waiting on you"/)
    expect(html).toMatch(/aria-label="Message Sable · Ops &amp; Scheduling" aria-description="working"/)
  })
})
