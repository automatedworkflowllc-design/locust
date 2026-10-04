import { describe, expect, it } from 'vitest'

import { decideRelay } from './relay.js'
import { parseShareBlocks } from '../shared/peer-share.js'

/**
 * Telling a teammate something need not start a paid mission.
 *
 * A share block starts a RUN on the recipient — a whole mission, on their
 * route, costing whatever that costs. That is right for "the person asked you
 * to hand this to Wren" and wrong for "here are the version notes you
 * wanted", and there was no way to say which.
 *
 * Reported from inside a room, 2026-09-15, by a Cursor teammate dogfooding
 * Locust as a member of it: *"Telling a teammate anything starts a paid
 * mission. I shared GitHub/version notes with Jimothy. Locust auto-replied
 * him into my thread ('reply 2 of 6') with 'confirmed, no help needed.' Each
 * of those is another run. FYI shares should not page a model."*
 *
 * `when="later"` is the sender saying they are telling, not asking.
 *
 * DEFERRING IS NOT A NEW DELIVERY PATH, which is what makes it safe: it is
 * the one a spent hop budget or a switched-off relay already takes — the
 * message waits and is read on the recipient's next run. It can decline to
 * interrupt; it cannot lose anything.
 */

describe('saying which kind of message it is', () => {
  it('reads when="later" as telling', () => {
    const [block] = parseShareBlocks('<locust-share to="Wren" when="later">notes</locust-share>')
    expect(block?.defer).toBe(true)
    expect(block?.urgent).toBe(false)
  })

  it('leaves an ordinary block paging, as it always did', () => {
    const [block] = parseShareBlocks('<locust-share to="Wren">please take this over</locust-share>')
    expect(block?.defer).toBeUndefined()
  })

  it('still reads when="now" as asking to be taken sooner', () => {
    const [block] = parseShareBlocks('<locust-share to="Wren" when="now">stop</locust-share>')
    expect(block?.urgent).toBe(true)
    expect(block?.defer).toBeUndefined()
  })

  it('means exactly the word, in both directions', () => {
    // A model reaching for emphasis with `when="soon"` gets the ordinary
    // treatment rather than an interruption it did not know it was asking
    // for; one reaching for `when="whenever"` still pages.
    for (const when of ['soon', 'urgent', 'whenever', 'eventually']) {
      const [block] = parseShareBlocks(`<locust-share to="Wren" when="${when}">x</locust-share>`)
      expect(block?.urgent).toBe(false)
      expect(block?.defer).toBeUndefined()
    }
  })
})

describe('what the relay does with it', () => {
  const base = { enabled: true, hop: 0, recipientName: 'Wren', cap: 6, spent: 0 }

  it('does not start a run for a deferred message', () => {
    const decision = decideRelay({ ...base, defer: true })
    expect(decision.start).toBe(false)
  })

  it('says it was sent rather than that something was stopped', () => {
    // The other two reasons a relay declines are a spent budget and a switch
    // being off, and both read as an interruption. This one is the sender
    // getting what they asked for.
    const decision = decideRelay({ ...base, defer: true })
    expect(decision.start === false ? decision.reason : '').toContain('next run')
    expect(decision.start === false ? decision.reason : '').not.toContain('Stopped')
  })

  it('spends no budget deciding not to page', () => {
    /*
     * Checked before the cap. A message that was never going to start a run
     * must not consume an exchange's allowance, or a thread full of FYIs
     * would silence the reply that mattered.
     */
    const atCap = decideRelay({ ...base, spent: 6, defer: true })
    expect(atCap.start).toBe(false)
    expect(atCap.start === false ? atCap.reason : '').toContain('next run')
  })

  it('leaves an ordinary message paging as before', () => {
    expect(decideRelay(base).start).toBe(true)
  })
})
