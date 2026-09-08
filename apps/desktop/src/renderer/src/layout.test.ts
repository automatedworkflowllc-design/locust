import { describe, expect, it } from 'vitest'

import { COMPACT_MAX_WIDTH, isLayoutPreference, resolveLayout } from './layout.js'

describe('which layout the shell draws', () => {
  it('follows the width when nobody has chosen', () => {
    expect(resolveLayout('auto', 1120)).toBe('compact')
    expect(resolveLayout('auto', COMPACT_MAX_WIDTH)).toBe('compact')
    expect(resolveLayout('auto', COMPACT_MAX_WIDTH + 1)).toBe('wide')
    expect(resolveLayout('auto', 1920)).toBe('wide')
  })

  it('covers the smallest window the app will open', () => {
    // The bound used to be 1119 while the minimum window is 1120, so the
    // compact rules could never apply to any real window.
    expect(resolveLayout('auto', 1120)).toBe('compact')
  })

  it('lets a choice win at every width, in both directions', () => {
    // THE test. A person who picks the full sidebar on a narrow window has
    // decided they would rather scroll than lose the list; overriding them at
    // some threshold would be the app arguing with a choice it offered.
    expect(resolveLayout('wide', 1120)).toBe('wide')
    expect(resolveLayout('wide', 800)).toBe('wide')
    expect(resolveLayout('compact', 1920)).toBe('compact')
    expect(resolveLayout('compact', 3840)).toBe('compact')
  })

  it('recognises only the three preferences it can honour', () => {
    for (const good of ['auto', 'compact', 'wide']) expect(isLayoutPreference(good)).toBe(true)
    for (const bad of ['rail', '', undefined, null, 1, {}]) expect(isLayoutPreference(bad)).toBe(false)
  })
})
