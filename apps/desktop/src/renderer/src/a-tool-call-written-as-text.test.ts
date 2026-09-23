import { describe, expect, it } from 'vitest'

import { fenceToolCalls, parseAgentText } from './agentText.js'

/**
 * A TOOL CALL WRITTEN AS TEXT IS DRAWN AS CODE, NOT AS WHAT THE MODEL SAID.
 *
 * The 0.271 design recheck: a free model via OpenCode wrote its edit call as
 * words -- `<tool_call><function=edit>...` -- and the thread drew it as the
 * reply's first paragraph.
 */
describe('a tool call in the reply', () => {
  it('becomes a code block labelled tool call, and the prose around it stays prose', () => {
    const blocks = parseAgentText('<tool_call><function=edit><parameter=path>notes.md</parameter></function></tool_call>\nI updated the notes.')
    expect(blocks[0]).toMatchObject({ kind: 'code', language: 'tool call' })
    expect(blocks.some((block) => block.kind !== 'code' && JSON.stringify(block).includes('I updated the notes.'))).toBe(true)
  })

  it('takes an unclosed one to the end, and leaves a reply without one alone', () => {
    expect(fenceToolCalls('Done.\n<tool_call><function=bash>ls')).toContain('```tool call\n<function=bash>ls\n```')
    expect(fenceToolCalls('No calls here.')).toBe('No calls here.')
  })
})
