import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import type { ReconciledCheckpoint, WorkroomMessage } from '@teammate/mission-store'
import { describe, expect, it } from 'vitest'

import { withAttachments } from '../shared/attachments.js'
import { composeHandoffPrompt } from './handoff.js'
import { askedIn, createPeerExchange } from './peer-exchange.js'
import type { MemoryBriefing } from './peer-exchange.js'
import { relayPrompt } from './relay.js'
import type { MissionPeerContext } from './workroom-briefing.js'

/**
 * A TEAMMATE'S MEMORY IS CHOSEN BY WHAT WAS ASKED, not by the host's words
 * around it.
 *
 * The brief pastes the notes that share words with the prompt, and on
 * Colin's store (2026-09-26) eight of the nine relayed turns from Yurt pasted
 * the same six notes -- chosen by the relay's own rules about what a reply
 * costs, which are the same words every time. The line that names attached files was
 * searched the same way.
 */

const WREN = { teammateId: 'tm_wren', name: 'Wren', role: 'Code & Migrations' }
const YURT = { teammateId: 'tm_yurt', name: 'Yurt', role: 'Research & Briefs' }
const peer: MissionPeerContext = { self: WREN, others: [YURT] }

const message: WorkroomMessage = {
  messageId: 'msg_pelican',
  sequence: 4,
  from: { ...YURT, missionId: 'mission_yurt' },
  to: WREN,
  text: 'The pelican build fails on Windows; the log is in build.log.',
  postedAt: '2026-09-26T05:00:00.000Z'
}

function checkpoint(overrides: Partial<ReconciledCheckpoint> = {}): ReconciledCheckpoint {
  return {
    missionId: 'mission_prior',
    epoch: 2,
    reason: 'route-switch',
    resumeSafety: 'safe',
    safetyReason: 'settled',
    createdAt: '2026-09-26T03:00:00.000Z',
    unsettledActions: [{ toolKind: 'shell', name: 'npm run build' }],
    settledActions: ['read README.md'],
    settledNames: ['read README.md'],
    assistantSummary: 'I read the README and found two files to change.',
    ...overrides
  } as unknown as ReconciledCheckpoint
}

describe("the words a teammate's memory is chosen by", () => {
  it('for a relayed turn, are the message it answers -- not the relay brief', async () => {
    type Options = Parameters<typeof createPeerExchange>[0]
    const workroom = {
      unread: async () => ({ messages: [message], remaining: 0 }),
      markDelivered: async () => undefined
    } as unknown as Options['workroom']
    const searched: (string | undefined)[] = []
    const memory: MemoryBriefing = {
      async section(_peer, _conversation, prompt) {
        searched.push(prompt)
        return undefined
      }
    }
    const exchange = createPeerExchange({ workroom, ledger: {} as unknown as Options['ledger'], memory })
    const brief = relayPrompt({ sender: YURT, recipient: WREN, hop: 2, readByPerson: true })
    const prepared = await exchange.prepare(brief, peer, 'codex', { startedFor: ['msg_pelican'] })
    expect(searched).toEqual([message.text])
    // The message still reaches the run, quoted, as before.
    expect(prepared.delivered.map((delivered) => delivered.messageId)).toEqual(['msg_pelican'])
    expect(prepared.runtimePrompt).toContain('The pelican build fails on Windows')

    // A person's own turn is searched by what they typed, as it always was.
    await exchange.prepare('Why does the pelican build fail?', peer, 'codex')
    expect(searched[1]).toBe('Why does the pelican build fail?')
  })

  it('for a relayed turn whose message is gone, are nothing rather than the brief', () => {
    expect(askedIn(relayPrompt({ sender: YURT, recipient: WREN, hop: 2 }), [])).toBe('')
  })

  it('for a handoff, are the whole brief: the account of the work is about the work', () => {
    // Measured, and the opposite of the first try: reading only the person's
    // words out of a handoff found one of the six notes that bore on Colin's
    // handed-over orb test; the whole brief, with the previous agent's own
    // summary of what it did, found five.
    const briefing = composeHandoffPrompt(
      'Run the orb test.',
      checkpoint({ assistantSummary: 'Orb unit tests 39/39; Luna and Sonnet both passed.' }),
      'Cursor Agent',
      'Now the free route.',
      [{ asked: 'What broke?', answered: 'The linker.' }]
    )
    expect(briefing?.omitted).toEqual([])
    expect(askedIn(briefing!.prompt)).toBe(briefing!.prompt)
  })

  it('for a message with files, leave out the line that names them', () => {
    expect(askedIn(withAttachments('What changed in the pelican?', ['a.md', 'b.md']))).toBe('What changed in the pelican?')
    expect(askedIn('What changed in the pelican?')).toBe('What changed in the pelican?')
  })

  it('reach Antigravity too, whose relayed runs were not told what they answer', () => {
    const source = readFileSync(fileURLToPath(new URL('./antigravity-mission.ts', import.meta.url)), 'utf8')
    expect(source).toContain('startedFor: route.relay.answering')
  })
})
