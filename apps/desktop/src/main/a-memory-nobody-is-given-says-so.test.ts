import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { UNUSED_AFTER_DAYS, briefedMemories, daysUnused, memorySection } from '../shared/memory.js'
import type { MemoryLine } from '../shared/memory.js'
import { memoryFileText } from './memory-file.js'
import { createMemoryStore } from './memory-store.js'

/*
 * A MEMORY NO TEAMMATE IS GIVEN SAYS SO (A1.4).
 *
 * The brief pastes a few memories; the rest sit in the file. One that has
 * gone a month without being in anyone's brief -- and without being written
 * -- is marked, for the person and for a tidy pass. Never deleted for it.
 */

const DAY = 24 * 60 * 60 * 1000
let root: string | undefined
let clock = Date.parse('2026-09-24T12:00:00.000Z')
afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
  clock = Date.parse('2026-09-24T12:00:00.000Z')
})
async function store() {
  root = await mkdtemp(join(tmpdir(), 'locust-briefed-'))
  let ids = 0
  return createMemoryStore({ rootDirectory: root, now: () => new Date(clock), createId: () => `id${String(++ids)}` })
}
const SHOP = { workspaceId: 'ws_shop', workspaceName: 'shop' }
const YOU = { name: 'you' }

describe('noting what a teammate was given', () => {
  it('records it, and when counting began; at most once a day, so a day of runs is one write', async () => {
    const memories = await store()
    const { memory } = await memories.add({ text: 'Deploys go out on Thursdays.', scope: 'workspace', ...SHOP, by: YOU, status: 'kept' })
    expect(await memories.briefTrackingSince()).toBeUndefined()

    await memories.noteBriefed([memory.memoryId])
    expect(await memories.briefTrackingSince()).toBe(new Date(clock).toISOString())
    expect((await memories.list())[0]?.lastBriefedAt).toBe(new Date(clock).toISOString())

    const written = await readFile(join(root!, 'memories.json'), 'utf8')
    clock += 3 * 60 * 60 * 1000
    await memories.noteBriefed([memory.memoryId])
    expect(await readFile(join(root!, 'memories.json'), 'utf8')).toBe(written)

    clock += DAY
    await memories.noteBriefed([memory.memoryId])
    expect((await memories.list())[0]?.lastBriefedAt).toBe(new Date(clock).toISOString())
  })

  it('a proposal, or an id it does not keep, is not noted', async () => {
    const memories = await store()
    const { memory } = await memories.add({ text: 'Only proposed.', scope: 'workspace', ...SHOP, by: YOU, status: 'proposed' })
    await memories.noteBriefed([memory.memoryId, 'mem_nothing'])
    expect((await memories.list())[0]?.lastBriefedAt).toBeUndefined()
  })
})

describe('a month without being given to anyone', () => {
  const now = new Date('2026-09-24T12:00:00.000Z')
  const ago = (days: number): string => new Date(now.getTime() - days * DAY).toISOString()

  it(`is counted from the last brief, the last write, or when counting began -- whichever is latest -- past ${String(UNUSED_AFTER_DAYS)} days`, () => {
    expect(daysUnused({ createdAt: ago(90) }, ago(40), now)).toBe(40)
    expect(daysUnused({ createdAt: ago(90), lastBriefedAt: ago(45) }, ago(60), now)).toBe(45)
    expect(daysUnused({ createdAt: ago(90), lastBriefedAt: ago(10) }, ago(60), now)).toBeUndefined()
    expect(daysUnused({ createdAt: ago(90), updatedAt: ago(5) }, ago(60), now)).toBeUndefined()
    // The first month after counting began marks nothing it could not have seen.
    expect(daysUnused({ createdAt: ago(90) }, ago(10), now)).toBeUndefined()
    expect(daysUnused({ createdAt: ago(90) }, undefined, now)).toBeUndefined()
  })

  it('says so in the file every teammate reads, so a tidy pass can see it', () => {
    expect(memoryFileText([{ id: 'mem_x', text: 'Old note.', scope: 'workspace', by: 'you', where: undefined, at: ago(90), unusedDays: 40 }], now)).toContain(
      '-- not given to a teammate in 40 days) [mem_x]'
    )
  })
})

describe('what is noted is what the brief pastes', () => {
  it('the same choice, made by the same function', () => {
    const lines: MemoryLine[] = Array.from({ length: 12 }, (_, index) => ({
      id: `mem_${String(index)}`,
      text: `Note number ${String(index)} about the build.`,
      scope: 'workspace',
      by: 'you',
      where: undefined,
      at: '2026-09-20T12:00:00.000Z'
    }))
    const input = { memories: lines, file: '.locust/memory.md', workspaceName: 'shop', askFirst: false }
    const given = briefedMemories(input)
    const section = memorySection(input)
    expect(given.length).toBeGreaterThan(0)
    expect(given.length).toBeLessThan(lines.length)
    for (const line of lines) expect(section.includes(line.text)).toBe(given.includes(line))
  })
})
