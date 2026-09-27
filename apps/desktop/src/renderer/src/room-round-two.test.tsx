import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { PublicRoom, PublicTeammate } from '../../shared/ipc.js'
import { RoomScreen } from './components/RoomScreen.js'
import type { RoomAnswer } from './components/RoomScreen.js'
import source from './components/RoomScreen.tsx?raw'

/**
 * ROOMS, ROUND TWO (0.399): Build on one answer, Merge them all, and read
 * them side by side. Build on and Merge only write your next post; they are
 * offered on a finished answer, and Merge only where there is more than one
 * finished answer to merge. _tools/drive-room-round-two.mjs presses them.
 */
const teammate = (id: string, name: string): PublicTeammate =>
  ({
    teammateId: id,
    name,
    hue: 'lime',
    role: 'Code & Migrations',
    createdAt: '2026-09-27T05:00:00.000Z',
    avatar: { headwear: 0, accessory: 0, mouth: 0 }
  }) as PublicTeammate
const ROSTER = [teammate('tm_wren', 'Wren'), teammate('tm_pip', 'Pip')]
const answer = (teammateId: string, postId: string, phase: RoomAnswer['phase']): RoomAnswer =>
  ({
    teammateId,
    missionId: `m_${teammateId}_${postId}`,
    phase,
    text: phase === 'completed' ? 'apple' : '',
    startedAt: '2026-09-27T05:00:00.000Z',
    items: phase === 'completed' ? [{ key: `msg_${teammateId}`, type: 'agent-message', text: 'apple', streaming: false }] : [],
    runtime: 'opencode',
    model: 'free'
  }) as RoomAnswer

function screen(phases: Record<string, RoomAnswer['phase']>): string {
  const room: PublicRoom = {
    roomId: 'room_pair',
    name: 'pair',
    teammateIds: ROSTER.map((entry) => entry.teammateId),
    createdAt: '2026-09-27T05:00:00.000Z',
    posts: [{ postId: 'post_1', text: 'A fruit each.', at: '2026-09-27T05:01:00.000Z', missions: { tm_wren: 'm1', tm_pip: 'm2' } }],
    tasks: []
  }
  return renderToStaticMarkup(
    <RoomScreen
      rooms={[room]}
      teammates={ROSTER}
      currentRoomId="room_pair"
      answersFor={() => Object.entries(phases).map(([id, phase]) => answer(id, 'post_1', phase))}
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
const count = (html: string, pattern: RegExp): number => [...html.matchAll(pattern)].length

describe('a post with two finished answers', () => {
  const html = screen({ tm_wren: 'completed', tm_pip: 'completed' })

  it('offers Build on and Merge on each', () => {
    expect(count(html, />Build on</g)).toBe(2)
    expect(count(html, />Merge</g)).toBe(2)
  })

  it('opens one under another, with the side-by-side switch off', () => {
    expect(html).toContain('aria-label="Answers side by side"')
    expect(html).toContain('aria-pressed="false"')
    expect(html).not.toContain('is-columns')
  })
})

describe('a post with one answer still running', () => {
  const html = screen({ tm_wren: 'completed', tm_pip: 'running' })

  it('offers Build on only on the finished one, and no Merge -- there is one answer to merge', () => {
    expect(count(html, />Build on</g)).toBe(1)
    expect(html).not.toContain('>Merge<')
  })
})

describe('what the buttons write', () => {
  it('Build on asks everyone and names whose answer', () => {
    expect(source).toMatch(/const buildOn = \(name: string\): void => \{\s*setAskTo\(\[\]\)\s*setDraftText\(`Build on \$\{name\}\\u2019s answer above: `\)/)
  })

  it('Merge asks the one teammate, and asks for agreement, difference and whose', () => {
    expect(source).toMatch(/const mergeBy = \(teammateId: string\): void => \{\s*setAskTo\(\[teammateId\]\)/)
    expect(source).toContain('keep what they agree on, say plainly where they differ, and name whose each part was.')
  })

  it('neither sends anything', () => {
    const body = source.slice(source.indexOf('const buildOn'), source.indexOf('const [sideBySide'))
    expect(body).not.toMatch(/onPost|send\(/)
  })

  it('columns only when there is more than one answer', () => {
    expect(source).toContain("sideBySide && answers.length > 1 ? ' is-columns' : ''")
  })
})
