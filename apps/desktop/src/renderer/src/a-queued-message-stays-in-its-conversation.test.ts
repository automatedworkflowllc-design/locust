import { describe, expect, it } from 'vitest'

import { combineQueued, QUEUE_SEPARATOR, queuedIn, takeNext, withoutQueueOf } from './steering.js'
import type { QueuedRow } from './steering.js'

/**
 * A QUEUED MESSAGE STAYS IN THE CONVERSATION IT WAS TYPED IN.
 *
 * The outside beta recheck of 0.299 (2026-09-23, P1): a line queued for Pip
 * while Pip worked showed under Gem's thread too, reading "sends when Gem
 * finishes", and Edit there rewrote Pip's -- "an edit intended for one
 * teammate changes another's pending work". The queue is every
 * conversation's rows in one list; the box showed its first row wherever you
 * were, Edit and Discard emptied all of it, and the fold that makes three
 * lines typed during one run into one message folded lines typed for two
 * teammates -- so one could be sent the other's instruction. Driven on the
 * packaged 0.299: drive-queue-per-conversation.
 */
const row = (id: string, key: string, over: Partial<QueuedRow> = {}): QueuedRow => ({
  id,
  key,
  text: `${key}: ${id}`,
  origin: 'person',
  ...over
})

describe("one conversation's queue", () => {
  it('is its own rows, in the order they were typed', () => {
    const rows = [row('a', 'pip'), row('b', 'gem'), row('c', 'pip')]
    expect(queuedIn(rows, 'pip').map((entry) => entry.id)).toEqual(['a', 'c'])
    expect(queuedIn(rows, 'gem').map((entry) => entry.id)).toEqual(['b'])
    expect(queuedIn(rows, 'nobody')).toEqual([])
    expect(queuedIn(rows, undefined)).toEqual([])
  })

  it("never folds into another conversation's message", () => {
    const folded = combineQueued([row('a', 'pip'), row('b', 'gem'), row('c', 'pip')])
    expect(folded.map((entry) => entry.text)).toEqual(['pip: a', 'gem: b', 'pip: c'])
  })

  it('still folds lines typed during one run into one message', () => {
    const folded = combineQueued([row('a', 'pip'), row('b', 'pip')])
    expect(folded).toHaveLength(1)
    expect(folded[0]?.text).toBe(['pip: a', 'pip: b'].join(QUEUE_SEPARATOR))
  })
})

describe('sending one conversation its next message', () => {
  it("takes that conversation's rows, folded, and leaves every other row where it was", () => {
    const rows = [row('a', 'pip'), row('b', 'gem'), row('c', 'pip'), row('d', 'gem')]
    const { going, rest } = takeNext(rows, 'gem')
    expect(going?.text).toBe(['gem: b', 'gem: d'].join(QUEUE_SEPARATOR))
    expect(going?.key).toBe('gem')
    expect(rest.map((entry) => entry.id)).toEqual(['a', 'c'])
  })

  it('takes nothing from a conversation with nothing queued', () => {
    const rows = [row('a', 'pip')]
    expect(takeNext(rows, 'gem')).toEqual({ going: undefined, rest: rows })
  })

  it('goes by the row itself: two rows can be given the same id', () => {
    // Ids are `q_<length>_<key>`, and a queue that shrinks and grows again
    // hands a later row an id an earlier one still holds.
    const first = row('q_1_pip', 'pip')
    const other = row('q_1_pip', 'gem', { text: 'gem: same id' })
    const { going, rest } = takeNext([first, other], 'pip')
    expect(going?.text).toBe('pip: q_1_pip')
    expect(rest).toEqual([other])
  })
})

describe("Edit and Discard in one conversation's box", () => {
  it("empty that conversation's queue and nobody else's", () => {
    const rows = [row('a', 'pip'), row('b', 'gem'), row('c', 'pip')]
    expect(withoutQueueOf(rows, 'gem').map((entry) => entry.id)).toEqual(['a', 'c'])
    expect(withoutQueueOf(rows, undefined)).toEqual(rows)
  })

  it("the reviewer's case: Gem's line edited, Pip's untouched, each sent to its own", () => {
    let rows: readonly QueuedRow[] = [row('p', 'pip', { text: 'PIP_QUEUED' })]
    rows = [...rows, row('g', 'gem', { text: 'GEM_QUEUED' })]
    // Edit in Gem's box: Gem's words come back to the box, and go in again changed.
    rows = [...withoutQueueOf(rows, 'gem'), row('g2', 'gem', { text: 'GEM_EDITED' })]
    expect(queuedIn(rows, 'pip').map((entry) => entry.text)).toEqual(['PIP_QUEUED'])
    const pip = takeNext(rows, 'pip')
    expect(pip.going?.text).toBe('PIP_QUEUED')
    const gem = takeNext(pip.rest, 'gem')
    expect(gem.going?.text).toBe('GEM_EDITED')
    expect(gem.rest).toEqual([])
  })
})

/*
 * The outside recheck of 0.303 (2026-09-23), its two asks: two queues pending
 * AT ONCE, and Edit racing the run's end.
 */
describe('two conversations, each with a message pending at once', () => {
  it("sends each its own as each run ends, in either order, the other's staying pending", () => {
    const rows = [row('p1', 'pip', { text: 'PIP_1' }), row('g1', 'gem', { text: 'GEM_1' }), row('p2', 'pip', { text: 'PIP_2' })]
    const gemFirst = takeNext(rows, 'gem')
    expect(gemFirst.going?.text).toBe('GEM_1')
    expect(queuedIn(gemFirst.rest, 'pip').map((entry) => entry.text)).toEqual(['PIP_1', 'PIP_2'])
    const thenPip = takeNext(gemFirst.rest, 'pip')
    expect(thenPip.going?.text).toBe(['PIP_1', 'PIP_2'].join(QUEUE_SEPARATOR))
    expect(thenPip.rest).toEqual([])

    const pipFirst = takeNext(rows, 'pip')
    expect(pipFirst.going?.text).toBe(['PIP_1', 'PIP_2'].join(QUEUE_SEPARATOR))
    expect(queuedIn(pipFirst.rest, 'gem').map((entry) => entry.text)).toEqual(['GEM_1'])
  })
})

describe('Edit while the run finishes', () => {
  it('sends nothing -- the words are back in the box, not the queue -- and leaves the other conversation queued', () => {
    const rows = [row('g', 'gem', { text: 'GEM_QUEUED' }), row('p', 'pip', { text: 'PIP_QUEUED' })]
    // Edit in Gem's box takes Gem's words out of the queue and into the box
    // (the box then says "Off the queue", Composer's offTheQueue)...
    const editing = withoutQueueOf(rows, 'gem')
    // ...and Gem's run ends before Enter: there is nothing of Gem's to send.
    const gemEnds = takeNext(editing, 'gem')
    expect(gemEnds.going).toBeUndefined()
    expect(gemEnds.rest).toEqual(editing)
    expect(queuedIn(gemEnds.rest, 'pip').map((entry) => entry.text)).toEqual(['PIP_QUEUED'])
  })
})
