import { describe, expect, it } from 'vitest'

import { rowNamedByPost } from './room-task.js'

/**
 * The board does not say "unassigned" while somebody is working the row.
 *
 * Grok's beta drive, 2026-09-14, finding 3: a post asked a teammate to start
 * an open board task. The room said both teammates were running, both faces
 * read "working", the teammate's own reply said "Starting the release notes
 * task" -- and the row said unassigned through the run, after it settled, and
 * after a restart.
 *
 * 0.116.0 told teammates to claim a row the moment they start it, and that is
 * not enough on its own: a task block is read from the END of a reply, so
 * nothing can have claimed while the work is happening. The window where the
 * board is wrong is exactly the one that matters, because the rule beside it
 * sends other teammates at unassigned rows.
 *
 * So the host claims at START -- and only where the person's own words leave
 * no argument about which row. `forgetMatch`'s discipline: exactly one target,
 * and none or several are a refusal rather than a guess.
 */

const open = (taskId: string, text: string) => ({ taskId, text, state: 'open' })

describe('which row a post is about', () => {
  it('claims the row the post names', () => {
    expect(
      rowNamedByPost('Wren: please start Write the release notes now.', [
        open('t1', 'Write the release notes'),
        open('t2', 'Sign the installer')
      ])
    ).toBe('t1')
  })

  it('ignores punctuation and case the way a person types', () => {
    expect(
      rowNamedByPost('start "write the release notes", then stop', [open('t1', 'Write the release notes')])
    ).toBe('t1')
  })

  it('claims NOTHING when the post names no row -- the case Grok drove', () => {
    // The exact post: it refers to the board without naming a row. The app
    // does not get to decide which one somebody meant.
    expect(
      rowNamedByPost('Wren start that board task; Booty reply OK', [
        open('t1', 'Write the release notes')
      ])
    ).toBeUndefined()
  })

  it('claims nothing when two rows would answer to it', () => {
    expect(
      rowNamedByPost('do Write the release notes and Write the release notes v2', [
        open('t1', 'Write the release notes'),
        open('t2', 'Write the release notes v2')
      ])
    ).toBeUndefined()
  })

  it('never takes a row that is already somebody else’s, or already done', () => {
    const taken = [
      { taskId: 't1', text: 'Write the release notes', state: 'open', ownerId: 'tm_booty' },
      { taskId: 't2', text: 'Write the release notes', state: 'done' }
    ]
    expect(rowNamedByPost('please start Write the release notes', taken)).toBeUndefined()
  })

  it('does not let a short row match an ordinary sentence', () => {
    // "notes" appearing in prose is not a reference to a row called "notes".
    expect(rowNamedByPost('add some notes about this', [open('t1', 'notes')])).toBeUndefined()
  })
})
