import { describe, expect, it } from 'vitest'

import { AT_BOTTOM_SLACK, atBottom, scrollVerdict, shouldFollow } from './stickToBottom.js'

/**
 * The rule these pin: follow the newest line only while the person is already
 * at the newest line. The failure this is built to prevent is not "it did not
 * scroll" -- it is "it scrolled while I was reading something older", which is
 * what a naive scroll-on-every-change does, once per streamed token.
 */
describe('is the view at the bottom', () => {
  it('says yes when it is exactly at the end', () => {
    expect(atBottom({ scrollTop: 900, scrollHeight: 1400, clientHeight: 500 })).toBe(true)
  })

  it('says yes a hair short of the end', () => {
    // Sub-pixel heights and a fractional device pixel ratio leave this a few
    // pixels short while the person has not moved at all. An exact test here
    // would decide they had scrolled away and stop following mid-answer.
    expect(atBottom({ scrollTop: 900 - AT_BOTTOM_SLACK + 1, scrollHeight: 1400, clientHeight: 500 })).toBe(true)
  })

  it('says no once they have genuinely scrolled up', () => {
    expect(atBottom({ scrollTop: 200, scrollHeight: 1400, clientHeight: 500 })).toBe(false)
  })

  it('says yes when there is nothing to scroll', () => {
    expect(atBottom({ scrollTop: 0, scrollHeight: 300, clientHeight: 300 })).toBe(true)
  })
})

describe('whether to pull the view back down', () => {
  it('follows when they were at the bottom and something arrived', () => {
    expect(shouldFollow(true, true)).toBe(true)
  })

  it('does NOT follow when they had scrolled up', () => {
    // THE test. This is the whole reason the decision is remembered from the
    // scroll event instead of measured after the content grows.
    expect(shouldFollow(false, true)).toBe(false)
  })

  it('does not move the view when nothing grew', () => {
    // A re-render that changes no heights must not touch scrollTop; doing so
    // fights the person during a drag of the scrollbar itself.
    expect(shouldFollow(true, false)).toBe(false)
    expect(shouldFollow(false, false)).toBe(false)
  })
})

describe('a scroll the app did not make', () => {
  // MEASURED 2026-09-23 (Yurt's beta report, #3): three turns logged event by
  // event -- the walk reached the bottom, the content grew 136px, and a scroll
  // event came with the position UNCHANGED and no input anywhere. Read as the
  // person scrolling up, it stopped the follow and raised the jump arrow, and
  // every later turn landed short of its answer.
  it('keeps following when the view did not go up: the content grew under it', () => {
    expect(scrollVerdict({ atBottom: false, movedUp: false, following: true })).toBe('catch-up')
  })

  it('stops when the view went up, however it went -- wheel, drag, keys, focus, a script', () => {
    // The first repair asked whether a PERSON scrolled, and walked the drive's
    // own jump to the top straight back down -- as it would a keyboard user
    // tabbing to an older message.
    expect(scrollVerdict({ atBottom: false, movedUp: true, following: true })).toBe('leave')
    // And once it has left, nothing but coming back resumes it.
    expect(scrollVerdict({ atBottom: false, movedUp: false, following: false })).toBe('stay')
  })

  it('follows again from the bottom, whichever way it got there', () => {
    expect(scrollVerdict({ atBottom: true, movedUp: true, following: false })).toBe('follow')
    expect(scrollVerdict({ atBottom: true, movedUp: false, following: false })).toBe('follow')
  })
})
