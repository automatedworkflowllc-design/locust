import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { PublicRoom, PublicTeammate } from '../../shared/ipc.js'
import { ANSWERS_BEFORE_A_LIST, RoomScreen, absentLine, refusalNotice } from './components/RoomScreen.js'
import type { RoomAnswer } from './components/RoomScreen.js'

/**
 * A member a post did not reach gets a line, not an empty answer card.
 *
 * Raised by the design agent on 2026-09-09 after reading `RoomScreen.tsx`
 * against that morning's captures, and it corrected my own description of
 * the defect. The absent member was not "an empty box with two grey words":
 * it was a full-width answer card carrying an avatar, a name and `did not
 * start`, followed by about 90px of void where a route, a phase row, an Open
 * button and an answer belong.
 *
 * Their argument is about shape rather than colour, and it holds. In a grid
 * of answers a card is a promise that an answer is inside it, so an empty one
 * reads as broken however it is toned -- `is-absent` carried no tone class at
 * all. And because a grid forces equal-height cells, the two empty cards took
 * their height from an unrelated string in a neighbouring cell: the model
 * name `opencode/muse-spark-1.3-contributor-free` wrapping to two mono lines
 * in Fen's card. Two empty boxes sized by someone else's model name.
 *
 * They share one fact, so they are one line.
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

const NAMES = ['Wren', 'Booty', 'Gem', 'Fen', 'Otto', 'Pike', 'Dell', 'Ember']
const ROSTER = NAMES.map((name, i) => teammate(`tm_${String(i)}`, name))

/*
 * `items` is what the room draws now -- the thread's own renderer, one per
 * teammate -- so a fixture without it draws nothing at all. `text` stays
 * because the collapsed list past six answers still uses it.
 */
const answer = (teammateId: string): RoomAnswer =>
  ({
    teammateId,
    missionId: `m_${teammateId}`,
    phase: 'completed',
    text: 'ALMANAC',
    startedAt: '2026-09-05T05:00:00.000Z',
    items: [{ key: `msg_${teammateId}`, type: 'agent-message', text: 'ALMANAC', streaming: false }],
    runtime: 'opencode',
    model: 'free'
  }) as RoomAnswer

