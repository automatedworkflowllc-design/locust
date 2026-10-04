import { describe, expect, it } from 'vitest'

import { atQuery, fileMatches, withoutAtQuery } from './fileMentions.js'

/**
 * `@` FOR A FILE OF THE PROJECT (0.436): as Claude Code's composer offers
 * them, and VelaTerm completes paths (read at Colin's "anything to yoink").
 */
const FILES = [
  'README.md',
  'src/cart.py',
  'src/cart_test.py',
  'src/checkout/cart_view.py',
  'docs/carting-notes.md',
  'apps/desktop/src/main/index.ts',
  'apps/desktop/src/renderer/src/App.tsx'
]

describe('what `@` is asking for', () => {
  it('is the @word at the end of the message, a bare @ included', () => {
    expect(atQuery('look at @car')).toBe('car')
    expect(atQuery('@')).toBe('')
    expect(atQuery('fix @src/ca')).toBe('src/ca')
  })

  it('is nothing for an @ inside a sentence, or a word that carries one', () => {
    expect(atQuery('email me @ noon please')).toBeUndefined()
    expect(atQuery('write to sam@example.com')).toBeUndefined()
    expect(atQuery('no at sign')).toBeUndefined()
  })

  it('leaves the rest of the message when a file is picked', () => {
    expect(withoutAtQuery('look at @car')).toBe('look at ')
    expect(withoutAtQuery('@README')).toBe('')
  })
})

describe('the files offered', () => {
  it('puts a name that starts with what was typed before one that only contains it', () => {
    // Starting with it outranks containing it; within that, the shallower path first.
    expect(fileMatches(FILES, 'cart')).toEqual(['src/cart.py', 'src/cart_test.py', 'docs/carting-notes.md', 'src/checkout/cart_view.py'])
    expect(fileMatches(FILES, 'view')).toEqual(['src/checkout/cart_view.py'])
  })

  it('finds by path, and by letters in order', () => {
    expect(fileMatches(FILES, 'checkout/')).toEqual(['src/checkout/cart_view.py'])
    expect(fileMatches(FILES, 'rndrapp')).toEqual(['apps/desktop/src/renderer/src/App.tsx'])
  })

  it('ignores case, and offers the shortest paths first for a bare @, eight at most', () => {
    expect(fileMatches(FILES, 'readme')).toEqual(['README.md'])
    expect(fileMatches(FILES, '')[0]).toBe('README.md')
    expect(fileMatches(Array.from({ length: 30 }, (_, i) => `f${String(i)}.ts`), '')).toHaveLength(8)
  })

  it('offers nothing rather than something wrong', () => {
    expect(fileMatches(FILES, 'zzzz')).toEqual([])
  })
})

// QA-2026-09-29 round 2, R16: the list may hold 50,000 paths now.
describe('@ in a very large folder', () => {
  const many = Array.from({ length: 50_000 }, (_, i) => `docs/part-${String(i % 97)}/record-${String(i)}.md`)
  many.push('packages/runtime-adapters/src/commands.ts')

  it('finds a file past the old 5,000 cap, first', () => {
    expect(fileMatches(many, 'commands.ts')[0]).toBe('packages/runtime-adapters/src/commands.ts')
  })

  it('answers a bare @ over 50,000 paths in well under a keystroke', () => {
    const started = performance.now()
    expect(fileMatches(many, '')).toHaveLength(8)
    expect(performance.now() - started).toBeLessThan(250)
  })
})

// QA-2026-09-29 round 2, N5.
describe('@ and accents', () => {
  it('finds a name with accents from one typed without them, and the other way round', () => {
    const files = ['docs/résumé.md', 'docs/resume-old.md', 'src/café.ts']
    expect(fileMatches(files, 'resume')).toEqual(['docs/résumé.md', 'docs/resume-old.md'])
    expect(fileMatches(files, 'café')).toEqual(['src/café.ts'])
    expect(fileMatches(files, 'cafe')).toEqual(['src/café.ts'])
  })
})
