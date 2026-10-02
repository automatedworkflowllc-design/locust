import { describe, expect, it } from 'vitest'

import { fileToolWord } from './components/ActivityCard.js'

// First-impressions drive, 0.349: a Codex edit row read "src/signup.ts
// file_change" -- Codex's record type, on the screen as a label.
describe('the word on a file row', () => {
  it("says Codex's change as a word", () => {
    expect(fileToolWord('file_change')).toBe('changed')
  }, 10_000)

  it("says a read, a search, a listing and a fetch in Claude Code's words, whoever ran it (0.545)", () => {
    // Cursor's 0.544 pass: Read on Claude, read on Cursor, view_file on Antigravity.
    for (const read of ['Read', 'read', 'view_file', 'read_file']) expect(fileToolWord(read), read).toBe('Read')
    expect(fileToolWord('grep_search')).toBe('Grep')
    expect(fileToolWord('list_dir')).toBe('Glob')
    expect(fileToolWord('find_by_name')).toBe('Glob')
    expect(fileToolWord('search_web')).toBe('WebSearch')
    expect(fileToolWord('read_url_content')).toBe('WebFetch')
  }, 10_000)

  it("keeps a word with no Claude Code counterpart as it is", () => {
    expect(fileToolWord('edit')).toBe('edit')
    expect(fileToolWord('Write')).toBe('Write')
  }, 10_000)
})
