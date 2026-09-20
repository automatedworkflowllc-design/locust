import { describe, expect, it } from 'vitest'

import { unwrapProtocolTags } from './protocolTags.js'
import { parseShareBlocks, stripShareBlocks } from './peer-share.js'

/**
 * The rule: **a person never sees the plumbing, and never loses the words.**
 *
 * Five parsers read blocks out of a reply, and each has a stripper built from
 * the same strict pattern. That symmetry is the defect: a block the parser
 * will not act on is a block the stripper will not hide, so a malformed one
 * fails in both directions at once — nothing is sent AND the tag is on screen.
 *
 * Colin photographed exactly that on 2026-09-20: a bubble reading
 * `<locust-share>Booty :: Reply with exactly the word PEBBLE-6725...`.
 */
describe('a half-written tag is never shown to a person', () => {
  const SEEN = '<locust-share>\nBooty :: Reply with exactly the word PEBBLE-6725 and nothing else.\n</locust-share>'

  it('is the pair of failures it looks like', () => {
    // Both halves, stated rather than assumed: this is why it reached a screen.
    expect(parseShareBlocks(SEEN)).toEqual([])
    expect(stripShareBlocks(SEEN)).toContain('locust-share')
  })

  it('shows the words and not the tags', () => {
    const shown = unwrapProtocolTags(stripShareBlocks(SEEN))
    expect(shown).toBe('Booty :: Reply with exactly the word PEBBLE-6725 and nothing else.')
  })

  it('keeps the body, because nothing else has a copy of it', () => {
    // The strippers delete because their block was acted on and is already a
    // card somewhere. Nothing acted on this one.
    expect(unwrapProtocolTags('<locust-share>the only copy</locust-share>')).toBe('the only copy')
  })

  it('covers the other four, which fail from the opposite side', () => {
    // Those four accept NO attributes, so one stray attribute leaks just as
    // loudly as a missing one does on a share.
    for (const tag of ['locust-memory', 'locust-ask', 'locust-task', 'locust-file']) {
      const shown = unwrapProtocolTags(`<${tag} scope="team">what it said</${tag}>`)
      expect(shown, tag).toBe('what it said')
    }
  })

  it('handles a turn that was cut off mid-block', () => {
    // No closing tag at all. A block-shaped pattern gets this wrong; not
    // caring about pairs gets it right.
    expect(unwrapProtocolTags('here it is\n<locust-share to="Wren">')).toBe('here it is')
  })

  it('leaves a teammate explaining the protocol alone', () => {
    /*
     * This is not hypothetical. Teammates read this repository from inside
     * Locust — two of the comments in `peer-share.ts` are defects they
     * reported — and when one explains the share block, the tag in the fence
     * IS the answer rather than plumbing.
     */
    const answer = 'You write:\n\n```\n<locust-share to="Wren">the note</locust-share>\n```\n\nand the host posts it.'
    expect(unwrapProtocolTags(answer)).toBe(answer)
    expect(unwrapProtocolTags('call it `<locust-task>` in prose')).toBe('call it `<locust-task>` in prose')
  })

  it('does not touch ordinary prose, or a tag that is not ours', () => {
    expect(unwrapProtocolTags('a < b and c > d')).toBe('a < b and c > d')
    expect(unwrapProtocolTags('<locust-unknown>x</locust-unknown>')).toBe('<locust-unknown>x</locust-unknown>')
  })
})
