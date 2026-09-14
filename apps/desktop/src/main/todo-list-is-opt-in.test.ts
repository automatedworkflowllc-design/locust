import { describe, expect, it } from 'vitest'

import {
  RUNTIMES_THAT_KEEP_A_TODO_LIST,
  composeRuntimePrompt,
  runtimeKeepsATodoList,
  todoSection
} from './workroom-briefing.js'
import type { MissionPeerContext } from './workroom-briefing.js'

/**
 * The todo-list request is opt in, and never sent to a runtime that cannot
 * honour it.
 *
 * Two gates, and the second is the one worth a test. The setting is the
 * person's answer; the runtime is what makes the question answerable. Claude
 * Code has NO todo tool -- measured by asking its CLI directly -- so sending
 * it the sentence would be an instruction it cannot follow, and the board
 * would then sit empty forever with nothing to explain it. An empty panel
 * that was promised is worse than a panel that was never offered.
 */

const peer: MissionPeerContext = {
  self: { teammateId: 'tm_wren', name: 'Wren', role: 'builder' },
  others: []
}

const compose = (keepATodoList: boolean): string =>
  composeRuntimePrompt({ prompt: 'Do the thing.', peer, inbound: [], remaining: 0, keepATodoList }).prompt

describe('keeping a todo list', () => {
  it('says nothing about todo lists unless asked to', () => {
    expect(compose(false)).not.toContain('KEEP A TODO LIST')
    expect(composeRuntimePrompt({ prompt: 'Do the thing.', peer, inbound: [], remaining: 0 }).prompt).not.toContain(
      'KEEP A TODO LIST'
    )
  })

  it('asks once, and asks for the list to be kept current', () => {
    const prompt = compose(true)
    expect(prompt).toContain('KEEP A TODO LIST')
    expect(prompt.match(/KEEP A TODO LIST/g)).toHaveLength(1)
    // The failure mode the section exists to prevent: a list written once.
    expect(prompt).toContain('keep it current')
    expect(prompt).toContain('stale list is worse than no list')
  })

  it('leaves the person words last, so the ask still reads closest to the asking', () => {
    expect(compose(true).trimEnd().endsWith('Do the thing.')).toBe(true)
  })

  it('offers it only to runtimes that have the tool', () => {
    expect([...RUNTIMES_THAT_KEEP_A_TODO_LIST].sort()).toEqual(['codex', 'cursor', 'opencode'])
    for (const runtime of RUNTIMES_THAT_KEEP_A_TODO_LIST) expect(runtimeKeepsATodoList(runtime)).toBe(true)
  })

  it('never offers it to Claude Code, which has no such tool', () => {
    expect(runtimeKeepsATodoList('claude')).toBe(false)
    // And nothing else that has not been measured.
    expect(runtimeKeepsATodoList('copilot')).toBe(false)
    expect(runtimeKeepsATodoList('gemini')).toBe(false)
    expect(runtimeKeepsATodoList('antigravity')).toBe(false)
  })

  it('describes a tool rather than a format, so it cannot compete with the real one', () => {
    // A shape described here arrives as prose that looks like a plan; the
    // board reads structured updates, not prose.
    expect(todoSection()).toContain('your own todo tool')
    expect(todoSection()).not.toContain('<')
  })
})
