import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { PublicRoom, PublicTeammate } from '../../shared/ipc.js'
import { MAX_LIVE_MISSIONS, MAX_ROOM_TEAMMATES } from '../../shared/live-missions.js'
import { RoomScreen, roomFullNote } from './components/RoomScreen.js'

/**
 * A room too big to make says so while it can still be changed.
 *
 * This file began as the over-cap warning, on 2026-09-09: the mission cap
 * was 4 and the room limit 8, so a six-member room offered all six, started
 * four, and drew the other two as empty cards. That sentence is gone,
 * because the cap was measured and raised to 8 and the two limits are now
 * held equal by `room-and-mission-caps-agree` — a room can no longer outgrow
 * what can run.
 *
 * What is left is the limit that DOES still bite, and which nothing said.
 * The member picker offers every teammate on the roster, so ticking a ninth
 * was allowed and Create room then failed with "A room needs between 1 and 8
 * teammates." Offered and then refused, in the one screen where the number
 * can still change.
 *
 * The design agent's objection to amber was that the cap is a fact about the
 * machine and nothing about it is the reader's to do. That holds, and it is
 * why the old sentence is not simply reworded: this one is a different fact.
 * The room cannot be made and unticking is theirs to do, so amber is right
 * here. The register was wrong because the fact was wrong.
 */

const teammate = (id: string, name: string): PublicTeammate =>
  ({
    teammateId: id,
    name,
    hue: 'lime',
    role: 'Code & Migrations',
    createdAt: '2026-09-05T05:00:00.000Z',
    avatar: { headwear: 0, accessory: 0, mouth: 0 }
  }) as PublicTeammate

const ROSTER = Array.from({ length: MAX_ROOM_TEAMMATES + 3 }, (_unused, i) =>
  teammate(`tm_${String(i)}`, `Mate${String(i)}`)
)

const room = (members: number): PublicRoom => ({
  roomId: 'room_standup',
  name: 'Standup',
  teammateIds: ROSTER.slice(0, members).map((entry) => entry.teammateId),
  createdAt: '2026-09-05T05:00:00.000Z',
  posts: [],
  tasks: []
})

function open(members: number): string {
  return renderToStaticMarkup(
    <RoomScreen
      rooms={[room(members)]}
      teammates={ROSTER}
      currentRoomId="room_standup"
      answersFor={() => []}
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

describe('a room the store would refuse', () => {
  it('is a state a person can actually get into', () => {
    /*
     * The control, and the reason this warning exists at all. The picker
     * offers every teammate on the roster with no limit of its own, so a
     * roster larger than the room limit is the ordinary case, not an
     * exotic one.
     */
    expect(ROSTER.length).toBeGreaterThan(MAX_ROOM_TEAMMATES)
    expect(open(MAX_ROOM_TEAMMATES)).toContain('Post to Standup')
  })

  it('says what is wrong and what to do about it', () => {
    expect(roomFullNote(MAX_ROOM_TEAMMATES + 1)).toBe(
      `A room holds ${String(MAX_ROOM_TEAMMATES)} teammates. Untick 1 to make this one.`
    )
    expect(roomFullNote(MAX_ROOM_TEAMMATES + 3)).toContain('Untick 3')
  })

  it('stays quiet at and under the limit', () => {
    // An off-by-one here would nag every full room about a limit it reaches
    // exactly and never exceeds.
    expect(roomFullNote(MAX_ROOM_TEAMMATES)).toBeUndefined()
    expect(roomFullNote(1)).toBeUndefined()
    expect(roomFullNote(0)).toBeUndefined()
  })

  it('no longer claims a full room will not all start', () => {
    /*
     * THE regression this file was written for, now impossible by
     * construction rather than by wording. A room can hold at most
     * MAX_ROOM_TEAMMATES and that many missions can run, so no post is
     * short of slots on its own account.
     */
    expect(MAX_ROOM_TEAMMATES).toBeLessThanOrEqual(MAX_LIVE_MISSIONS)
    const full = open(MAX_ROOM_TEAMMATES)
    /*
     * The absence is the whole claim, and it used to be checked alongside the
     * PRESENCE of a standing sentence -- "Goes to 8 teammates, each on their
     * own route" -- which was never what this file is about. That sentence
     * was removed as filler on 2026-09-11 and took this test red with it,
     * which is the tell: an assertion that goes red when something unrelated
     * is reworded was pinning a wording, not a fact.
     *
     * The room is drawn and it does not warn. That is the regression.
     */
    expect(full).toContain('Post to Standup')
    expect(full).not.toContain('will not start')
    expect(full).not.toContain('will not all start')
  })
})
