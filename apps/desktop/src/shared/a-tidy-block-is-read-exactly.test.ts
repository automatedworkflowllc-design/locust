import { describe, expect, it } from 'vitest'

import { MAX_MERGED, MAX_TIDY_SUGGESTIONS, TIDY_EXAMPLE_LINES, TIDY_PROMPT, parseTidyBlocks, readableReason } from './memory-tidy.js'
import { stripMemoryBlocks } from './memory.js'
import { defangProtocolBlocks } from './protocolTags.js'

/*
 * A TIDY PASS'S ANSWER, READ EXACTLY (A1.2).
 *
 * The suggestions name memories by id and say what to do; anything that does
 * not read cleanly is dropped rather than guessed at, because each one turns
 * into a question put to the person.
 */

const block = (...lines: readonly string[]): string => ['Found three near-copies.', '<locust-tidy>', ...lines, '</locust-tidy>'].join('\n')

describe('reading the block', () => {
  it('reads a merge, a retirement and a rewrite, ids exactly', () => {
    expect(
      parseTidyBlocks(
        block(
          'merge mem_a1 mem_b2 :: Deploys go out on Thursdays.',
          'retire mem_c3 :: superseded by the Thursday note',
          'rewrite mem_d4 :: The API is on port 3001.'
        )
      )
    ).toEqual([
      { kind: 'merge', ids: ['mem_a1', 'mem_b2'], text: 'Deploys go out on Thursdays.' },
      { kind: 'retire', id: 'mem_c3', reason: 'superseded by the Thursday note' },
      { kind: 'rewrite', id: 'mem_d4', text: 'The API is on port 3001.' }
    ])
  })

  it('drops what does not read cleanly: a one-id merge, a too-big merge, a repeated id, a rewrite of two', () => {
    const tooMany = Array.from({ length: MAX_MERGED + 1 }, (_, index) => `mem_x${String(index)}`).join(' ')
    expect(
      parseTidyBlocks(
        block(
          'merge mem_a1 :: one is not a merge',
          `merge ${tooMany} :: too many`,
          'merge mem_a1 mem_a1 :: the same one twice',
          'rewrite mem_a1 mem_b2 :: which one?',
          'retire :: nothing named',
          'shred mem_a1 :: not a verb this knows'
        )
      )
    ).toEqual([])
  })

  it('takes at most a handful from one reply: a person answers each', () => {
    const lines = Array.from({ length: MAX_TIDY_SUGGESTIONS + 5 }, (_, index) => `retire mem_r${String(index)} :: stale`)
    expect(parseTidyBlocks(block(...lines))).toHaveLength(MAX_TIDY_SUGGESTIONS)
  })

  it('does not act on the example in its own brief, fenced or not', () => {
    expect(parseTidyBlocks(TIDY_PROMPT)).toEqual([])
    // The brief as it was sent before 0.372, its example in a fence.
    const fencedExample = ['```', '<locust-tidy>', ...TIDY_EXAMPLE_LINES, '</locust-tidy>', '```'].join('\n')
    expect(parseTidyBlocks(`Like this:\n${fencedExample}`)).toEqual([])
  })
})

describe('the block, seen by a person and by another teammate', () => {
  it('is taken out of the reply a person reads', () => {
    expect(stripMemoryBlocks(block('retire mem_a1 :: stale'))).toBe('Found three near-copies.')
  })

  it('is defanged when quoted to another teammate', () => {
    expect(defangProtocolBlocks('<locust-tidy>retire mem_a1 :: stale</locust-tidy>')).not.toContain('<locust-tidy>')
  })
})

describe('a reason, as the person reads it', () => {
  const kept = [{ memoryId: 'mem_moved', text: 'The API moved to port 3001.' }]

  it('drops an id cited in brackets: the sentence already says it', () => {
    expect(readableReason('moved to port 3001 on September 20 (mem_moved), making this outdated', kept)).toBe('moved to port 3001 on September 20, making this outdated')
  })

  it('says a bare id as the memory it names, or as another memory', () => {
    expect(readableReason('superseded by mem_moved', kept)).toBe('superseded by "The API moved to port 3001."')
    expect(readableReason('superseded by mem_gone', kept)).toBe('superseded by another memory')
  })
})