/** A room of six where only the first `started` members ran. */
function screen(started: number): string {
  const room: PublicRoom = {
    roomId: 'room_standup',
    name: 'Standup',
    teammateIds: ROSTER.map((entry) => entry.teammateId),
    createdAt: '2026-09-05T05:00:00.000Z',
    posts: [{ postId: 'post_1', text: 'Say your word', at: '2026-09-05T05:00:00.000Z', missions: {} }],
    tasks: []
  }
  const answers = ROSTER.slice(0, started).map((entry) => answer(entry.teammateId))
  return renderToStaticMarkup(
    <RoomScreen
      rooms={[room]}
      teammates={ROSTER}
      currentRoomId="room_standup"
      answersFor={() => answers}
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

describe('the members a post did not reach', () => {
  it('renders at all, with a card for everyone who did answer', () => {
    // The control. A screen that threw, or drew the room list, would satisfy
    // every `not.toContain` below by drawing nothing.
    const some = screen(4)
    expect(some).toContain('ALMANAC')
    expect([...some.matchAll(/lc-roomanswer"/g)]).toHaveLength(4)
  })

  it('gets no answer card, because there is no answer in it', () => {
    const some = screen(4)
    // THE regression: two more cards, each an avatar and a name over 90px of
    // nothing, sized by a neighbour's model name.
    expect(some).not.toContain('is-absent')
    expect(some).not.toContain('did not start')
    expect([...some.matchAll(/lc-roomanswer"/g)]).toHaveLength(4)
  })

  it('is one line naming everyone it missed', () => {
    const some = screen(4)
    expect(some).toContain('lc-roomabsent')
    expect(some).toContain('Otto, Pike, Dell and Ember were not asked')
  })

  it('says nothing when the post reached everyone', () => {
    const all = screen(NAMES.length)
    expect(all).not.toContain('lc-roomabsent')
    expect(all).not.toContain('not asked')
  })

  it('carries the host’s own recorded reason', () => {
    /*
     * The reason is a fact about the PAST, so it cannot be derived at render
     * time. The first version guessed it from how many missions this room
     * started, which was wrong the moment the cap was reached by work
     * ELSEWHERE: a room of eight posted beside three other live missions
     * started five, five is under the cap of eight, and the line dropped the
     * explanation on the one run where it mattered. Driven and seen on
     * 2026-09-09 before the reason was recorded on the post.
     */
    const cap = 'Up to 8 missions can run at once. Wait for one to finish or stop it first.'
    expect(absentLine([{ name: 'Otto', reason: cap }])).toBe(
      'Otto was not asked — up to 8 missions can run at once. Wait for one to finish or stop it first.'
    )
  })

  it('says one reason once, not once per person', () => {
    const cap = 'Up to 8 missions can run at once.'
    const said = absentLine([
      { name: 'Pike', reason: cap },
      { name: 'Dell', reason: cap },
      { name: 'Ember', reason: cap }
    ])
    expect(said).toBe('Pike, Dell and Ember were not asked — up to 8 missions can run at once.')
    expect([...(said ?? '').matchAll(/up to 8/gi)]).toHaveLength(1)
  })

  it('keeps different reasons apart, and says less when it has none', () => {
    const said = absentLine([
      { name: 'Otto', reason: 'Up to 8 missions can run at once.' },
      { name: 'Pike' }
    ])
    expect(said).toContain('Otto was not asked — up to 8 missions')
    // A post written before refusals were recorded. Inventing a reason here
    // would be worse than saying less.
    expect(said).toContain('Pike was not asked.')
    expect(absentLine([])).toBeUndefined()
  })

  it('joins names the way a person would', () => {
    expect(absentLine([{ name: 'Otto' }])).toContain('Otto was not asked')
    expect(absentLine([{ name: 'Otto' }, { name: 'Pike' }])).toContain('Otto and Pike were')
    expect(absentLine([{ name: 'Otto' }, { name: 'Pike' }, { name: 'Ash' }])).toContain('Otto, Pike and Ash were')
  })

  it('says one reason once, however many people it turned away', () => {
    const cap = 'Up to 8 missions can run at once. Wait for one to finish or stop it first.'
    /*
     * THE regression. This read "Otto: Up to 8 missions can run at once.
     * Wait for one to finish or stop it first. · Pike: Up to 8 missions can
     * run at once. Wait for one to finish or stop it first." -- one fact,
     * said twice, in the smallest text on the screen.
     */
    const said = refusalNotice([
      { name: 'Otto', message: cap },
      { name: 'Pike', message: cap }
    ])
    expect(said).toBe(`Otto, Pike: ${cap}`)
    expect([...(said ?? '').matchAll(/Up to 8/g)]).toHaveLength(1)
  })

  it('keeps different reasons apart', () => {
    const said = refusalNotice([
      { name: 'Otto', message: 'Up to 8 missions can run at once.' },
      { name: 'Pike', message: 'No longer on the roster.' }
    ])
    expect(said).toBe('Otto: Up to 8 missions can run at once. · Pike: No longer on the roster.')
  })

  it('says nothing when nobody was refused', () => {
    expect(refusalNotice([])).toBeUndefined()
  })

  /*
   * A grid forces equal-height cells and answers are of wildly unequal
   * length, so every row is as tall as its longest cell -- paid in
   * whitespace, and worse the wider the row. Raised by the design agent, and
   * the mechanism was visible in my own capture even with one-word answers:
   * two cards took their height from the model name wrapping in the card
   * beside them.
   *
   * The switch is on RENDERED answers, not room members, because rows are
   * what break: a room of eight where three were never asked draws five.
   */
  it('lays six or fewer answers out as a grid', () => {
    expect(screen(ANSWERS_BEFORE_A_LIST)).not.toContain('is-list')
    expect(screen(3)).not.toContain('is-list')
  })

  it('switches to a list past that', () => {
    expect(screen(ANSWERS_BEFORE_A_LIST + 1)).toContain('lc-roompost__answers is-list')
  })

  it('counts what is drawn, not who is in the room', () => {
    // Eight members, five answers: five rows, so it stays a grid. Counting
    // members would have listed a screen showing five cards.
    const room = screen(5)
    expect(room).not.toContain('is-list')
    expect([...room.matchAll(/lc-roomanswer"/g)]).toHaveLength(5)
  })

  /*
   * A room is read at a glance. One teammate writing five hundred lines
   * takes the screen and every other answer with it -- Colin, driving a
   * twelve-member room: "maybe have a dropdown or read more option for when
   * it goes down this far". The elision is a control, not a sentence, and it
   * is the shape the shell output already ships.
   */
  it('renders the whole answer, with nothing to open', () => {
    /*
     * The fold is gone (Colin, 2026-09-11: "just let them post uninhibited
     * in chat"). A room is where two teammates argue in front of you and the
     * argument is the content, so the whole of it is on screen -- no clamp,
     * no control, nothing to press.
     */
    const long = ['First paragraph.', 'Second paragraph.', 'Third paragraph.'].join('\n')
    const room: PublicRoom = {
      roomId: 'room_standup',
      name: 'Standup',
      teammateIds: [ROSTER[0]!.teammateId],
      createdAt: '2026-09-05T05:00:00.000Z',
      posts: [{ postId: 'post_1', text: 'Say your word', at: '2026-09-05T05:00:00.000Z', missions: {} }],
      tasks: []
    }
    const markup = renderToStaticMarkup(
      <RoomScreen
        rooms={[room]}
        teammates={ROSTER}
        currentRoomId="room_standup"
        answersFor={() => [{ ...answer(ROSTER[0]!.teammateId), text: long, items: [{ key: 'msg_long', type: 'agent-message', text: long, streaming: false }] }]}
        onSelectRoom={() => undefined}
        onCreateRoom={async () => undefined}
        onRemoveRoom={() => undefined}
        onPost={async () => undefined}
        onOpenMission={() => undefined}
        onTask={async () => undefined}
        notice={undefined}
      />
    )
    expect(markup).toContain('First paragraph.')
    expect(markup).toContain('Third paragraph.')
    expect(markup).not.toContain('is-folded')
    expect(markup).not.toContain('Show the rest')
  })

  it('leaves a short answer alone', () => {
    expect(screen(1)).not.toContain('Show the rest')
  })
})

describe('the task board, rebuilt on the plan card', () => {
  /*
   * Every row carried a state TAG, the text, an owner face and name, an Open
   * button and three ghost buttons -- six competing elements per line, all at
   * full strength, for a list of two. Colin, 2026-09-13: "that task bar at
   * the top is a disaster lets just scrap that for this plan ui asset that we
   * already have in the zip."
   *
   * A plan step is a marker, the words, and one quiet note. The app already
   * drew exactly that for a plan (`PlanSteps`), so the board is the same
   * shape now: the state IS the marker, the done row strikes itself through,
   * and the controls wait until you reach for them.
   */
  const withTasks = (tasks: PublicRoom['tasks']): string => {
    const room: PublicRoom = {
      roomId: 'room_standup',
      name: 'Standup',
      teammateIds: [ROSTER[0]!.teammateId],
      createdAt: '2026-09-05T05:00:00.000Z',
      posts: [],
      tasks
    }
    return renderToStaticMarkup(
      <RoomScreen
        rooms={[room]}
        teammates={ROSTER}
        currentRoomId="room_standup"
        answersFor={() => []}
        onSelectRoom={() => undefined}
        onCreateRoom={async () => undefined}
        onRemoveRoom={() => undefined}
        onRenameRoom={async () => undefined}
        onPost={async () => undefined}
        onOpenMission={() => undefined}
        onTask={async () => undefined}
        notice={undefined}
      />
    )
  }

  const task = (over: Partial<PublicRoom['tasks'][number]>): PublicRoom['tasks'][number] =>
    ({ taskId: 't1', text: 'Map v2 to v3 payloads', state: 'open', ...over }) as PublicRoom['tasks'][number]

  it('draws a step, not a tagged row', () => {
    const markup = withTasks([task({ state: 'done' })])
    expect(markup).toContain('lc-plan__step')
    expect(markup).toContain('lc-plan__marker')
    // The tag is what made it a dashboard row. The state is the marker now.
    expect(markup).not.toContain('lc-task__state')
    expect(markup).not.toContain('IN HAND')
  })

  it('counts the way the plan counts, so two lists do not use two phrasings', () => {
    const markup = withTasks([task({ state: 'done' }), task({ taskId: 't2', state: 'open' })])
    expect(markup).toContain('1 of 2 done')
    expect(markup).not.toContain('open ·')
  })

  it('still says the state for a reader who cannot see the marker', () => {
    expect(withTasks([task({ state: 'in-hand' })])).toContain('in hand')
  })

  it('still offers every control, because hiding them was never the point', () => {
    const markup = withTasks([task({})])
    for (const control of ['Assign', 'Done', 'Remove']) expect(markup).toContain(control)
  })
})
