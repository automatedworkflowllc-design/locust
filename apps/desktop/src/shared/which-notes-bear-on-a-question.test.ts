import { describe, expect, it } from 'vitest'

import { briefedMemories, memoriesForBrief } from './memory.js'
import type { MemoryLine } from './memory.js'

/**
 * WHICH NOTES BEAR ON A QUESTION.
 *
 * Measured on Colin's store, 2026-09-26: 97 notes, 104 of his real prompts,
 * and the notes a colleague would want for 76 of them, judged by reading.
 * Each rule below was one of the reasons the brief pasted the wrong ones.
 */

const line = (text: string, day: number): MemoryLine => ({
  text,
  scope: 'workspace',
  by: 'Wren',
  where: undefined,
  at: `2026-09-${String(day).padStart(2, '0')}T05:00:00.000Z`
})

const PLACES = ['sidebar', 'composer', 'thread', 'settings', 'roster', 'memory screen'] as const

/** Twenty notes that all say Locust, as nearly every note in Colin's store does. */
const TWENTY: readonly MemoryLine[] = [
  line('Locust keeps its orb animation in HomeCover.tsx.', 1),
  line('Deploys of Locust wait now, but builds go on.', 2),
  ...Array.from({ length: 18 }, (_, index) => line(`Locust note ${String(index)} about the ${PLACES[index % PLACES.length]!}.`, 3 + index))
]
const NEWEST_EIGHT = TWENTY.slice(-8).reverse().map((memory) => memory.text)
const texts = (memories: readonly MemoryLine[]): readonly string[] => memories.map((memory) => memory.text)

describe('which notes bear on a question', () => {
  it('a word few notes carry lifts a note, however old', () => {
    expect(memoriesForBrief(TWENTY, 'Where does Locust keep the orb?', 8)[0]?.text).toContain('orb animation')
  })

  it('the rarer of two shared words counts for more than the newer note', () => {
    // "orb" is in one note, "sidebar" in three newer ones. Counting shared
    // words tied them and the newest won; weighing them by rarity does not.
    // "Locust", in every note, weighs nothing: 42 of Colin's 104 prompts had
    // nine or more notes "bearing" on them when it counted.
    const chosen = memoriesForBrief(TWENTY, 'the orb and the sidebar', 8)
    expect(chosen[0]?.text).toContain('orb animation')
    expect(chosen.slice(1, 4).every((memory) => memory.text.includes('sidebar'))).toBe(true)
  })

  it('plain English words do not count', () => {
    // "but" and "now" were among the words most often making a note bear on
    // a question it had nothing to do with.
    expect(texts(memoriesForBrief(TWENTY, 'but now?', 8))).toEqual(NEWEST_EIGHT)
  })

  it('the brief keeps the newest when the allowance runs out', () => {
    // Eight long notes, four of which fit. In date order the brief kept the
    // four OLDEST: on Colin's store 47 of 104 turns pasted an older note and
    // left out the newest -- usually the correction.
    const long = Array.from({ length: 8 }, (_, index) => line(`Note from day ${String(index + 1)}: ${'x'.repeat(300)}`, index + 1))
    const briefed = texts(briefedMemories({ memories: long, file: '.locust/memory.md' }))
    expect(briefed.length).toBeLessThan(8)
    expect(briefed[0]).toContain('day 8')
    expect(briefed.some((text) => text.includes('day 1:'))).toBe(false)
  })
})
