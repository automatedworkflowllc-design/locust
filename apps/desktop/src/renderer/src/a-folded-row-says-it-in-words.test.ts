import { describe, expect, it } from 'vitest'

import { foldedToolsLead } from './missionView.js'

/**
 * A FOLDED ROW SAYS IT IN WORDS (0.550). Sol on 0.546: OpenCode's grouped
 * reads said "read 3 -- words, .git, .git/HEAD" in code type, under Activity
 * rows that say "Read". The group says what the rows say.
 */
describe('what a folded group did', () => {
  it("reads as Activity's rows do, for each runtime's read tool", () => {
    expect(foldedToolsLead(3, 'read')).toBe('Read 3 files')
    expect(foldedToolsLead(2, 'view_file')).toBe('Read 2 files')
    expect(foldedToolsLead(2, 'Read')).toBe('Read 2 files')
  })

  it('searches are counted as searches', () => {
    expect(foldedToolsLead(4, 'grep')).toBe('Searched 4 times')
  })

  it('a tool with no word of its own is counted, never named in code', () => {
    expect(foldedToolsLead(2, 'zork_frobnicate')).toBe('2 tool calls')
    expect(foldedToolsLead(2, undefined)).toBe('2 tool calls')
  })
})
