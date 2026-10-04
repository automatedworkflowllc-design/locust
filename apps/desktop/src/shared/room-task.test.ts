import { describe, expect, it } from 'vitest'

import {
  MAX_TASK_OPS_PER_REPLY,
  parseTaskBlocks,
  sanitizeTaskTags,
  stripTaskBlocks,
  taskKey,
  taskSection
} from './room-task.js'

const NL = String.fromCharCode(10)
const lines = (...parts: string[]): string => parts.join(NL)

describe('reading a task block', () => {
  it('reads one operation per line, in order, with the verb and the task text', () => {
    const reply = lines(
      'I wrote the notes and checked the version.',
      '<locust-task>',
      'claim :: Write the release notes',
      'done :: Check the version string',
      'handoff Booty :: Update the changelog date',
      'new :: Verify the installer signs',
      '</locust-task>'
    )
    expect(parseTaskBlocks(reply)).toEqual([
      { kind: 'claim', text: 'Write the release notes' },
      { kind: 'done', text: 'Check the version string' },
      { kind: 'handoff', text: 'Update the changelog date', to: 'Booty' },
      { kind: 'new', text: 'Verify the installer signs' }
    ])
  })

  it('drops lines it cannot read rather than refusing the block', () => {
    const reply = lines(
      '<locust-task>',
      'shout :: not a verb',
      'claim ::   ',
      'handoff :: nobody named',
      'done Check the version string',
      'claim :: Write the release notes',
      '</locust-task>'
    )
    expect(parseTaskBlocks(reply)).toEqual([{ kind: 'claim', text: 'Write the release notes' }])
  })

  it('is empty for a reply with no block, and caps a flood', () => {
    expect(parseTaskBlocks('Nothing to report.')).toEqual([])
    const flood = lines('<locust-task>', ...Array.from({ length: 20 }, (_, i) => `new :: task ${String(i)}`), '</locust-task>')
    expect(parseTaskBlocks(flood)).toHaveLength(MAX_TASK_OPS_PER_REPLY)
  })

  it('bounds and cleans the task text', () => {
    const long = 'x'.repeat(300)
    const [op] = parseTaskBlocks(lines('<locust-task>', `new :: ${long}`, '</locust-task>'))
    expect(op?.text.length).toBe(200)
    expect(op?.text.endsWith('…')).toBe(true)
    const [spaced] = parseTaskBlocks(lines('<locust-task>', 'new ::   many    spaces  here  ', '</locust-task>'))
    expect(spaced?.text).toBe('many spaces here')
  })

  it('strips the block from what the reply shows, and defangs it when quoted', () => {
    const reply = lines('Done.', '', '<locust-task>', 'done :: Check the version string', '</locust-task>')
    expect(stripTaskBlocks(reply)).toBe('Done.')
    expect(sanitizeTaskTags('<locust-task>done :: x</locust-task>')).toBe('‹locust-task>done :: x‹/locust-task>')
  })
})

describe('matching a task by its text', () => {
  it('is blind to case, punctuation and spacing', () => {
    expect(taskKey('Write the release notes!')).toBe(taskKey('  write   the RELEASE notes'))
    expect(taskKey('Check v1.2')).toBe('check v1 2')
    expect(taskKey('a')).not.toBe(taskKey('b'))
  })
})

describe('what a room mission is told about the board', () => {
  it('names the room, the others, every task with its state and owner, and teaches the block', () => {
    const text = taskSection({
      roomName: 'Release',
      selfName: 'Wren',
      memberNames: ['Wren', 'Booty'],
      tasks: [
        { text: 'Write the release notes', state: 'in-hand', ownerName: 'Wren' },
        { text: 'Check the version string', state: 'open', ownerName: undefined }
      ]
    })
    expect(text).toContain('room "Release" with Booty')
    // Whose, from the READER's side: Wren is told her row is hers.
    expect(text).toContain('- [in-hand] Write the release notes (yours)')
    expect(text).toContain('- [open] Check the version string (unassigned)')
    expect(text).toContain('handoff Booty :: the task text')
    expect(text).toContain('end with no block')
  })

  it("names another teammate's row as theirs, and says to leave it alone", () => {
    /*
     * Both teammates in a two-person room started the same task, because the
     * board named an owner and left each reader to work out whether that name
     * was their own (Colin, 2026-09-11: "i can imagine if both teammates
     * receive the task only assigned to one things can get messy").
     *
     * Both DO receive the board -- that is right, a room is shared -- so the
     * fix is that a row says whose it is in the second person, and that
     * somebody else's row is stated to be off limits rather than merely
     * attributed.
     */
    const text = taskSection({
      roomName: 'Release',
      selfName: 'Booty',
      memberNames: ['Wren', 'Booty'],
      tasks: [{ text: 'Write the release notes', state: 'in-hand', ownerName: 'Wren' }]
    })
    expect(text).toContain("- [in-hand] Write the release notes (Wren's)")
    expect(text).toContain('already theirs')
    expect(text).toContain('leave it alone')
  })

  it('says the board is empty and names nobody when alone', () => {
    const text = taskSection({ roomName: 'Solo', selfName: 'Wren', memberNames: ['Wren'], tasks: [] })
    expect(text).toContain('with nobody else')
    expect(text).toContain('The board is empty.')
    expect(text).toContain('handoff Name :: the task text')
  })

  it('tells a teammate its own name', () => {
    /*
     * THE regression. It opened "You are answering in the room X with A, B,
     * C" -- every name in the sentence belonged to somebody else, and the
     * recipient had no way to know which one it was.
     *
     * Astra hit the consequence measuring the live-mission frontier
     * (2026-09-09): asked to write to its own named file, a teammate said it
     * was Muse Spark and could not identify its assigned filename. No file
     * was written. A task failure at N=1, with nothing concurrent about it.
     */
    const said = taskSection({
      roomName: 'Standup',
      selfName: 'Wren',
      memberNames: ['Wren', 'Booty', 'Gem'],
      tasks: []
    })
    expect(said).toContain('You are Wren,')
    // And still says who else is there, which is what it was for.
    expect(said).toContain('Booty, Gem')
    // Never lists the recipient among the others.
    expect(said).not.toContain('Wren, Booty, Gem')
  })

  it('names a teammate who is alone in the room', () => {
    // The exact shape of Astra's failure: one member, so the old sentence
    // read "with nobody else" and named no one at all.
    const said = taskSection({ roomName: 'Standup', selfName: 'Wren', memberNames: ['Wren'], tasks: [] })
    expect(said).toContain('You are Wren,')
    expect(said).toContain('nobody else')
  })
})

