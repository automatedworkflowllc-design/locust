import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { parseAgentText, segmentsCoverInput } from './agentText.js'
import type { AgentBlock } from './agentText.js'
import { AgentText } from './components/ThreadItems.js'
// The real file, through Vite: the case that was seen, not a model of it.
import CHANGELOG from '../../../../../CHANGELOG.md?raw'

/**
 * A BLANK LINE INSIDE A LIST DOES NOT END IT BY ITSELF.
 *
 * Found reading Settings > This app on 0.258.0 (design pass, 2026-09-22): the
 * changelog's first bullet had a second paragraph, indented under it the way
 * `CHANGELOG.md` writes every one, and it was drawn OUTSIDE the list at the
 * left margin, broken at the source file's line ends -- "so / the sign-in
 * itself stays, once per runtime". The same banner is what a person reads
 * right after an update.
 *
 * The parser is the one every reply goes through, and the same rule broke a
 * shape models write constantly: numbered steps with a blank line between
 * them. Each step became a list of its own, and each was drawn as "1.".
 */
const lines = (...rows: readonly string[]): string => rows.join(String.fromCharCode(10))

const lists = (blocks: readonly AgentBlock[]) =>
  blocks.flatMap((block) => (block.kind === 'list' ? [block] : []))

describe('a blank line does not end a list', () => {
  it('keeps numbered steps with blank lines between them as ONE list', () => {
    const text = lines('1. **Install**', '', '2. **Sign in**', '', '3. **Start a mission**')
    const blocks = parseAgentText(text)
    expect(lists(blocks)).toHaveLength(1)
    expect(lists(blocks)[0]?.items.map((item) => [item.text, item.number])).toEqual([
      ['**Install**', 1],
      ['**Sign in**', 2],
      ['**Start a mission**', 3]
    ])
    expect(segmentsCoverInput(text, blocks)).toBe(true)
  })

  it('draws them 1, 2, 3 -- not 1, 1, 1', () => {
    const html = renderToStaticMarkup(
      <AgentText text={lines('1. one', '', '2. two', '', '3. three')} streaming={false} />
    )
    expect(html.match(/<ol/g)).toHaveLength(1)
    expect(html.match(/<li/g)).toHaveLength(3)
  })

  it('keeps an indented second paragraph inside its item', () => {
    const text = lines(
      '- **Title.** Line one',
      '  wraps here.',
      '',
      '  A second paragraph,',
      '  hard wrapped in the source.',
      '',
      '- Next item'
    )
    const blocks = parseAgentText(text)
    expect(blocks).toHaveLength(1)
    const [first, second] = lists(blocks)[0]?.items ?? []
    expect(first?.text).toBe('**Title.** Line one wraps here.')
    // Joined, not broken where the source file happened to wrap.
    expect(first?.paragraphs).toEqual(['A second paragraph, hard wrapped in the source.'])
    expect(second?.text).toBe('Next item')
    expect(segmentsCoverInput(text, blocks)).toBe(true)
  })

  /** One entry's body, the way the What changed page is handed it. */
  const entry = (version: string): string => {
    const part = CHANGELOG.split(/^## /m).find((candidate) => candidate.startsWith(`${version} `)) ?? ''
    return part.split(String.fromCharCode(10)).slice(1).join(String.fromCharCode(10)).trim()
  }

  it('reads the changelog entry that showed it, with the paragraph inside its bullet', () => {
    const body = entry('0.258.0')
    expect(body.length).toBeGreaterThan(0)
    const blocks = parseAgentText(body)
    // Two bullets, ONE list, and no stray paragraph between them.
    expect(blocks.map((block) => block.kind)).toEqual(['list'])
    expect(lists(blocks)[0]?.items[0]?.paragraphs?.[0]).toMatch(/^A command-line tool cannot use/)
    expect(segmentsCoverInput(body, blocks)).toBe(true)
  })

  it('drops no words from any entry in the changelog', () => {
    // Every entry, not only the one that showed it: a list rule that eats a
    // paragraph anywhere in the history is caught here.
    const versions = [...CHANGELOG.matchAll(/^## (\d+\.\d+\.\d+)/gm)].map((match) => match[1] ?? '')
    expect(versions.length).toBeGreaterThan(50)
    for (const version of versions) {
      const body = entry(version)
      expect(segmentsCoverInput(body, parseAgentText(body)), version).toBe(true)
    }
  })

  it('resumes the numbering after a code block splits the steps', () => {
    const html = renderToStaticMarkup(
      <AgentText text={lines('1. one', '2. two', '```', 'npm test', '```', '3. three')} streaming={false} />
    )
    expect(html).toContain('<ol class="lc-list" start="3">')
  })

  it('still ends the list at prose that is not indented under it', () => {
    /*
     * The control. "Pros:", a list, a blank line, then a sentence at the left
     * margin is a list followed by prose -- the reading that has always been
     * right, and the one this change must not eat.
     */
    const text = lines('- fast', '- small', '', 'That is the whole case for it.')
    const blocks = parseAgentText(text)
    expect(blocks.map((block) => block.kind)).toEqual(['list', 'text'])
    expect(lists(blocks)[0]?.items.map((item) => item.paragraphs)).toEqual([undefined, undefined])
  })

  it('still starts a new list when the kind changes after the blank line', () => {
    const blocks = parseAgentText(lines('- a bullet', '', '1. a step'))
    expect(lists(blocks).map((list) => list.ordered)).toEqual([false, true])
  })
})
