import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { PublicRoom, PublicTeammate } from '../../shared/ipc.js'
import { RoomScreen } from './components/RoomScreen.js'
import type { RoomAnswer } from './components/RoomScreen.js'

/**
 * ASK ONE TEAMMATE IN A ROOM (0.371), as the room draws it: every answer has
 * a Reply, a post put to someone says so beside its time, and the members it
 * was not put to are not reported as "not asked" -- the person chose that.
 */
const teammate = (id: string, name: string): PublicTeammate =>
  ({
    teammateId: id,
    name,
    hue: 'lime',
    role: 'Code & Migrations',
    createdAt: '2026-09-26T05:00:00.000Z',
    avatar: { headwear: 0, accessory: 0, mouth: 0 }
  }) as PublicTeammate
const ROSTER = [teammate('tm_wren', 'Wren'), teammate('tm_pip', 'Pip'), teammate('tm_booty', 'Booty')]
const answer = (teammateId: string, postId: string): RoomAnswer =>
  ({
    teammateId,
    missionId: `m_${teammateId}_${postId}`,
    phase: 'completed',
    text: 'DONE',
    startedAt: '2026-09-26T05:00:00.000Z',
    items: [{ key: `msg_${teammateId}`, type: 'agent-message', text: 'DONE', streaming: false }],
    runtime: 'opencode',
    model: 'free'
  }) as RoomAnswer

function screen(posts: PublicRoom['posts'], answered: Record<string, readonly string[]>): string {
  const room: PublicRoom = {
    roomId: 'room_pair',
    name: 'pair',
    teammateIds: ROSTER.map((entry) => entry.teammateId),
    createdAt: '2026-09-26T05:00:00.000Z',
    posts,
    tasks: []
  }
  return renderToStaticMarkup(
    <RoomScreen
      rooms={[room]}
      teammates={ROSTER}
      currentRoomId="room_pair"
      answersFor={(_, postId) => (answered[postId] ?? []).map((id) => answer(id, postId))}
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

describe('a room where a post was put to one teammate', () => {
  const posts: PublicRoom['posts'] = [
    { postId: 'post_all', text: 'Everyone, a word.', at: '2026-09-26T05:01:00.000Z', missions: { tm_wren: 'm1', tm_pip: 'm2' } },
    { postId: 'post_wren', text: 'Wren, say more.', at: '2026-09-26T05:02:00.000Z', missions: { tm_wren: 'm3' }, to: ['tm_wren'] }
  ]
  const html = screen(posts, { post_all: ['tm_wren', 'tm_pip'], post_wren: ['tm_wren'] })

  it('draws every answer, each with a Reply beside its Open', () => {
    expect([...html.matchAll(/lc-roomanswer"/g)]).toHaveLength(3)
    expect([...html.matchAll(/aria-label="Reply to Wren"/g)]).toHaveLength(2)
    expect([...html.matchAll(/aria-label="Reply to Pip"/g)]).toHaveLength(1)
  })

  it('says who the post was put to, beside its time, and only on that post', () => {
    expect(html).toContain('To Wren · ')
    expect([...html.matchAll(/lc-roompost__to/g)]).toHaveLength(1)
  })

  it('does not report the others as not asked on the post put to Wren -- but still does on a post to everyone', () => {
    // Booty did not answer the first post, which was put to everyone: said.
    expect(html).toContain('Booty was not asked')
    // Pip and Booty were not asked the second: the person chose that. Said once only.
    expect([...html.matchAll(/was not asked|were not asked/g)]).toHaveLength(1)
  })

  it('asks everyone until someone is named', () => {
    expect(html).toContain('placeholder="Post to pair…"')
    expect(html).not.toContain('lc-askto')
  })
})
