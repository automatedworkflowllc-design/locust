import { describe, expect, it } from 'vitest'

import { parseAgentText, segmentsCoverInput } from './agentText.js'
import type { AgentBlock } from './agentText.js'

/*
 * A list item whose sentence ran past one line came apart.
 *
 * The parser ended the list at the first line that was not itself a bullet,
 * so the item kept its first line and the rest of the sentence became a
 * paragraph underneath it -- outside the list, at the left margin, with
 * paragraph spacing above it. Colin saw it in the "What changed" banner,
 * which reads `CHANGELOG.md`, where every entry wraps with two-space
 * continuations (2026-09-19, screenshot): "this format is slightly off".
 *
 * It is the same parser a teammate's reply is drawn with, so the same break
 * happened to any model that wrapped a bullet.
 */

const lines = (...rows: readonly string[]): string => rows.join(String.fromCharCode(10))
const listOf = (blocks: readonly AgentBlock[]) => {
  const block = blocks.find((entry) => entry.kind === 'list')
  return block !== undefined && block.kind === 'list' ? block.items : []
}

describe('a bullet that wraps', () => {
  it('stays one bullet, with the whole sentence in it', () => {
    const text = lines(
      '- **The decision card says one thing once.** When a teammate stops and asks',
      '  you to choose, the card told you twice that you could answer in your own',
      '  words instead.'
    )
    const blocks = parseAgentText(text)
    expect(blocks.filter((block) => block.kind === 'text')).toHaveLength(0)
    const items = listOf(blocks)
    expect(items).toHaveLength(1)
    expect(items[0]?.text).toBe(
      '**The decision card says one thing once.** When a teammate stops and asks you to choose, the card told you twice that you could answer in your own words instead.'
    )
  })

  it('keeps wrapping with the item it belongs to, not the one before', () => {
    const items = listOf(
      parseAgentText(lines('- first item', '  wrapped onto a second line', '- second item', '  and its own wrap'))
    )
    expect(items.map((item) => item.text)).toEqual([
      'first item wrapped onto a second line',
      'second item and its own wrap'
    ])
  })

  it('wraps a nested item into the nested item', () => {
    const items = listOf(parseAgentText(lines('- outer', '  - inner', '    wrapped inner line', '- next outer')))
    expect(items.map((item) => [item.text, item.depth])).toEqual([
      ['outer', 0],
      ['inner wrapped inner line', 1],
      ['next outer', 0]
    ])
  })

  it('still ends the list at a blank line', () => {
    const blocks = parseAgentText(lines('- a', '', 'prose after the list'))
    expect(listOf(blocks).map((item) => item.text)).toEqual(['a'])
    expect(blocks.some((block) => block.kind === 'text')).toBe(true)
  })

  it('still ends the list at UNINDENTED prose, which a model usually means as prose', () => {
    // Markdown would call this a lazy continuation. Models mean it as a new
    // paragraph about as often, and only the indented case was reported, so
    // the ambiguous one keeps the behaviour it had.
    const blocks = parseAgentText(lines('- a', 'prose at the margin'))
    expect(listOf(blocks).map((item) => item.text)).toEqual(['a'])
    expect(blocks.some((block) => block.kind === 'text')).toBe(true)
  })

  it('drops nothing', () => {
    const text = lines('intro', '- a', '  wrapped', '- b', '', 'after')
    expect(segmentsCoverInput(text, parseAgentText(text))).toBe(true)
  })
})
