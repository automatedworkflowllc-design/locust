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
    expect(atQuery('write to colin@example.com')).toBeUndefined()
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
