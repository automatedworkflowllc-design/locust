import { describe, expect, it } from 'vitest'

import { MAX_CHAIN_HOPS, createConversationChain, groupBriefFor } from './conversation-chain.js'
import { groupSection } from './workspace-brief.js'

/**
 * A group's standing instructions reach a turn through the host, which knows
 * only the turn before it. This is the walk from there to the root, and the
 * lookup that turns a chain into a brief.
 */

const reader = (parents: Record<string, string | undefined>, log: string[] = []) => ({
  async getMission(missionId: string) {
    log.push(missionId)
    if (!(missionId in parents)) return undefined
    const parent = parents[missionId]
    return { metadata: { missionId, ...(parent === undefined ? {} : { continuesFrom: { missionId: parent } }) } }
  }
})

describe('walking a conversation back to its root', () => {
  it('lists every id from the previous turn to the root, newest first', async () => {
    const chain = createConversationChain(reader({ m3: 'm2', m2: 'm1', m1: undefined }))
    expect(await chain.keysBefore('m3')).toEqual(['m3', 'm2', 'm1'])
    expect(await chain.keysBefore(undefined)).toEqual([])
  })

  it('reads each turn once for the life of the process', async () => {
    const log: string[] = []
    const chain = createConversationChain(reader({ m3: 'm2', m2: 'm1', m1: undefined }, log))
    await chain.keysBefore('m3')
    await chain.keysBefore('m3')
    await chain.keysBefore('m2')
    expect(log).toEqual(['m3', 'm2', 'm1'])
  })

  it('stops where a turn is gone, and where a read fails, without guessing', async () => {
    const gone = createConversationChain(reader({ m3: 'm2' }))
    expect(await gone.keysBefore('m3')).toEqual(['m3', 'm2'])
    const failing = createConversationChain({
      async getMission() {
        throw new Error('EBUSY')
      }
    })
    expect(await failing.keysBefore('m3')).toEqual(['m3'])
  })

  it('does not loop on a cycle, and does not walk forever', async () => {
    const cycle = createConversationChain(reader({ a: 'b', b: 'a' }))
    expect(await cycle.keysBefore('a')).toEqual(['a', 'b'])
    const parents: Record<string, string> = {}
    for (let i = 0; i < 200; i += 1) parents[`m${String(i)}`] = `m${String(i + 1)}`
    const deep = createConversationChain(reader(parents))
    expect((await deep.keysBefore('m0')).length).toBe(MAX_CHAIN_HOPS)
  })
})

describe('the group a conversation is briefed by', () => {
  const trading = { groupId: 'g1', name: 'Trading', createdAt: '2026-09-16T00:00:00.000Z', instructions: 'Quote sizes in shares.' }
  const plain = { groupId: 'g2', name: 'Plain', createdAt: '2026-09-16T00:00:00.000Z', instructions: '   ' }

  it('finds the membership on any id the conversation has worn, root included', () => {
    const listed = { groups: [trading], members: { m1: { groupId: 'g1', at: '2026-09-16T01:00:00.000Z' } } }
    expect(groupBriefFor(['m3', 'm2', 'm1'], listed)).toEqual({ name: 'Trading', instructions: 'Quote sizes in shares.' })
    expect(groupBriefFor(['m3', 'm2'], listed)).toBeUndefined()
  })

  it('briefs nothing for a group with no instructions -- it is a folder', () => {
    const listed = { groups: [plain], members: { m1: { groupId: 'g2' } } }
    expect(groupBriefFor(['m1'], listed)).toBeUndefined()
  })

  it('is one short section: the group named, then its words', () => {
    const section = groupSection('Trading', 'Quote sizes in shares.')
    expect(section).toContain('"Trading"')
    expect(section.endsWith('Quote sizes in shares.')).toBe(true)
    // Budget: the trailer is measured in characters and a peer message can
    // be pushed out by forty. The preamble is one sentence.
    expect(section.length - 'Quote sizes in shares.'.length).toBeLessThan(140)
  })
})
