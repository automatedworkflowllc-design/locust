import { describe, expect, it } from 'vitest'

import { createPeerExchange } from './peer-exchange.js'
import type { ConversationHint, MemoryBriefing } from './peer-exchange.js'
import type { MissionPeerContext } from './workroom-briefing.js'
import { composeSoloPrompt } from './workroom-briefing.js'
import { MEMORY_HEADING, MEMORY_RULES } from '../shared/memory.js'

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
    const runtimes: (string | undefined)[] = []
    const memory: MemoryBriefing = {
      async section(peer, conversation, _prompt, runtime) {
        asked.push(peer)
        seen.push(conversation)
        runtimes.push(runtime)
        return 'What is remembered for the folder "locust": the secret word is PELICAN.'
      }
    }
    const exchange = createPeerExchange({ workroom, ledger, memory })

    const briefed = (await exchange.briefSolo('What is the secret word?', 'opencode', { previousMissionId: 'mission_prev' })).runtimePrompt

    // The memory slot is asked, and told there is no teammate rather than
    // being handed a made-up one.
    expect(asked).toEqual([undefined])
    expect(seen).toEqual([{ previousMissionId: 'mission_prev' }])
    // And which runtime is asking, so LOCUST.md's sections for others stay out (A4.2).
    expect(runtimes).toEqual(['opencode'])
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

    const briefed = (await exchange.briefSolo('Read the README.', 'opencode')).runtimePrompt

    // A briefing that cannot be read is never a refusal to run.
    expect(briefed).toContain('Read the README.')
    expect(briefed).not.toContain('PELICAN')
  })

  it('keeps the person\'s words when the briefing would not fit', () => {
    // The question is never what gives way, and it stays last.
    const huge = 'x'.repeat(13_000)
    const composed = composeSoloPrompt({ prompt: 'Two plus two?', memory: huge, keepATodoList: false }).prompt
    expect(composed.endsWith('Two plus two?')).toBe(true)
  })

  it('sheds the team memory first when it would not fit, and keeps LOCUST.md and the formats', () => {
    /*
     * A5.3 (the code review's reported #11): over the cap this dropped the
     * WHOLE brief -- LOCUST.md with it, so a folder with long instructions
     * never had them read by a run that belonged to nobody.
     */
    const project = 'The folder "shop" has a LOCUST.md: always run pnpm check before you finish.'
    const listing = `${MEMORY_HEADING} What is remembered for the folder "shop" and everywhere:\n${'- a long remembered note\n'.repeat(600)}`
    const rules = `${MEMORY_RULES} each with when it was written. Use them as notes.`
    const composed = composeSoloPrompt({ prompt: 'Fix the test.', memory: [project, listing, rules].join('\n\n'), keepATodoList: false })
    expect(composed.prompt).toContain('always run pnpm check before you finish')
    expect(composed.prompt).not.toContain(MEMORY_HEADING)
    expect(composed.prompt).not.toContain(MEMORY_RULES)
    expect(composed.prompt).toContain('<locust-ask>')
    expect(composed.prompt.endsWith('Fix the test.')).toBe(true)
    expect(composed.prompt.length).toBeLessThan(12_000)
  })
})
