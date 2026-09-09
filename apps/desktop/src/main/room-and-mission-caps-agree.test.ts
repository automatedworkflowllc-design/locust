import { describe, expect, it } from 'vitest'

import { MAX_LIVE_MISSIONS } from '../shared/live-missions.js'
import { MAX_ROOM_TEAMMATES } from './room-store.js'

/**
 * A room can never hold more teammates than can actually run.
 *
 * Two numbers were chosen separately and never compared. `MAX_ROOM_TEAMMATES`
 * was 8 and `MAX_LIVE_MISSIONS` was 4, so the app let a person build a room
 * it could not answer: a post to six started four, drew the other two as
 * empty cards reading "did not start", and then said "Everyone in Standup
 * has answered." Found by driving a six-member room on 2026-09-09.
 *
 * Everything else that day was a symptom. The screen was made to say what
 * would happen, and the room was made to stop calling four of six everyone
 * -- both worth having, both still there. But the defect only really closed
 * when the mission cap was measured and raised to 8, because a room that
 * cannot outgrow what can run has nothing to be wrong about.
 *
 * This is what keeps it closed. The two constants live in different files
 * for good reasons -- one is a storage bound, one is a resource bound -- and
 * nothing but this connects them. Raise the room limit without raising the
 * mission cap and the whole thing comes back, silently, exactly as before.
 */

describe('the room limit and the live-mission cap', () => {
  it('are both real numbers, not a shape this test can read past', () => {
    // The control. An import that resolved to undefined would satisfy any
    // comparison below by comparing nothing.
    expect(Number.isInteger(MAX_ROOM_TEAMMATES)).toBe(true)
    expect(Number.isInteger(MAX_LIVE_MISSIONS)).toBe(true)
    expect(MAX_ROOM_TEAMMATES).toBeGreaterThan(1)
  })

  it('agree, so a full room can always answer a post', () => {
    expect(
      MAX_ROOM_TEAMMATES,
      'a room bigger than the mission cap has members who never run: raise MAX_LIVE_MISSIONS with it, and measure before you do'
    ).toBeLessThanOrEqual(MAX_LIVE_MISSIONS)
  })
})
