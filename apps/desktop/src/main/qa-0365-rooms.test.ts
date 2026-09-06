import { describe, expect, it } from 'vitest'

import { parseTaskBlocks, taskSection } from '../shared/room-task.js'

/**
 * The worked example a room mission is briefed with is itself a valid reply.
 *
 * Found by the independent QA pass on 0.36.5 (2026-09-06), at a function
 * boundary.
 *
 * Every room mission is told how to update the board by being SHOWN a block,
 * and the lines in that block are literal placeholders:
 *
 *   <locust-task>
 *   claim :: the task text
 *   done :: the task text
 *   handoff Booty :: the task text
 *   new :: a task that should exist and does not
 *   </locust-task>
 *
 * Parsed as a reply, that is four operations. And `claim` on a task the board
 * does not have CREATES it (`room-store.ts`), so a model that echoes the
 * example -- a small-model habit, not a certainty -- puts "the task text" on
 * the board as claimed, then finished, then handed to Booty, plus "a task
 * that should exist and does not". On a board a person reads.
 *
 * The QA did not see a live echo in three tries on the free model, and said
 * so. The parser does not need a model to be wrong about this.
 */

const exampleBriefing = (): string =>
  taskSection({
    roomName: 'Shipping',
    selfName: 'Wren',
    memberNames: ['Wren', 'Booty'],
    tasks: [{ text: 'Write the changelog', state: 'open', ownerName: undefined }]
  })

describe('the example block is an example, not an instruction', () => {
  it('the placeholders are not read as operations', () => {
    // The exact text the host wrote, handed straight back. Whatever else a
    // reply containing this means, it does not mean four board changes.
    const echoed = parseTaskBlocks(exampleBriefing())
    expect(echoed).toHaveLength(0)
  })

  it('does not put the placeholders on the board', () => {
    // The same thing said about the strings themselves, so a future edit to
    // the briefing's wording cannot quietly re-open this.
    const block = [
      '<locust-task>',
      'claim :: the task text',
      'done :: the task text',
      'handoff Booty :: the task text',
      'new :: a task that should exist and does not',
      '</locust-task>'
    ].join('\n')
    expect(parseTaskBlocks(`Here is what I did.\n${block}`)).toHaveLength(0)
  })

  // ---- controls ----

  it('still reads a real claim', () => {
    // Without this, "the example yields nothing" is equally satisfied by a
    // parser that yields nothing at all.
    const block = ['<locust-task>', 'claim :: Write the changelog', '</locust-task>'].join('\n')
    expect(parseTaskBlocks(`On it.\n${block}`)).toEqual([
      { kind: 'claim', text: 'Write the changelog' }
    ])
  })

  it('still reads a real handoff and a real new task', () => {
    const block = [
      '<locust-task>',
      'handoff Booty :: Write the changelog',
      'new :: Check the release notes',
      '</locust-task>'
    ].join('\n')
    const seen = parseTaskBlocks(`Done.\n${block}`)
    expect(seen.map((op) => op.kind)).toEqual(['handoff', 'new'])
  })
})
