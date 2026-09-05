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

describe('lists', () => {
  it('lifts a run of bullets out of the prose instead of running them together', () => {
    // MEASURED 2026-09-03: this exact shape rendered as one sentence.
    const blocks = parseAgentText(
      lines('Implemented the streak fix.', '- currentStreak counts yesterday', '- It resets once missed', 'Verification: 3 tests passed.')
    )
    expect(blocks).toEqual([
      { kind: 'text', text: 'Implemented the streak fix.' },
      { kind: 'list', ordered: false, items: ['currentStreak counts yesterday', 'It resets once missed'] },
      { kind: 'text', text: 'Verification: 3 tests passed.' }
    ])
  })

  it('reads a numbered list as ordered', () => {
    expect(parseAgentText(lines('1. first', '2) second'))).toEqual([
      { kind: 'list', ordered: true, items: ['first', 'second'] }
    ])
  })

  it('starts a new list when the kind changes', () => {
    expect(parseAgentText(lines('- a', '1. b'))).toEqual([
      { kind: 'list', ordered: false, items: ['a'] },
      { kind: 'list', ordered: true, items: ['b'] }
    ])
  })

  it('does not treat a sentence containing a dash as a list', () => {
    const text = 'It resets - once yesterday is missing.'
    expect(parseAgentText(text)).toEqual([{ kind: 'text', text }])
  })

  it('still drops nothing', () => {
    for (const input of [
      lines('intro', '- one', '- two'),
      lines('- only'),
      lines('1. a', '', 'after'),
      lines('- a', '```', 'code', '```', '- b')
    ]) {
      expect(segmentsCoverInput(input, parseAgentText(input)), input).toBe(true)
    }
  })
})

describe('links', () => {
  it('shows the label and keeps the target off the sentence', () => {
    expect(splitInlineCode('see [src/streak.test.js](C:/w/src/streak.test.js) for the cases')).toEqual([
      { kind: 'plain', text: 'see ' },
      { kind: 'link', text: 'src/streak.test.js', href: 'C:/w/src/streak.test.js' },
      { kind: 'plain', text: ' for the cases' }
    ])
  })

  it('leaves brackets that are not a link alone', () => {
    expect(splitInlineCode('an array [1, 2] and a note')).toEqual([
      { kind: 'plain', text: 'an array [1, 2] and a note' }
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

describe('headings and emphasis', () => {
  // The QA pass on 0.21.2 read a literal `### Summary` from Codex and a
  // literal `**Yes, whitespace-only input is already covered.**` from
  // Claude. Both are the model's own structure drawn as punctuation.
  it('lifts a hash heading out of the prose, at its level', () => {
    expect(parseAgentText(lines('### Summary', 'Two files changed.'))).toEqual([
      { kind: 'heading', level: 3, text: 'Summary' },
      { kind: 'text', text: 'Two files changed.' }
    ])
    expect(parseAgentText('# Title')).toEqual([{ kind: 'heading', level: 1, text: 'Title' }])
    expect(parseAgentText('## Title ##')).toEqual([{ kind: 'heading', level: 2, text: 'Title' }])
    // Deeper than three is drawn as the third: the thread has three sizes.
    expect(parseAgentText('##### Deep')).toEqual([{ kind: 'heading', level: 3, text: 'Deep' }])
  })

  it('does not mistake a hashtag or a shell comment for a heading', () => {
    expect(parseAgentText('#123 is the issue')).toEqual([{ kind: 'text', text: '#123 is the issue' }])
    expect(parseAgentText('#')).toEqual([{ kind: 'text', text: '#' }])
  })

  it('a heading ends the list before it', () => {
    expect(parseAgentText(lines('- one', '- two', '## Next', 'prose'))).toEqual([
      { kind: 'list', ordered: false, items: ['one', 'two'] },
      { kind: 'heading', level: 2, text: 'Next' },
      { kind: 'text', text: 'prose' }
    ])
  })

  it('keeps every word when headings are lifted', () => {
    const text = lines('# A', 'para', '## B', '- x', '### C')
    expect(segmentsCoverInput(text, parseAgentText(text))).toBe(true)
  })

  it('draws **bold** and *emphasis* as spans, and leaves the markers out', () => {
    expect(splitInlineCode('**Yes, whitespace-only input is already covered.** Then more.')).toEqual([
      { kind: 'strong', text: 'Yes, whitespace-only input is already covered.' },
      { kind: 'plain', text: ' Then more.' }
    ])
    expect(splitInlineCode('use *care* here')).toEqual([
      { kind: 'plain', text: 'use ' },
      { kind: 'em', text: 'care' },
      { kind: 'plain', text: ' here' }
    ])
    expect(splitInlineCode('__also bold__ and _also em_')).toEqual([
      { kind: 'strong', text: 'also bold' },
      { kind: 'plain', text: ' and ' },
      { kind: 'em', text: 'also em' }
    ])
  })

  it('does not turn identifiers or arithmetic into emphasis', () => {
    // A marker inside a word is part of the word; a spaced star is a star.
    expect(splitInlineCode('snake_case_name and 2 * 3 * 4')).toEqual([
      { kind: 'plain', text: 'snake_case_name and 2 * 3 * 4' }
    ])
    expect(splitInlineCode('a lone * star')).toEqual([{ kind: 'plain', text: 'a lone * star' }])
    expect(splitInlineCode('**unclosed bold')).toEqual([{ kind: 'plain', text: '**unclosed bold' }])
  })

  it('keeps markers inside code spans literal', () => {
    expect(splitInlineCode('run `a ** b` now')).toEqual([
      { kind: 'plain', text: 'run ' },
      { kind: 'code', text: 'a ** b' },
      { kind: 'plain', text: ' now' }
    ])
  })
})
