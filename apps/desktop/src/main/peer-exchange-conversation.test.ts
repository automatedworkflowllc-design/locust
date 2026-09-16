import { describe, expect, it } from 'vitest'

import { createPeerExchange } from './peer-exchange.js'
import type { ConversationHint, MemoryBriefing } from './peer-exchange.js'
import type { MissionPeerContext } from './workroom-briefing.js'

/**
 * The briefing slot is told which conversation a turn belongs to.
 *
 * `memoryBriefing.section` composes the folder's LOCUST.md, the worktree
 * note, the team's memory -- and, since 0.159.0, the group's standing
 * instructions. It could not see the conversation before this, which was
 * the whole remaining job of group instructions (NEXT-GROUP-INSTRUCTIONS.md).
 * The hint is the turn this one continues; the slot walks back from there.
 */

const WREN = { teammateId: 'tm_wren', name: 'Wren', role: 'Code & Migrations' }
const peer: MissionPeerContext = { self: WREN, others: [] }

type Options = Parameters<typeof createPeerExchange>[0]
const workroom = {
  unread: async () => ({ messages: [], remaining: 0 }),
  markDelivered: async () => undefined,
  post: async () => {
    throw new Error('not posted in this test')
  }
} as unknown as Options['workroom']
const ledger = {} as unknown as Options['ledger']

describe('what the briefing slot is told about the conversation', () => {
  it('passes the previous turn through to memory.section, and its words into the prompt', async () => {
    const seen: (ConversationHint | undefined)[] = []
    const memory: MemoryBriefing = {
      async section(_peer, conversation) {
        seen.push(conversation)
        return conversation?.previousMissionId === 'mission_prev' ? 'Standing instructions for the group "Trading"…' : undefined
      }
    }
    const exchange = createPeerExchange({ workroom, ledger, memory })
    const prepared = await exchange.prepare('Carry on.', peer, 'opencode', { previousMissionId: 'mission_prev' })
    expect(seen).toEqual([{ previousMissionId: 'mission_prev' }])
    expect(prepared.runtimePrompt).toContain('Standing instructions for the group "Trading"')

    // A first turn has no previous mission and says so, rather than inventing one.
    const first = await exchange.prepare('Start here.', peer, 'opencode')
    expect(seen[1]).toBeUndefined()
    expect(first.runtimePrompt).not.toContain('Standing instructions')
  })

  it('never refuses a run over a brief it could do without', async () => {
    const memory: MemoryBriefing = {
      async section() {
        throw new Error('groups.json is a directory')
      }
    }
    const exchange = createPeerExchange({ workroom, ledger, memory })
    const prepared = await exchange.prepare('Carry on.', peer, 'opencode', { previousMissionId: 'mission_prev' })
    expect(prepared.runtimePrompt).toContain('Carry on.')
    expect(prepared.failed).toBe(false)
  })
})
