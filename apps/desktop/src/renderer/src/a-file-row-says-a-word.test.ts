import { describe, expect, it } from 'vitest'

import { fileToolWord } from './components/ActivityCard.js'

// First-impressions drive, 0.349: a Codex edit row read "src/signup.ts
// file_change" -- Codex's record type, on the screen as a label.
describe('the word on a file row', () => {
  it("says Codex's change as a word", () => {
    expect(fileToolWord('file_change')).toBe('changed')
  }, 10_000)

  it("keeps every other runtime's own tool word", () => {
    expect(fileToolWord('read')).toBe('read')
    expect(fileToolWord('edit')).toBe('edit')
    expect(fileToolWord('Write')).toBe('Write')
  }, 10_000)
})
