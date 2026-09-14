import { describe, expect, it } from 'vitest'

import { taskSection } from './room-task.js'

/**
 * A teammate that starts a row claims it.
 *
 * Colin, 2026-09-14, watching a teammate he had just asked to review a
 * codebase: the work started and the row stayed `unassigned`. "shouldnt a
 * teammate automatically claim a task if asked to though?" Yes -- and nothing
 * had ever told it so.
 *
 * Every instruction here was a LIMIT: claim only what you are actually doing,
 * leave another teammate's row alone. A model reading only limits errs toward
 * doing nothing, because that is the failure that looks safe. The teammate in
 * question even invented a policy to explain itself -- "in this room a task
 * stays idle until someone claims it" -- which is not in the briefing and
 * never was.
 *
 * The cost is not tidiness. The rule directly above this one sends teammates
 * at unassigned rows, so a board that under-reports invites two of them onto
 * the same task -- the collision the board exists to prevent (Colin,
 * 2026-09-10: "i can imagine if both teammates receive the task only assigned
 * to one things can get messy").
 */

const section = (): string =>
  taskSection({
    selfName: 'Yurt',
    roomName: 'test',
    memberNames: ['Yurt', 'Jimothy'],
    tasks: [
      { text: 'Review Locust codebase', state: 'open', ownerName: undefined },
      { text: 'Write the release notes', state: 'in-hand', ownerName: 'Jimothy' }
    ]
  })

describe('what a teammate is told about the board', () => {
  it('tells it to claim a row it begins, not merely to claim honestly', () => {
    const text = section()
    expect(text).toContain('claim it in the same reply')
    // Both ways in: told to do it, and picking it up itself.
    expect(text).toContain('because the person asked you to')
  })

  it('says WHY, because the reason is the part that generalises', () => {
    // A rule with no reason is followed literally or not at all. This one has
    // to survive cases nobody wrote down.
    const text = section()
    expect(text).toContain('look the same to everyone else')
  })

  it('keeps the limit that stops it claiming what it is not doing', () => {
    const text = section()
    expect(text).toContain('Claim only what you are actually doing')
    expect(text).toContain("A row marked with another teammate's name is already theirs")
  })

  it('still says to end with no block when it touched nothing', () => {
    // The obligation must not turn into "always emit a task block", which
    // would put a claim on every reply in the room.
    expect(section()).toContain('if you touched no task, end with no block')
  })
})
