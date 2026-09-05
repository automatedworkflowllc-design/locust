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
    expect(boundedMemoryText('ab   c\n')).toBe('ab c')
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
