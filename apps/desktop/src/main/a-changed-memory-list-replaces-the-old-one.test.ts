import { describe, expect, it } from 'vitest'

import { memorySection } from '../shared/memory.js'
import { composeRuntimePrompt, MEMORY_LIST_REPLACES } from './workroom-briefing.js'
import type { MissionPeerContext } from './workroom-briefing.js'

/**
 * A MEMORY LIST SENT AGAIN SAYS IT REPLACES THE LAST ONE (0.418).
 *
 * Fresh-eyes area 12, packaged 0.417 on Nemotron, twice: a memory edited from
 * PELICAN to HERON and switched off, and Wren -- asked again in the same
 * conversation -- quoted PELICAN as still remembered. A resumed turn is sent
 * only the paragraphs that changed, after a line saying the rest "still
 * holds", so the new list read as more memories beside the old ones.
 * drive-memory repeats it against the packaged build.
 */
const NOW = '2026-09-27T21:00:00.000Z'
const PEER: MissionPeerContext = { self: { teammateId: 'tm_wren', name: 'Wren', role: 'Code & Migrations' }, others: [] }
const memory = (texts: readonly string[]): string =>
  memorySection({
    workspaceName: 'shop',
    memories: texts.map((text, index) => ({ id: `m${String(index)}`, text, scope: 'workspace' as const, by: 'you', where: undefined, at: NOW })),
    askFirst: false,
    selfName: 'Wren',
    now: new Date(NOW)
  })
const turn = (texts: readonly string[], alreadyGiven?: ReadonlySet<string>) =>
  composeRuntimePrompt({ prompt: 'Quote every remembered line.', peer: PEER, inbound: [], remaining: 0, memory: memory(texts), ...(alreadyGiven === undefined ? {} : { alreadyGiven }) })

describe('a memory list sent to a session that holds an earlier one', () => {
  const first = turn(['The secret word for this project is PELICAN.'])

  it('says it replaces the earlier list, and the old line is not in it', () => {
    const second = turn(['Colin wants diffs, not prose.'], new Set(first.given))
    expect(second.prompt).toContain(MEMORY_LIST_REPLACES)
    expect(second.prompt).toContain('Colin wants diffs, not prose.')
    expect(second.prompt).not.toContain('PELICAN')
    // Said right above the list it is about.
    expect(second.prompt.indexOf(MEMORY_LIST_REPLACES)).toBeLessThan(second.prompt.indexOf('Colin wants diffs'))
  })

  it('says so when everything was forgotten, too', () => {
    const emptied = turn([], new Set(first.given))
    expect(emptied.prompt).toContain(MEMORY_LIST_REPLACES)
    expect(emptied.prompt).toContain('Nothing is remembered yet.')
  })

  it('is not said on a first brief, or when the list did not change', () => {
    expect(first.prompt).not.toContain(MEMORY_LIST_REPLACES)
    const same = turn(['The secret word for this project is PELICAN.'], new Set(first.given))
    expect(same.prompt).not.toContain(MEMORY_LIST_REPLACES)
  })
})
