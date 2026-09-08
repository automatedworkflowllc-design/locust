import { describe, expect, it } from 'vitest'

import { attachmentLabel, attachmentPreamble, withAttachments } from './attachments.js'

describe('naming attached files in a message', () => {
  it('draws nothing at all when nothing is attached', () => {
    // So a caller cannot prepend an empty instruction to every message.
    expect(attachmentPreamble([])).toBeUndefined()
    expect(withAttachments('Fix the parser.', [])).toBe('Fix the parser.')
  })

  it('names one file, and asks for it to be read', () => {
    const said = attachmentPreamble(['src/parser.ts'])
    expect(said).toContain('src/parser.ts')
    expect(said).toMatch(/read this file/i)
  })

  it('counts them when there are several', () => {
    const said = attachmentPreamble(['a.ts', 'b.ts', 'c.ts'])
    expect(said).toMatch(/read these 3 files/i)
    for (const path of ['a.ts', 'b.ts', 'c.ts']) expect(said).toContain(path)
  })

  it('puts the instruction ABOVE what the person typed', () => {
    // The runtime should know what it is working from before it reads the
    // request, not after.
    const sent = withAttachments('Fix the parser.', ['src/parser.ts'])
    expect(sent.indexOf('src/parser.ts')).toBeLessThan(sent.indexOf('Fix the parser.'))
    expect(sent.endsWith('Fix the parser.')).toBe(true)
  })

  it('NEVER inlines a file, however tempting', () => {
    // THE test. Pasting contents would eat the prompt budget that inbound peer
    // messages already lose to -- `composeRuntimePrompt` drops a waiting
    // message when the prompt runs long. A path costs a line.
    const sent = withAttachments('Summarise it.', ['notes.md'])
    expect(sent.length).toBeLessThan(200)
  })

  it('says "file", not "attached", because on most runtimes nothing is', () => {
    // Five of six get a reference, not an attachment. A word that overstates
    // what happened is the thing this app keeps refusing to do.
    expect(attachmentLabel(1)).toBe('1 file')
    expect(attachmentLabel(3)).toBe('3 files')
    expect(attachmentLabel(1)).not.toMatch(/attach/i)
  })
})
