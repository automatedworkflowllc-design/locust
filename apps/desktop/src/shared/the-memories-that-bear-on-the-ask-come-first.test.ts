import { describe, expect, it } from 'vitest'

import { MEMORY_BRIEF_LINES_WITH_FILE, memoriesForBrief, memorySection } from './memory.js'
import type { MemoryLine } from './memory.js'

/**
 * Plan item 3, 2026-09-21: 76 memories on Colin's store, 8 pasted per turn,
 * chosen by DATE alone. Measured first with `_tools/memory-recall-drive.mjs`:
 * a free model DID open `.locust/memory.md` for an answer the brief had
 * dropped -- so the file works, and this is the cheaper path, not a rescue.
 */

const line = (text: string, at: string, scope: MemoryLine['scope'] = 'workspace'): MemoryLine => ({
  text,
  scope,
  by: 'you',
  where: undefined,
  at
})

/** Twelve folder memories, oldest first; only the oldest names the secret. */
const TWELVE: readonly MemoryLine[] = [
  line('The secret word for this project is PELICAN.', '2026-09-01T05:00:00.000Z'),
  ...[
    'The build command is pnpm build.',
    'Tests run with pnpm test, never npm.',
    'The person prefers diffs to prose.',
    'Docs live under docs/ and are Markdown.',
    'The API listens on port 4000 in development.',
    'Commits are written in the imperative.',
    'The release script is _tools/ship.mjs.',
    'CSS tokens are in shell.css and nowhere else.',
    'The sidebar lists conversations newest first.',
    'Rooms are for more than one teammate at once.',
    'The changelog is written for people, not engineers.'
  ].map((text, index) => line(text, `2026-09-${String(2 + index).padStart(2, '0')}T05:00:00.000Z`))
]
const NEWEST_EIGHT = TWELVE.slice(-8).reverse().map((memory) => memory.text)

describe('the memories that bear on the ask come first', () => {
  it('with no question, is the newest eight, newest first', () => {
    const chosen = memoriesForBrief(TWELVE, undefined, MEMORY_BRIEF_LINES_WITH_FILE)
    expect(chosen).toHaveLength(8)
    // Newest FIRST, because the brief spends its allowance from the front: in
    // date order, the notes cut when eight long ones did not fit were the
    // ones written last (Colin's store, 2026-09-26: 47 of 104 turns).
    expect(chosen.map((memory) => memory.text)).toEqual(NEWEST_EIGHT)
    expect(chosen.some((memory) => /PELICAN/.test(memory.text))).toBe(false)
  })

  it('moves the one memory that answers the question to the front, however old', () => {
    const chosen = memoriesForBrief(TWELVE, 'What is the secret word for this project?', MEMORY_BRIEF_LINES_WITH_FILE)
    expect(chosen[0]?.text).toContain('PELICAN')
  })

  it('a question that matches nothing changes nothing', () => {
    const chosen = memoriesForBrief(TWELVE, 'Refactor the login page', MEMORY_BRIEF_LINES_WITH_FILE)
    expect(chosen.map((memory) => memory.text)).toEqual(NEWEST_EIGHT)
  })

  it('scores on topic words, not on "the"', () => {
    // Every memory contains "the"; a question made of nothing else ranks none.
    const chosen = memoriesForBrief(TWELVE, 'the and for this', MEMORY_BRIEF_LINES_WITH_FILE)
    expect(chosen.map((memory) => memory.text)).toEqual(NEWEST_EIGHT)
  })

  it('more shared words outrank fewer, and among equals the newer wins', () => {
    const memories = [
      line('The build is slow on Windows.', '2026-09-01T05:00:00.000Z'),
      line('The build command is pnpm build, run from the root.', '2026-09-02T05:00:00.000Z'),
      line('Lunch is at noon.', '2026-09-03T05:00:00.000Z'),
      line('The build command changed to pnpm build --filter desktop.', '2026-09-04T05:00:00.000Z')
    ]
    const chosen = memoriesForBrief(memories, 'What is the build command?', 8)
    expect(chosen[0]?.text).toContain('--filter desktop')
    expect(chosen[1]?.text).toContain('run from the root')
    expect(chosen[2]?.text).toContain('slow on Windows')
    expect(chosen[3]?.text).toContain('Lunch')
  })

  it('a memory from everywhere is ranked too, and the folder still comes first among the rest', () => {
    const memories = [
      line('Colin wants diffs, not prose.', '2026-09-01T05:00:00.000Z', 'global'),
      line('The API listens on port 4000.', '2026-09-02T05:00:00.000Z'),
      line('Tests run with pnpm test.', '2026-09-03T05:00:00.000Z')
    ]
    const chosen = memoriesForBrief(memories, 'Show me the diffs, not prose', 8)
    expect(chosen[0]?.scope).toBe('global')
    expect(chosen.slice(1).map((memory) => memory.text)).toEqual(['Tests run with pnpm test.', 'The API listens on port 4000.'])
  })

  it('the brief pastes the answer when asked, and says the rest are in the file', () => {
    const brief = memorySection({
      workspaceName: 'scratch',
      memories: TWELVE,
      askFirst: false,
      file: '.locust/memory.md',
      now: new Date('2026-09-21T00:00:00.000Z'),
      query: 'What is the secret word for this project?'
    })
    expect(brief).toContain('PELICAN')
    expect(brief).toContain('4 older memories are in .locust/memory.md')
    const without = memorySection({
      workspaceName: 'scratch',
      memories: TWELVE,
      askFirst: false,
      file: '.locust/memory.md',
      now: new Date('2026-09-21T00:00:00.000Z')
    })
    expect(without).not.toContain('PELICAN')
  })
})
