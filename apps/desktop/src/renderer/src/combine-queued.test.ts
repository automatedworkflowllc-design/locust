import { describe, expect, it } from 'vitest'

import { canMergeFollower, canMergeFront, combineQueued, QUEUE_SEPARATOR } from './steering.js'
import type { QueuedRow } from './steering.js'

/*
 * Three thoughts typed during one run are one instruction, not three turns.
 *
 * From `xai-org/grok-build`'s `combine_queued_prompts` (read 2026-09-13, not
 * copied): consecutive plain follow-ups merge when the run ends, with careful
 * gates about what may NOT merge. Colin, the same day: "we want the teammate
 * interaction of grok bot."
 *
 * The difference a person feels is that a teammate answers all three at once
 * knowing they exist, instead of answering the first without knowing the other
 * two were coming.
 */
const row = (over: Partial<QueuedRow> & { readonly id: string }): QueuedRow => ({
  key: 'run_1',
  text: `text ${over.id}`,
  origin: 'person',
  ...over
})

describe('folding queued follow-ups into one turn', () => {
  it('merges a run of plain follow-ups, in order, separated', () => {
    const folded = combineQueued([row({ id: 'a' }), row({ id: 'b' }), row({ id: 'c' })])
    expect(folded).toHaveLength(1)
    expect(folded[0]?.text).toBe(['text a', 'text b', 'text c'].join(QUEUE_SEPARATOR))
    // The merged row keeps the FIRST row's identity, so anything already
    // pointing at it -- a re-key, a strip showing what is queued -- still is.
    expect(folded[0]?.id).toBe('a')
  })

  it('leaves a single row exactly as it was', () => {
    const one = [row({ id: 'a' })]
    expect(combineQueued(one)).toEqual(one)
    expect(combineQueued([])).toEqual([])
  })

  it('never merges anything the HOST queued', () => {
    // A routine's next step, a decision reply, a relay hand-off. Merging one
    // would put two different intents in one instruction and attribute both
    // to whoever typed last.
    const rows = [row({ id: 'a' }), row({ id: 'step', origin: 'host' }), row({ id: 'c' })]
    const folded = combineQueued(rows)
    expect(folded).toEqual(rows)
  })

  it('stops at a host row and keeps everything after it in place', () => {
    const rows = [row({ id: 'a' }), row({ id: 'b' }), row({ id: 'step', origin: 'host' })]
    const folded = combineQueued(rows)
    expect(folded).toHaveLength(2)
    expect(folded[0]?.text).toBe(['text a', 'text b'].join(QUEUE_SEPARATOR))
    expect(folded[1]?.id).toBe('step')
  })

  it('a host row at the front blocks the merge without eating the rest', () => {
    const rows = [row({ id: 'step', origin: 'host' }), row({ id: 'b' }), row({ id: 'c' })]
    expect(combineQueued(rows)).toEqual(rows)
  })

  it('lets the front carry attachments and refuses them on a follower', () => {
    // There is no way to say which half of a merged instruction an image
    // belongs to, so only the first row may have one.
    expect(canMergeFront(row({ id: 'a', attachments: ['a.png'] }))).toBe(true)
    expect(canMergeFollower(row({ id: 'b', attachments: ['b.png'] }))).toBe(false)

    const folded = combineQueued([
      row({ id: 'a', attachments: ['a.png'] }),
      row({ id: 'b', attachments: ['b.png'] }),
      row({ id: 'c' })
    ])
    // The front keeps its attachment; the one that brought its own stays a
    // turn of its own rather than losing it silently.
    expect(folded).toHaveLength(3)
    expect(folded[0]?.attachments).toEqual(['a.png'])
  })

  it('an empty or blank row merges nothing', () => {
    expect(canMergeFront(row({ id: 'a', text: '   ' }))).toBe(false)
    const rows = [row({ id: 'a', text: '' }), row({ id: 'b' })]
    expect(combineQueued(rows)).toEqual(rows)
  })

  it('trims each part but keeps the words', () => {
    const folded = combineQueued([row({ id: 'a', text: '  first  ' }), row({ id: 'b', text: '\nsecond\n' })])
    expect(folded[0]?.text).toBe(`first${QUEUE_SEPARATOR}second`)
  })
})
