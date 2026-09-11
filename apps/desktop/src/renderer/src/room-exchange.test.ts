import { describe, expect, it } from 'vitest'

import { footLine, postBecameAnExchange, sequenceOfPost } from './roomExchange.js'
import type { PostForExchange, SequenceInput } from './roomExchange.js'
import type { ExchangeMission } from './exchange.js'

/**
 * A post that became an argument stops being a grid.
 *
 * Colin, 2026-09-11: "shouldnt they be able to see eachothers messages? and
 * have it contained to that room?" Wren and Gem argued four replies deep and
 * the room showed one opening card each, so they read as talking past each
 * other while the argument itself sat in two separate mission threads.
 *
 * The design agent's ruling: a grid is a CLAIM -- these arrived in parallel
 * and none is a reply to another -- false the instant message three answers
 * message two. So a post with an exchange becomes a sequence, first answers
 * included, and absence is drawn because dropping a silent turn makes the
 * reader blame the budget.
 */

const POST: PostForExchange = {
  postId: 'post_1',
  at: '2026-09-11T10:00:00.000Z',
  missions: { tm_wren: 'm_wren1', tm_gem: 'm_gem1' }
}

const NAMES: Record<string, string> = { tm_wren: 'Wren', tm_gem: 'Gem' }

const mission = (missionId: string, teammateId: string): ExchangeMission => ({
  missionId,
  runtime: 'cursor',
  model: 'composer-2.5',
  events: [],
  peerMessages: [],
  teammateId,
  live: false
})

/** A four-turn argument: Wren, Gem, Wren, Gem. */
const ARGUMENT = {
  m_wren1: { owner: 'tm_wren', at: '2026-09-11T10:00:01.000Z', text: 'Tabs.' },
  m_gem1: { owner: 'tm_gem', at: '2026-09-11T10:00:02.000Z', text: 'Until a line wraps.' },
  m_wren2: { owner: 'tm_wren', at: '2026-09-11T10:00:03.000Z', text: 'Do not align past the indent.' },
  m_gem2: { owner: 'tm_gem', at: '2026-09-11T10:00:04.000Z', text: 'Formatters emit spaces.' }
} as const

function input(overrides: Partial<SequenceInput> = {}): SequenceInput {
  const reached = Object.keys(ARGUMENT)
  const missions = new Map<string, ExchangeMission>(
    reached.map((id) => [id, mission(id, ARGUMENT[id as keyof typeof ARGUMENT].owner)])
  )
  return {
    post: POST,
    missions,
    reached,
    textOf: (id) => ARGUMENT[id as keyof typeof ARGUMENT]?.text,
    startedAtOf: (id) => ARGUMENT[id as keyof typeof ARGUMENT]?.at,
    finishedOf: () => true,
    nameOf: (id) => NAMES[id] ?? 'someone',
    laterPostAt: undefined,
    hops: 4,
    cap: 6,
    cost: undefined,
    starting: [],
    ...overrides
  }
}

describe('whether a post is a conversation at all', () => {
  it('is not, when every member answered once and nobody replied', () => {
    expect(postBecameAnExchange(POST, ['m_wren1', 'm_gem1'])).toBe(false)
    // And the room is told to keep the grid it has.
    expect(sequenceOfPost(input({ reached: ['m_wren1', 'm_gem1'] }))).toBeUndefined()
  })

  it('is, the moment one more run exists than the post started', () => {
    expect(postBecameAnExchange(POST, ['m_wren1', 'm_gem1', 'm_wren2'])).toBe(true)
  })
})

describe('the sequence', () => {
  it('is every turn in the order it was said, first answers included', () => {
    const found = sequenceOfPost(input())!
    expect(found.items.map((item) => [item.kind, item.name])).toEqual([
      ['said', 'Wren'],
      ['said', 'Gem'],
      ['said', 'Wren'],
      ['said', 'Gem']
    ])
  })

  it('groups consecutive turns by one speaker under a single face', () => {
    // Gem says two things while Wren is busy, which is the ordinary rhythm of
    // a fits-and-starts argument. Drawing that as two speakers is a lie about
    // the rhythm (design agent).
    const twice = {
      ...ARGUMENT,
      m_wren2: { owner: 'tm_gem', at: '2026-09-11T10:00:03.000Z', text: 'And another thing.' }
    }
    const found = sequenceOfPost(
      input({
        textOf: (id) => twice[id as keyof typeof twice]?.text,
        startedAtOf: (id) => twice[id as keyof typeof twice]?.at,
        missions: new Map(Object.keys(twice).map((id) => [id, mission(id, twice[id as keyof typeof twice].owner)]))
      })
    )!
    expect(found.items.map((item) => (item.kind === 'said' ? item.startsSpeaker : null))).toEqual([
      true,
      true,
      false,
      false
    ])
  })

  it('draws a finished turn that said nothing, because absence is information', () => {
    const found = sequenceOfPost(input({ textOf: (id) => (id === 'm_wren2' ? undefined : ARGUMENT[id as keyof typeof ARGUMENT]?.text) }))!
    const silent = found.items.find((item) => item.kind === 'silent')
    expect(silent).toMatchObject({ kind: 'silent', name: 'Wren', missionId: 'm_wren2' })
    // In its place in the argument, not appended at the end.
    expect(found.items.indexOf(silent!)).toBe(2)
  })

  it('draws a run that is still going as the turn it is, never as a silence', () => {
    // It has not spoken YET. Drawing it as silent claims something about a
    // run that may be about to answer; drawing nothing at all is what made a
    // room mid-argument read as finished.
    const found = sequenceOfPost(
      input({
        textOf: (id) => (id === 'm_gem2' ? undefined : ARGUMENT[id as keyof typeof ARGUMENT]?.text),
        finishedOf: (id) => id !== 'm_gem2'
      })
    )!
    expect(found.items.some((item) => item.kind === 'silent')).toBe(false)
    expect(found.items.at(-1)).toMatchObject({ kind: 'replying', name: 'Gem', missionId: 'm_gem2' })
  })

  it('lists a member waiting for a slot, so the room does not look finished', () => {
    const found = sequenceOfPost(input({ post: { ...POST, waiting: ['tm_gem'] } }))!
    expect(found.items.at(-1)).toMatchObject({ kind: 'waiting', name: 'Gem' })
  })
})

