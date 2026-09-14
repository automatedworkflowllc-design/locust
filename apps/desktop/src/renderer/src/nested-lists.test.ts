import { describe, expect, it } from 'vitest'

import { parseAgentText, segmentsCoverInput } from './agentText.js'
import type { AgentBlock } from './agentText.js'

/*
 * B5 of docs/PLAN-2026-09-13-INTERACTION.md, and the one Claude Code parity
 * item Colin could see. Every item became a top-level row whatever its
 * indent, so a three-level answer came out as one column of equal-weight
 * lines -- and in a list the structure IS the content.
 */
const lines = (...rows: readonly string[]): string => rows.join(String.fromCharCode(10))

const listOf = (blocks: readonly AgentBlock[]) => {
  const block = blocks.find((entry) => entry.kind === 'list')
  return block !== undefined && block.kind === 'list' ? block.items : []
}

describe('a nested list keeps its shape', () => {
  it('reads two-space indents as depth', () => {
    const items = listOf(parseAgentText(lines('- one', '  - one a', '  - one b', '- two')))
    expect(items.map((item) => [item.text, item.depth])).toEqual([
      ['one', 0],
      ['one a', 1],
      ['one b', 1],
      ['two', 0]
    ])
  })

  it('reads four-space indents as the SAME depth as two-space', () => {
    // The reason depth comes from an indent stack rather than a width: models
    // use two, four and tabs interchangeably, often in one answer, and the
    // same structure must not draw two ways.
    const two = listOf(parseAgentText(lines('- one', '  - child')))
    const four = listOf(parseAgentText(lines('- one', '    - child')))
    const tab = listOf(parseAgentText(lines('- one', String.fromCharCode(9) + '- child')))
    expect(two.map((item) => item.depth)).toEqual([0, 1])
    expect(four.map((item) => item.depth)).toEqual([0, 1])
    expect(tab.map((item) => item.depth)).toEqual([0, 1])
  })

  it('comes back OUT of a nesting', () => {
    const items = listOf(parseAgentText(lines('- a', '  - a1', '    - a2', '  - a3', '- b')))
    expect(items.map((item) => item.depth)).toEqual([0, 1, 2, 1, 0])
  })

  it('treats a numbered list nested under a bullet as a child, not a new list', () => {
    // A change of marker used to end the list outright, which was half the
    // flattening: the children became a second list at top level.
    const blocks = parseAgentText(lines('- one', '  1. first', '  2. second', '- two'))
    expect(blocks.filter((block) => block.kind === 'list')).toHaveLength(1)
    expect(listOf(blocks).map((item) => item.depth)).toEqual([0, 1, 1, 0])
  })

  it('still starts a new list when the marker changes at the SAME depth', () => {
    const blocks = parseAgentText(lines('- a', '1. b'))
    expect(blocks.filter((block) => block.kind === 'list')).toHaveLength(2)
  })

  it('drops nothing, at any depth', () => {
    const text = lines('intro', '- a', '  - b', '    - c', 'after')
    expect(segmentsCoverInput(text, parseAgentText(text))).toBe(true)
  })

  it('a flat list is still flat', () => {
    const items = listOf(parseAgentText(lines('- a', '- b')))
    expect(items.every((item) => item.depth === 0)).toBe(true)
  })
})
