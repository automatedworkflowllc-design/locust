import { describe, expect, it } from 'vitest'

import { memberNamedByPost, rowToClaimAtStart } from './room-task.js'

/**
 * A claim at start goes to the teammate the person named.
 *
 * Grok's second beta drive, 2026-09-14, finding 1. 0.116.0 claimed a named
 * row when a QUEUED member was drained after some other run ended -- and the
 * post that actually starts the named teammate does not go through the
 * drain. So the one member the person pointed at was the one member the new
 * code never saw, and the row sat unassigned through the entire live run.
 *
 * The obvious repair -- claim for whoever starts first -- is worse than the
 * bug. The measured post was "Wren, start Write the release notes. Booty,
 * reply OK and do not touch the board", and every member of a room starts on
 * ONE post. First-past-the-post would have handed Booty the row her own
 * instruction forbade her to touch.
 */

const ROWS = [
  { taskId: 't1', text: 'Write the release notes', state: 'open' as const },
  { taskId: 't2', text: 'Draft the changelog', state: 'open' as const }
]
const MEMBERS = [
  { teammateId: 'wren', name: 'Wren' },
  { teammateId: 'booty', name: 'Booty' }
]
const NAMED = 'Wren, start Write the release notes. Booty, reply OK and do not touch the board.'

describe('who a named row is claimed for', () => {
  it('gives it to the teammate the post names', () => {
    expect(
      rowToClaimAtStart({ postText: NAMED, tasks: ROWS, members: MEMBERS, startedTeammateId: 'wren' })
    ).toBe('t1')
  })

  it('gives it to NOBODY else, however early they start', () => {
    // The whole reason this is not "claim for whoever started".
    expect(
      rowToClaimAtStart({ postText: NAMED, tasks: ROWS, members: MEMBERS, startedTeammateId: 'booty' })
    ).toBeUndefined()
  })

  it('still claims nothing when the post names no row', () => {
    // Grok's control, and it held: two rows open, "that board task" names
    // neither, and the app does not get to decide which one somebody meant.
    expect(
      rowToClaimAtStart({
        postText: 'Wren, start the unassigned board task.',
        tasks: ROWS,
        members: MEMBERS,
        startedTeammateId: 'wren'
      })
    ).toBeUndefined()
  })

  it('claims nothing when a row is named but no teammate is', () => {
    expect(
      rowToClaimAtStart({
        postText: 'Somebody please Write the release notes today.',
        tasks: ROWS,
        members: MEMBERS,
        startedTeammateId: 'wren'
      })
    ).toBeUndefined()
  })

  it('needs no name in a room of one, because there is nobody else it could mean', () => {
    expect(
      rowToClaimAtStart({
        postText: 'Please Write the release notes.',
        tasks: ROWS,
        members: [{ teammateId: 'wren', name: 'Wren' }],
        startedTeammateId: 'wren'
      })
    ).toBe('t1')
  })
})

describe('naming a member', () => {
  it('reads whole words only', () => {
    // "Wren" inside "wrench" is not a reference to Wren.
    expect(memberNamedByPost('tighten the wrench first', MEMBERS)).toBeUndefined()
    expect(memberNamedByPost('wren, go', MEMBERS)).toBe('wren')
  })

  it('refuses when the post names two of them', () => {
    expect(memberNamedByPost('Wren and Booty, both of you', MEMBERS)).toBeUndefined()
  })

  it('handles a name of several words', () => {
    expect(
      memberNamedByPost('ask Van Gogh to start', [
        { teammateId: 'vg', name: 'Van Gogh' },
        { teammateId: 'booty', name: 'Booty' }
      ])
    ).toBe('vg')
  })
})