/*
 * Between the host deciding on a hop and the runtime existing, the window is
 * told nothing -- `mission-started` needs a run id, and a cold start is long
 * enough to read as the end of the argument (MEASURED 2026-09-11: the room
 * probe's quiet window had to go from 4s to 20s to stop screenshotting a room
 * mid-hop). `relay-starting` is that seam, and this is what a room does with
 * it.
 */
describe('a reply the host is still starting', () => {
  const STARTING = [{ teammateId: 'tm_wren', answering: 'm_gem2' }]

  it('is a turn in the sequence, with no mission of its own yet', () => {
    const found = sequenceOfPost(input({ starting: STARTING }))!
    expect(found.items.at(-1)).toMatchObject({ kind: 'replying', name: 'Wren', missionId: undefined })
  })

  it('makes a post a conversation on its own, before the second run exists', () => {
    // Two members, two answers, nobody has replied yet -- but a reply IS
    // being started, so the grid is already the wrong claim.
    const found = sequenceOfPost(input({ reached: ['m_wren1', 'm_gem1'], starting: [{ teammateId: 'tm_wren', answering: 'm_gem1' }] }))
    expect(found?.items.at(-1)).toMatchObject({ kind: 'replying', name: 'Wren' })
  })

  it('belongs to the post whose conversation it answers, and no other', () => {
    expect(sequenceOfPost(input({ starting: [{ teammateId: 'tm_wren', answering: 'm_elsewhere' }] }))!.items
      .some((item) => item.kind === 'replying')).toBe(false)
  })

  it('is not drawn twice when the run it becomes has already been announced', () => {
    // `relay-starting` and `mission-started` overlap by a frame. One person
    // cannot answer twice.
    const found = sequenceOfPost(
      input({
        textOf: (id) => (id === 'm_wren2' ? undefined : ARGUMENT[id as keyof typeof ARGUMENT]?.text),
        finishedOf: (id) => id !== 'm_wren2',
        starting: [{ teammateId: 'tm_wren', answering: 'm_gem1' }]
      })
    )!
    expect(found.items.filter((item) => item.kind === 'replying')).toHaveLength(1)
  })

  it('is not an ending, even with the budget spent', () => {
    // The reply the reader is waiting for is in flight. Telling them to post
    // again would be wrong twice: it is not over, and it is not their turn.
    expect(sequenceOfPost(input({ hops: 6, cap: 6, starting: STARTING }))!.foot.ending).toBeUndefined()
    expect(sequenceOfPost(input({ hops: 6, cap: 6 }))!.foot.ending).toBe('out-of-replies')
  })
})

describe('a message that arrived after a newer post', () => {
  it('shows its time, because otherwise it reads as inserted into the past', () => {
    const found = sequenceOfPost(input({ laterPostAt: '2026-09-11T10:00:02.500Z' }))!
    expect(found.items.map((item) => (item.kind === 'said' ? item.showTime : null))).toEqual([
      false,
      false,
      true,
      true
    ])
  })

  it('shows no time at all when this is the newest post', () => {
    const found = sequenceOfPost(input())!
    expect(found.items.every((item) => item.kind !== 'said' || item.showTime === false)).toBe(true)
  })
})

describe('the foot', () => {
  it('reads as a runway while the argument is still going', () => {
    const found = sequenceOfPost(input({ hops: 4, cap: 6 }))!
    expect(found.foot.ending).toBeUndefined()
    expect(footLine(found.foot, '75k in · 1.8k out')).toBe('4 of 6 automatic replies · 75k in · 1.8k out')
  })

  it('names the cause and points at the composer once the budget is spent', () => {
    const found = sequenceOfPost(input({ hops: 6, cap: 6 }))!
    expect(found.foot.ending).toBe('out-of-replies')
    expect(footLine(found.foot, '81k in · 2.1k out')).toBe(
      '6 of 6 automatic replies · 81k in · 2.1k out — post again to continue.'
    )
  })

  it('says the budget even where nothing reported a cost', () => {
    expect(footLine({ hops: 1, cap: 1, cost: undefined, ending: 'out-of-replies' }, undefined)).toBe(
      '1 of 1 automatic reply — post again to continue.'
    )
  })
})
