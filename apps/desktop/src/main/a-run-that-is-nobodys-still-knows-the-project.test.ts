import { describe, expect, it } from 'vitest'

import { createPeerExchange } from './peer-exchange.js'
import type { ConversationHint, MemoryBriefing } from './peer-exchange.js'
import type { MissionPeerContext } from './workroom-briefing.js'
import { composeSoloPrompt } from './workroom-briefing.js'

/**
 * A run started from Home with nobody picked.
 *
 * The empty list invites one -- "Pick a teammate, or write below and assign
 * it to one later" -- and until 0.191.0 that run was briefed with nothing at
 * all: the whole briefing hung on a peer context and there is no peer. Grok
 * watched it and ranked it second (pass 14): eleven memories on the Memory
 * screen, the secret word answered NONE, no `.locust/memory.md` anywhere,
 * and the same question answered correctly the moment a teammate was picked.
 *
 * The folder and the memory are the PROJECT's, not a teammate's, so they go.
 * The role, the roster and the share block need somebody to be and somebody
 * to write to, so they do not.
 */

type Options = Parameters<typeof createPeerExchange>[0]
const workroom = {
  unread: async () => {
    throw new Error('a run that is nobody\'s has no inbox to read')
  },
  markDelivered: async () => undefined,
  post: async () => {
    throw new Error('not posted in this test')
  }
} as unknown as Options['workroom']
const ledger = {} as unknown as Options['ledger']

describe('a run that belongs to nobody', () => {
  it('is briefed with the folder and the project memory, and with no roster', async () => {
    const asked: (MissionPeerContext | undefined)[] = []
    const seen: (ConversationHint | undefined)[] = []
    const memory: MemoryBriefing = {
      async section(peer, conversation) {
        asked.push(peer)
        seen.push(conversation)
        return 'What is remembered for the folder "locust": the secret word is PELICAN.'
      }
    }
    const exchange = createPeerExchange({ workroom, ledger, memory })

    const briefed = await exchange.briefSolo('What is the secret word?', 'opencode', { previousMissionId: 'mission_prev' })

    // The memory slot is asked, and told there is no teammate rather than
    // being handed a made-up one.
    expect(asked).toEqual([undefined])
    expect(seen).toEqual([{ previousMissionId: 'mission_prev' }])
    expect(briefed).toContain('the secret word is PELICAN')
    // The person's words are last, where every other briefing puts them.
    expect(briefed.endsWith('What is the secret word?')).toBe(true)
    // And nothing that needs a teammate.
    expect(briefed).not.toContain('Teammates in this workspace besides you')
    expect(briefed).not.toContain('locust-share')
  })

  it('runs on the person\'s words alone when there is no memory to read', async () => {
    const memory: MemoryBriefing = {
      async section() {
        throw new Error('groups.json is a directory')
      }
    }
    const exchange = createPeerExchange({ workroom, ledger, memory })

    const briefed = await exchange.briefSolo('Read the README.', 'opencode')

    // A briefing that cannot be read is never a refusal to run.
    expect(briefed).toContain('Read the README.')
    expect(briefed).not.toContain('PELICAN')
  })

  it('keeps the person\'s words when the briefing would not fit', () => {
    // Nothing here can be shed -- no inbound messages to drop -- so an
    // over-long briefing loses the briefing, never the question.
    const huge = 'x'.repeat(13_000)
    expect(composeSoloPrompt({ prompt: 'Two plus two?', memory: huge, keepATodoList: false })).toBe('Two plus two?')
  })
})
