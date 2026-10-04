import { describe, expect, it } from 'vitest'

import { roomBlockedReason, roomFullNote } from './components/RoomScreen.js'

/**
 * SAME RULE, THREE BRANCHES, AND ONLY ONE SPOKE.
 *
 * Create room is disabled on an empty name, on nobody ticked, and on more
 * than eight ticked. The third explained itself in amber with the exact
 * number to untick -- and the other two were `opacity: 0.5` and silence.
 *
 * A person who has typed nothing can work out the first. A person who has
 * typed a name and is looking at a row of teammates cannot tell whether the
 * button is broken, and that is the state this was found in (design brief,
 * 2026-09-21, which credits `roomFullNote`'s own comment for getting the
 * hard case right first).
 */
describe('a disabled Create room says why', () => {
  it('says nothing when the room can be made', () => {
    expect(roomBlockedReason('standup', 2)).toBeUndefined()
    expect(roomBlockedReason('  standup  ', 1)).toBeUndefined()
  })

  it('names the missing name', () => {
    expect(roomBlockedReason('', 2)).toBe('Name the room to create it.')
    // Whitespace is not a name, and the button agrees: it tests `.trim()`.
    expect(roomBlockedReason('   ', 2)).toBe('Name the room to create it.')
  })

  it('names the missing teammates', () => {
    expect(roomBlockedReason('standup', 0)).toBe('Pick at least one teammate.')
  })

  it('keeps the cap first, and keeps its own words', () => {
    // The cap is the one a person cannot work out, and it carries the number
    // to untick. It must win even when the name is also missing, because it
    // is the only branch whose fix is not obvious from the screen.
    const full = roomBlockedReason('', 9)
    expect(full).toBe(roomFullNote(9))
    expect(full).toContain('Untick 1')
  })

  it('agrees with the condition that disables the button', () => {
    /*
     * The invariant, not a restatement: a reason exists exactly when the
     * button is disabled. Written from the button's own condition, so a
     * fourth branch added to one and not the other fails here.
     */
    const disabled = (name: string, ticked: number): boolean =>
      name.trim().length === 0 || ticked === 0 || roomFullNote(ticked) !== undefined
    for (const name of ['', '   ', 'standup']) {
      for (const ticked of [0, 1, 8, 9, 20]) {
        expect(roomBlockedReason(name, ticked) !== undefined, `${JSON.stringify(name)} / ${String(ticked)}`)
          .toBe(disabled(name, ticked))
      }
    }
  })
})
