import { describe, expect, it } from 'vitest'

import { parseShareBlocks, stripShareBlocks } from './peer-share.js'

/**
 * The two ways a model reasonably gets a share wrong, and what used to happen.
 *
 * Both were reported by a Cursor teammate reading this source from inside
 * Locust (2026-09-08) -- which is exactly the position a model is in when it
 * writes one of these blocks.
 */
const body = 'Watch the to= attribute.'

describe('reading a share block', () => {
  it('reads the ordinary, correctly written one', () => {
    expect(parseShareBlocks(`<locust-share to="Gem">${body}</locust-share>`)).toEqual([
      { to: 'Gem', text: body, urgent: false }
    ])
  })

  it('accepts single quotes', () => {
    // The example is written with double quotes, so the pattern accepted only
    // those: `to='Gem'` matched nothing at all -- no block, no error, no share.
    expect(parseShareBlocks(`<locust-share to='Gem'>${body}</locust-share>`)).toEqual([
      { to: 'Gem', text: body, urgent: false }
    ])
  })

  it('accepts the roster line as it is printed, role and all', () => {
    // The briefing prints `Gem (Custom)` and the matcher compares the bare
    // name, so copying what was shown produced "who is not on the roster.
    // Nothing was sent."
    expect(parseShareBlocks(`<locust-share to="Gem (Custom)">${body}</locust-share>`)).toEqual([
      { to: 'Gem', text: body, urgent: false }
    ])
    expect(parseShareBlocks(`<locust-share to='Wren (Code & Migrations)'>${body}</locust-share>`)).toEqual([
      { to: 'Wren', text: body, urgent: false }
    ])
  })

  it('keeps a name that merely contains brackets in the middle', () => {
    // The control. Only a trailing role is stripped; a name is not rewritten.
    expect(parseShareBlocks(`<locust-share to="Gem (2) Prime">${body}</locust-share>`)[0]?.to).toBe('Gem (2) Prime')
  })

  it('still drops a block with no recipient or no body', () => {
    expect(parseShareBlocks('<locust-share to="">hello</locust-share>')).toEqual([])
    expect(parseShareBlocks('<locust-share to="Gem"></locust-share>')).toEqual([])
  })

  /*
   * `when="now"` -- the sender asking to be taken before the recipient
   * finishes. The common urgent message is "stop, I am editing that file",
   * and delivering it after the conflicting work is done delivers it too
   * late. It is a REQUEST: what the host does with it is the person's switch.
   */
  describe('a share that asks to be taken now', () => {
    it('is read, in either attribute order', () => {
      expect(parseShareBlocks(`<locust-share to="Gem" when="now">${body}</locust-share>`)[0]).toMatchObject({ urgent: true })
      expect(parseShareBlocks(`<locust-share when='now' to='Gem'>${body}</locust-share>`)[0]).toMatchObject({
        to: 'Gem',
        urgent: true
      })
    })

    it('is only that one word, so reaching for emphasis is not an interruption', () => {
      for (const when of ['soon', 'urgent', 'asap', 'immediately', '']) {
        expect(parseShareBlocks(`<locust-share to="Gem" when="${when}">${body}</locust-share>`)[0], when)
          .toMatchObject({ urgent: false })
      }
    })

    it('needs a recipient like any other block', () => {
      expect(parseShareBlocks(`<locust-share when="now">${body}</locust-share>`)).toEqual([])
    })
  })

  it('strips every form it can read, so nothing is shown twice', () => {
    // Whatever the parser accepts, the thread must remove -- otherwise the
    // same claim appears in the peer card and again, unlabelled, in the bubble.
    for (const tag of ['to="Gem"', "to='Gem'", 'to="Gem (Custom)"', 'to="Gem" when="now"']) {
      const said = `Here is the answer.
<locust-share ${tag}>${body}</locust-share>`
      expect(stripShareBlocks(said), tag).toBe('Here is the answer.')
    }
  })
})
