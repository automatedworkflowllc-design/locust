import { describe, expect, it } from 'vitest'

import { judgePickOf } from './compare.js'

/*
 * The column the judge would keep wears "Judge's pick" (0.554). Read from
 * its own last sentence -- Cursor's, judging three locust games on 0.553,
 * ended "I would keep Answer C, because it is the one that looks and plays
 * like a small arcade game".
 */
const SLOTS = ['a', 'b', 'c'] as const

describe('the judge\'s pick is the answer it says it would keep', () => {
  it('from its closing sentence', () => {
    const said = 'Answer A is a working dodge loop.\n\nAnswer C puts you in a wheat field.\n\nI would keep Answer C, because it plays like a small arcade game.'
    expect(judgePickOf(said, SLOTS)).toBe('c')
  })

  it('in bold, or as a line of its own', () => {
    expect(judgePickOf('**Keep: Answer B**', SLOTS)).toBe('b')
    expect(judgePickOf('I would **keep Answer A**.', SLOTS)).toBe('a')
  })

  it('the last one it names counts', () => {
    expect(judgePickOf('At first I would keep Answer A. On reflection, I would keep Answer B.', SLOTS)).toBe('b')
  })

  it('never one it would not keep', () => {
    expect(judgePickOf('I would not keep Answer A.', SLOTS)).toBeUndefined()
    expect(judgePickOf("I wouldn't keep Answer B as it is.", SLOTS)).toBeUndefined()
  })

  it('never one this comparison does not have', () => {
    expect(judgePickOf('I would keep Answer C.', ['a', 'b'])).toBeUndefined()
    expect(judgePickOf('They are all fine.', SLOTS)).toBeUndefined()
  })
})
