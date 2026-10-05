import { describe, expect, it } from 'vitest'

import { helperResult, plainSummary } from './components/ActivityCard.js'

/**
 * A HELPER'S SUMMARY READS AS WORDS (0.625). The helper drive's frame,
 * 2026-10-05: the row said "reported back · **33** files total in the cu...".
 * A one-line summary beside a row is not a place for Markdown marks.
 */
describe("a helper's one-line summary", () => {
  it('drops bold, underline-bold, code and heading marks and keeps the words', () => {
    expect(plainSummary('**33** files total in the current working directory')).toBe('33 files total in the current working directory')
    expect(plainSummary('Found __three__ callers of `total()` in src/cart.py')).toBe('Found three callers of total() in src/cart.py')
    expect(plainSummary('## Summary: the build passes')).toBe('Summary: the build passes')
  })

  it('drops single-star emphasis without touching a star that is not emphasis', () => {
    expect(plainSummary('It is *not* in the folder')).toBe('It is not in the folder')
    expect(plainSummary('Matches src/**/*.ts and 2 * 3 = 6')).toBe('Matches src/**/*.ts and 2 * 3 = 6')
  })

  it('is what the helper row says when it reported back', () => {
    const entry = { kind: 'helper', settled: true, failed: false, summary: '**33** files total in the current working directory' }
    expect(helperResult(entry as Parameters<typeof helperResult>[0], true)).toBe('reported back · 33 files total in the current working directory')
  })

  it('folds a summary onto one line', () => {
    expect(plainSummary('Read 4 files.\nNo test covers it.')).toBe('Read 4 files. No test covers it.')
  })
})
