import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { PublicRoom, PublicTeammate } from '../../shared/ipc.js'
import { MAX_LIVE_MISSIONS } from '../../shared/live-missions.js'
import { RoomScreen, overCapNote } from './components/RoomScreen.js'

/**
 * A room bigger than the live-mission cap says so BEFORE the post.
 *
 * Found driving a six-member room on 2026-09-09. The form offered all six
 * teammates and took all six. The composer promised "Goes to 6 teammates,
 * each on their own route." The post started FOUR -- `MAX_LIVE_MISSIONS` is
 * a resource bound and the fifth and sixth starts were refused -- and Otto
 * and Pike were drawn as empty cards reading "did not start", with no reason
 * given anywhere on the screen.
 *
 * The refusal WAS said, once, in the note under the composer. Then the room
 * finished and overwrote that note with "Everyone in Standup has answered."
 * So the one true sentence on the screen was replaced by a false one, and
 * what was left looked like two teammates that silently broke.
 *
 * This covers the two fixes on the way IN. The third -- not calling four of
 * six everyone -- is in `room-tasks.test.ts`, where the false claim was made.
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

const NAMES = ['Wren', 'Booty', 'Gem', 'Fen', 'Otto', 'Pike']
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

describe('a room with more members than can run at once', () => {
  it('is a real gap, not a hypothetical one', () => {
    // The control. If the cap ever rises above the roster this file uses,
    // every assertion below would pass by describing a case that cannot
    // happen, and the screen could go back to saying nothing.
    expect(MAX_LIVE_MISSIONS).toBeLessThan(NAMES.length)
    // And the screen must actually be rendering: without this, a RoomScreen
    // that threw or drew the empty list would satisfy every `not.toContain`.
    expect(open(6)).toContain('Post to Standup')
  })

  it('says how many will not start, and how many will', () => {
    const said = overCapNote(6)
    expect(said).toBe('Only 4 missions run at once, so a post to 6 starts 4 and 2 will not start.')
    // The exact case that was silent: one over the cap.
    expect(overCapNote(MAX_LIVE_MISSIONS + 1)).toContain('1 will not start')
  })

  it('stays quiet at and under the cap', () => {
    // An off-by-one here would nag every four-member room about a limit it
    // never reaches.
    expect(overCapNote(MAX_LIVE_MISSIONS)).toBeUndefined()
    expect(overCapNote(1)).toBeUndefined()
    expect(overCapNote(0)).toBeUndefined()
  })

  it('puts it under the composer of a room that is already too big', () => {
    const big = open(6)
    // THE regression: the only thing the composer said was the claim that
    // the post goes to all six.
    expect(big).not.toContain('Goes to 6 teammates, each on their own route')
    expect(big).toContain('2 will not start')
  })

  it('leaves a room the cap does not bite alone', () => {
    const small = open(3)
    expect(small).toContain('Goes to 3 teammates, each on their own route')
    expect(small).not.toContain('will not start')
  })
})
