import { describe, expect, it } from 'vitest'

import { byLastWritten, lastWritten, memoriesForBrief, memorySection } from './memory.js'

/**
 * A REWRITTEN MEMORY IS NEW.
 *
 * A named memory is rewritten in place, so it kept the date -- and the place
 * in the list -- of when it was first kept. The brief called today's status
 * two weeks old, and "the newer one is usually the correction" could side with
 * a genuinely older note (harness review, 2026-09-24).
 */
const status = { text: 'Orb suite: 31/31 passing.', scope: 'workspace' as const, by: 'Yurt', where: undefined, createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-09-24T05:00:00.000Z' }
const older = { text: 'Orb suite: 29/31, two flaky.', scope: 'workspace' as const, by: 'Juno', where: undefined, createdAt: '2026-09-10T10:00:00.000Z' }

describe('a memory rewritten in place', () => {
  it('is dated by its last write', () => {
    expect(lastWritten(status)).toBe('2026-09-24T05:00:00.000Z')
    expect(lastWritten(older)).toBe('2026-09-10T10:00:00.000Z')
  })

  it('sorts as the newest, whatever its first date', () => {
    // Stored order: the status first (kept in August), the older note after.
    expect(byLastWritten([status, older]).map((memory) => memory.by)).toEqual(['Juno', 'Yurt'])
  })

  it('leads the brief as the newest, and says it is from today', () => {
    const lines = byLastWritten([status, older]).map((memory) => ({ ...memory, at: lastWritten(memory) }))
    // With no query, the brief opens with the newest: the rewritten status.
    expect(memoriesForBrief(lines, undefined, 8)[0]?.text).toBe(status.text)
    const text = memorySection({ workspaceName: 'shop', memories: lines, askFirst: false, now: new Date('2026-09-24T06:00:00.000Z') })
    const statusLine = text.split('\n').find((line) => line.includes('31/31')) ?? ''
    expect(statusLine).not.toMatch(/weeks? ago|days? ago/)
  })

  it('keeps the store’s order for memories written at the same moment', () => {
    const a = { ...older, text: 'a' }
    const b = { ...older, text: 'b' }
    expect(byLastWritten([a, b]).map((memory) => memory.text)).toEqual(['a', 'b'])
  })
})
