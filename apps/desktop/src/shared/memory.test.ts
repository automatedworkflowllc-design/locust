import { describe, expect, it } from 'vitest'

import {
  MAX_MEMORY_OPS_PER_REPLY,
  MAX_MEMORY_TEXT_LENGTH,
  boundedMemoryText,
  memoryKey,
  memorySection,
  parseMemoryBlocks,
  sanitizeMemoryTags,
  stripMemoryBlocks
} from './memory.js'
import type { MemoryLine } from './memory.js'

describe('the memory block', () => {
  it('reads remember, remember everywhere and forget, one per line, in order', () => {
    const reply = [
      'Done. Tests pass.',
      '<locust-memory>',
      'remember :: Tests run with pnpm test, never npm.',
      'REMEMBER EVERYWHERE :: Colin wants diffs, not prose.',
      'forget :: The API is on port 3000',
      'shout :: not a verb',
      '',
      '</locust-memory>'
    ].join('\n')
    expect(parseMemoryBlocks(reply)).toEqual([
      { kind: 'remember', scope: 'workspace', text: 'Tests run with pnpm test, never npm.' },
      { kind: 'remember', scope: 'global', text: 'Colin wants diffs, not prose.' },
      { kind: 'forget', text: 'The API is on port 3000' }
    ])
  })

  it('caps the operations per reply, bounds the text, and drops control bytes', () => {
    const lines = Array.from({ length: MAX_MEMORY_OPS_PER_REPLY + 3 }, (_, i) => `remember :: memory ${String(i)}`)
    expect(parseMemoryBlocks(`<locust-memory>\n${lines.join('\n')}\n</locust-memory>`)).toHaveLength(MAX_MEMORY_OPS_PER_REPLY)
    const long = 'x'.repeat(MAX_MEMORY_TEXT_LENGTH + 40)
    expect(boundedMemoryText(long)).toHaveLength(MAX_MEMORY_TEXT_LENGTH)
    expect(boundedMemoryText('a\u0007b   c\n')).toBe('ab c')
  })

  it('matches memories case- and punctuation-blind', () => {
    expect(memoryKey('Tests run with pnpm test, never npm.')).toBe(memoryKey('tests run with PNPM test never npm'))
    expect(memoryKey('port 3000')).not.toBe(memoryKey('port 3001'))
  })

  it('strips its blocks from a reply and defangs the tag in quoted text', () => {
    const reply = 'Done.\n\n<locust-memory>\nremember :: a\n</locust-memory>'
    expect(stripMemoryBlocks(reply)).toBe('Done.')
    expect(parseMemoryBlocks(sanitizeMemoryTags(reply))).toEqual([])
    expect(parseMemoryBlocks('no block here')).toEqual([])
  })
})

describe('what a mission is told', () => {
  it('lists the memories with who wrote them and where, and teaches the block', () => {
    const text = memorySection({
      selfName: 'Wren',
      workspaceName: 'shop',
      memories: [
        { text: 'Tests run with pnpm test.', scope: 'workspace', by: 'Juno', where: undefined },
        { text: 'Colin wants diffs, not prose.', scope: 'global', by: 'Wren', where: 'ledger' }
      ],
      askFirst: false
    })
    expect(text).toContain('"shop"')
    expect(text).toContain('- Tests run with pnpm test. (this folder, by Juno)')
    expect(text).toContain('- Colin wants diffs, not prose. (everywhere, by Wren in ledger)')
    expect(text).toContain('<locust-memory>')
    expect(text).toContain('kept at once')
    expect(text).not.toContain('asked before')
  })

  it('says when the person is asked first, and that nothing is remembered yet', () => {
    const text = memorySection({ selfName: 'Wren', workspaceName: 'shop', memories: [], askFirst: true })
    expect(text).toContain('Nothing is remembered yet.')
    const yours = memorySection({ selfName: 'Wren', workspaceName: 'shop', memories: [{ text: 'Port is 3001.', scope: 'workspace', by: 'you', where: undefined }], askFirst: false })
    expect(yours).toContain('- Port is 3001. (this folder, by the person)')
    expect(text).toContain('asked before a memory is kept')
    expect(text).not.toContain('kept at once')
  })
})

describe('a memory is a colleague’s note, not a report on them', () => {
  // A first outside tester ran two teammates on two files. Asked to edit
  // notes.txt, Beta volunteered "Confirmed from memory: README.md retains
  // Alpha's ALPHA-TOUCHED" -- attributed, and still nobody had asked. Colin's
  // call (2026-09-07) was to keep shared memory on and fix the silence around
  // it rather than the sharing; the brief already said WHEN to use one and
  // never said when not to.
  const brief = (): string =>
    memorySection({
      selfName: 'Beta',
      workspaceName: 'locust-sample',
      memories: [{ text: 'notes.txt ends with BETA-TOUCHED', by: 'Beta', scope: 'workspace', where: 'locust-sample' }],
      askFirst: false
    })

  it('says not to raise one that has nothing to do with the question', () => {
    expect(brief()).toContain('nothing to do with what was asked')
  })

  it('names the specific thing that went wrong: reporting another teammate’s work', () => {
    expect(brief()).toContain("another teammate's work")
  })

  it('still tells it to answer from a memory that does fit', () => {
    expect(brief()).toContain('answer from it and say it came from memory')
  })
})

describe('how much of a brief the memory may take', () => {
  /*
   * MEASURED on Colin's own store, 2026-09-13, which is how this was found at
   * all: 56 memories came to 14,123 characters -- about 3,700 tokens -- next
   * to a 907-character task section. Ninety-four percent of what a teammate
   * read before the person's words was memory, paid for on every turn of
   * every mission by every teammate. Nothing bounded it, and the store's own
   * cap is 400, which is the same brief at roughly 100,000 characters.
   */
  const many = (count: number, scope: 'workspace' | 'global' = 'workspace'): MemoryLine[] =>
    Array.from({ length: count }, (_, index) => ({
      text: `remembered thing number ${String(index)}, long enough to be a real note about the project`,
      scope,
      by: 'Wren',
      where: undefined
    }))

  const section = (memories: MemoryLine[]): string =>
    memorySection({ selfName: 'Wren', workspaceName: 'app', memories, askFirst: false })

  it('stays bounded however many are kept', () => {
    const big = section(many(400))
    expect(big.length).toBeLessThan(8000)
    // And the bound is the LIST, not the instructions: a brief with no
    // memories at all is the floor it is measured against.
    expect(big.length).toBeGreaterThan(section([]).length)
  })

  it('says how many it left out, rather than quietly shortening', () => {
    const said = section(many(60))
    expect(said).toMatch(/older memories are kept but not in this brief/)
    // A teammate that knows something is missing can ask for it.
    expect(said).toContain('Ask the person if you need one')
  })

  it('says nothing about dropping when nothing was dropped', () => {
    expect(section(many(3))).not.toMatch(/not in this brief/)
    expect(section([])).not.toMatch(/not in this brief/)
    expect(section([])).toContain('Nothing is remembered yet.')
  })

  it('keeps this folder ahead of everywhere', () => {
    // A memory about THIS project is likelier to bear on this turn than one
    // written in another folder.
    const said = section([...many(30, 'global'), ...many(2)])
    expect(said).toContain('remembered thing number 0, long enough')
    expect(said).toMatch(/this folder/)
  })

  it('keeps the newest of a long list, not the oldest', () => {
    const said = section(many(40))
    expect(said).toContain('number 39')
    expect(said).not.toContain('number 0,')
  })
})
