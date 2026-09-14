import { describe, expect, it } from 'vitest'

import { memoryAge, memorySection } from '../shared/memory.js'

/**
 * A briefed memory says when it was written.
 *
 * Every memory in a brief read identically, so a note from three weeks ago
 * looked exactly like one written an hour ago. That matters most in the case
 * memory exists for: two notes that disagree, where the newer one is usually
 * the correction and the older one is the thing somebody forgot to forget.
 * Without a date a teammate has nothing to weigh them with, and picks whichever
 * it happens to read first.
 *
 * This is the gap in `OpenViking`'s own memory design, found while reading it:
 * it keeps timestamps and provenance carefully and then surfaces neither at
 * recall time, so a fact contradicted months ago still presents as current.
 * Copying the mechanism without this piece would have imported the bug.
 */

const NOW = new Date('2026-09-14T12:00:00.000Z')
const ago = (days: number): string => new Date(NOW.getTime() - days * 86_400_000).toISOString()

describe('how old a memory is', () => {
  it('says it the way a person would', () => {
    expect(memoryAge(ago(0), NOW)).toBe('today')
    expect(memoryAge(ago(1), NOW)).toBe('yesterday')
    expect(memoryAge(ago(5), NOW)).toBe('5 days ago')
    expect(memoryAge(ago(21), NOW)).toBe('3 weeks ago')
    expect(memoryAge(ago(90), NOW)).toBe('3 months ago')
    expect(memoryAge(ago(500), NOW)).toBe('over a year ago')
  })

  it('says nothing rather than something wrong', () => {
    expect(memoryAge(undefined, NOW)).toBeUndefined()
    expect(memoryAge('not a date', NOW)).toBeUndefined()
    // A clock that moved backwards must not produce "in -2 days".
    expect(memoryAge(ago(-2), NOW)).toBeUndefined()
  })

  it('puts the age beside who wrote it, in the brief itself', () => {
    const section = memorySection({
      selfName: 'Wren',
      workspaceName: 'shop',
      askFirst: false,
      now: NOW,
      memories: [
        { text: 'The API is on port 3000', scope: 'workspace', by: 'Yurt', where: undefined, at: ago(30) },
        { text: 'The API is on port 8080', scope: 'workspace', by: 'Wren', where: undefined, at: ago(0) }
      ]
    })
    expect(section).toContain('The API is on port 3000 (this folder, by Yurt, 4 weeks ago)')
    expect(section).toContain('The API is on port 8080 (this folder, by Wren, today)')
  })

  it('tells the reader what to do when two of them disagree', () => {
    const section = memorySection({
      selfName: 'Wren',
      workspaceName: 'shop',
      askFirst: false,
      now: NOW,
      memories: [{ text: 'Tests run with pnpm', scope: 'workspace', by: 'Wren', where: undefined, at: ago(2) }]
    })
    expect(section).toContain('the newer one is usually the correction')
  })

  it('still reads correctly for a memory with no date at all', () => {
    const section = memorySection({
      selfName: 'Wren',
      workspaceName: 'shop',
      askFirst: false,
      now: NOW,
      memories: [{ text: 'Tests run with pnpm', scope: 'workspace', by: 'Wren', where: undefined }]
    })
    // No trailing comma, no empty parenthetical -- the line is just shorter.
    expect(section).toContain('Tests run with pnpm (this folder, by Wren)')
  })
})
