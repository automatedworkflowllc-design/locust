import { describe, expect, it } from 'vitest'

import { parseAgentText, segmentsCoverInput, splitInlineCode } from './agentText.js'

const NL = String.fromCharCode(10)
const lines = (...parts: string[]): string => parts.join(NL)

describe('splitting a reply into prose and code', () => {
  it('pulls a fenced block out of the prose around it', () => {
    const blocks = parseAgentText(
      lines('Here is the patch:', '```diff', '-const a = 1', '+const a = 2', '```', 'Apply it when ready.')
    )
    expect(blocks).toEqual([
      { kind: 'text', text: 'Here is the patch:' },
      { kind: 'code', code: lines('-const a = 1', '+const a = 2'), language: 'diff', closed: true },
      { kind: 'text', text: 'Apply it when ready.' }
    ])
  })

  it('treats an unclosed fence as code still being written, not as prose', () => {
    // Replies stream. The closing fence arrives after the code it closes, and
    // a diff that renders as prose until the last token lands is unreadable
    // exactly while a person is watching it appear.
    const blocks = parseAgentText(lines('Working on it:', '```ts', 'const x = 1'))
    expect(blocks).toEqual([
      { kind: 'text', text: 'Working on it:' },
      { kind: 'code', code: 'const x = 1', language: 'ts', closed: false }
    ])
  })

  it('keeps a longer fence inside a shorter one as code', () => {
    const blocks = parseAgentText(lines('````', '```', 'still code', '````'))
    expect(blocks).toEqual([
      { kind: 'code', code: lines('```', 'still code'), language: undefined, closed: true }
    ])
  })

  it('reads a fence with no language', () => {
    const blocks = parseAgentText(lines('```', 'plain', '```'))
    expect(blocks).toEqual([{ kind: 'code', code: 'plain', language: undefined, closed: true }])
  })

  it('leaves a reply with no fences as a single block of prose', () => {
    expect(parseAgentText('Just an answer.')).toEqual([{ kind: 'text', text: 'Just an answer.' }])
  })

  it('drops nothing, whatever the shape of the reply', () => {
    // The invariant that matters more than any single case: formatting a
    // reply must never cost a word of it.
    const inputs = [
      '',
      'plain',
      lines('a', '```', 'b', '```', 'c'),
      lines('```', 'only code', '```'),
      lines('unclosed', '```js', 'x'),
      lines('```', '```'),
      lines('one', '', 'two'),
      lines('trailing fence', '```'),
      lines('```', 'a', '````', 'b', '```')
    ]
    for (const input of inputs) {
      expect(segmentsCoverInput(input, parseAgentText(input)), input).toBe(true)
    }
  })

  it('handles CRLF the way a Windows runtime emits it', () => {
    const blocks = parseAgentText('intro\r\n```\r\ncode\r\n```')
    expect(blocks).toEqual([
      { kind: 'text', text: 'intro' },
      { kind: 'code', code: 'code', language: undefined, closed: true }
    ])
  })
})

describe('inline code', () => {
  it('marks a matched pair and leaves the words around it alone', () => {
    expect(splitInlineCode('run `pnpm test` first')).toEqual([
      { kind: 'plain', text: 'run ' },
      { kind: 'code', text: 'pnpm test' },
      { kind: 'plain', text: ' first' }
    ])
  })

  it('leaves a lone backtick visible rather than swallowing the rest', () => {
    expect(splitInlineCode("it's a ` and nothing else")).toEqual([
      { kind: 'plain', text: "it's a ` and nothing else" }
    ])
  })

  it('never loses text', () => {
    for (const input of ['', 'a`b`c', '`x`', 'no ticks', '``', 'a `b` c `d` e']) {
      expect(splitInlineCode(input).map((span) => (span.kind === 'code' ? `\`${span.text}\`` : span.text)).join(''))
        .toBe(input)
    }
  })
})
