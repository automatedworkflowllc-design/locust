import { describe, expect, it } from 'vitest'

import { QUIET_SECONDS_BEFORE_SAYING_SO } from './components/RoomScreen.js'

/**
 * A member who has been asked and has not spoken says how long that has been.
 *
 * The last of the design agent's three deliverables on following eight, and
 * the one I did not do when I shipped the other two. I fixed the plumbing —
 * cards appear as each run starts rather than 45 seconds later — and left
 * the naming, which was the actual ask.
 *
 * Their three facts:
 *
 *   asked · 2s
 *   asked · 45s · no word back yet        (past 20s, amber)
 *   running · 52s                          (at the first event)
 *
 * It says ASKED, not `starting`. "Starting" is the app's word for its own
 * dispatch loop; the reader's fact is that we asked and nothing came back.
 *
 * And the elapsed count is the whole argument — two seconds of silence is
 * normal, forty-five is alarming, and the only thing separating them is a
 * number we already have. Without it both are the word "starting".
 */

describe('the quiet threshold', () => {
  it('comes from measured numbers, not a round one that felt right', () => {
    /*
     * Astra's frontier finding: the solo write baseline is a 70s process
     * whose first record lands well inside twenty seconds, and the eight-way
     * case put 45s between a process starting and its notification. So twenty
     * is past normal and short of the observed bad case.
     */
    expect(QUIET_SECONDS_BEFORE_SAYING_SO).toBeGreaterThan(2)
    expect(QUIET_SECONDS_BEFORE_SAYING_SO).toBeLessThan(45)
    expect(QUIET_SECONDS_BEFORE_SAYING_SO).toBe(20)
  })
})
