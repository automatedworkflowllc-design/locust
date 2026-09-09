import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { PublicRoom, PublicTeammate } from '../../shared/ipc.js'
import { MAX_LIVE_MISSIONS } from '../../shared/live-missions.js'
import { RoomScreen, overCapNote } from './components/RoomScreen.js'

/**
 * What the room says about a post it cannot run in full.
 *
 * Found driving a six-member room on 2026-09-09. The mission cap was 4 and
 * the room limit was 8, so the form offered all six teammates, took all six,
 * started FOUR, drew the other two as empty cards reading "did not start",
 * and then said "Everyone in Standup has answered." The host's refusal
 * naming those two was shown in the same slot and was replaced by the false
 * line, so the one true sentence on the screen was overwritten.
 *
 * The cap was then measured and raised to 8, matching the room limit, and
 * `room-and-mission-caps-agree.test.ts` holds them together. So a room can
 * no longer be built bigger than what can run, and the sentences below are
 * now a guard rather than a description of today's screen.
 *
 * They stay because the cap is still reachable another way: it counts every
 * live mission, not just this room's, so a room of eight posted while other
 * missions are running still refuses some of its members. And because the
 * two numbers could move apart again -- which is the whole reason the other
 * test exists.
 */

const teammate = (id: string, name: string): PublicTeammate =>
  ({
    teammateId: id,
    name,
    hue: 'lime',
    role: 'Code & Migrations',
    createdAt: '2026-09-05T05:00:00.000Z',
    // A real face. PixelFace indexes the headwear and accessory tables
    // directly, so a teammate without one renders as a crash rather than as
    // a blank -- fair of it, and not this test's subject.
    avatar: { headwear: 0, accessory: 0, mouth: 0 }
  }) as PublicTeammate

const NAMES = ['Wren', 'Booty', 'Gem', 'Fen', 'Otto', 'Pike', 'Ash', 'Bryn']
const ROSTER = NAMES.map((name, i) => teammate(`tm_${String(i)}`, name))

const room = (members: number): PublicRoom => ({
  roomId: 'room_standup',
  name: 'Standup',
  teammateIds: ROSTER.slice(0, members).map((entry) => entry.teammateId),
  createdAt: '2026-09-05T05:00:00.000Z',
  posts: [],
  tasks: []
})

/** The room screen with one room open, rendered the way the app renders it. */
function open(members: number): string {
  return renderToStaticMarkup(
    <RoomScreen
      rooms={[room(members)]}
      teammates={ROSTER}
      currentRoomId="room_standup"
      answersFor={() => []}
      runtimeNameOf={(id) => id}
      onSelectRoom={() => undefined}
      onCreateRoom={async () => undefined}
      onRemoveRoom={() => undefined}
      onPost={async () => undefined}
      onOpenMission={() => undefined}
      onTask={async () => undefined}
      notice={undefined}
    />
  )
}

describe('the note under a room composer', () => {
  it('is rendered at all', () => {
    // The control. A RoomScreen that threw, or drew the room list instead of
    // the open room, would satisfy every `not.toContain` below by drawing
    // no composer.
    expect(open(MAX_LIVE_MISSIONS)).toContain('Post to Standup')
  })

  it('says how many would not start, when that can happen', () => {
    const said = overCapNote(MAX_LIVE_MISSIONS + 2)
    expect(said).toContain(`Only ${String(MAX_LIVE_MISSIONS)} missions run at once`)
    expect(said).toContain('2 will not start')
    // One over is the case that used to be silent.
    expect(overCapNote(MAX_LIVE_MISSIONS + 1)).toContain('1 will not start')
  })

  it('stays quiet at and under the cap', () => {
    // An off-by-one here would nag every full room about a limit it reaches
    // exactly and never exceeds -- which, now that the two caps agree, is
    // every room there is.
    expect(overCapNote(MAX_LIVE_MISSIONS)).toBeUndefined()
    expect(overCapNote(1)).toBeUndefined()
    expect(overCapNote(0)).toBeUndefined()
  })

  it('tells a full room its post goes to everyone, because now it does', () => {
    const full = open(MAX_LIVE_MISSIONS)
    expect(full).toContain(`Goes to ${String(MAX_LIVE_MISSIONS)} teammates, each on their own route`)
    expect(full).not.toContain('will not start')
  })
})
