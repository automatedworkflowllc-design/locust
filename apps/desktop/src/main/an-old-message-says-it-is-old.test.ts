import type { MissionLedger, Workroom, WorkroomMessage } from '@teammate/mission-store'
import { describe, expect, it } from 'vitest'

import { createPeerExchange } from './peer-exchange.js'
import { composeRuntimePrompt, messageAge } from './workroom-briefing.js'
import type { MissionPeerContext } from './workroom-briefing.js'

/**
 * A2.7: A MESSAGE THAT WAITED SAYS SO.
 *
 * A teammate's message can wait hours -- `when="later"`, a held reply, a
 * teammate nobody ran -- and was quoted with its timestamp alone, which a
 * model cannot turn into an age without knowing the time.
 */
const PEER: MissionPeerContext = {
  self: { teammateId: 'tm_wren', name: 'Wren', role: 'Code & Migrations' },
  others: [{ teammateId: 'tm_atlas', name: 'Atlas', role: 'Research & Briefs' }]
}
const POSTED = '2026-09-24T09:00:00.000Z'
const waiting: WorkroomMessage = {
  messageId: 'wm_1',
  sequence: 1,
  from: { teammateId: 'tm_atlas', name: 'Atlas', missionId: 'mission_a' },
  to: { teammateId: 'tm_wren', name: 'Wren' },
  text: 'The tests pass on main.',
  postedAt: POSTED
}
const at = (minutes: number): Date => new Date(Date.parse(POSTED) + minutes * 60_000)

describe('how old a waiting message is', () => {
  it('is said once it is half an hour old, in the unit that reads', () => {
    expect(messageAge(POSTED, at(10))).toBeUndefined()
    expect(messageAge(POSTED, at(45))).toBe('45 minutes ago')
    expect(messageAge(POSTED, at(60))).toBe('an hour ago')
    expect(messageAge(POSTED, at(180))).toBe('3 hours ago')
    expect(messageAge(POSTED, at(26 * 60))).toBe('a day ago')
    expect(messageAge(POSTED, at(3 * 24 * 60))).toBe('3 days ago')
    // A clock that moved backwards says nothing rather than something false.
    expect(messageAge(POSTED, at(-90))).toBeUndefined()
  })

  it('goes beside the message it describes, with what to do about it', () => {
    const late = composeRuntimePrompt({ prompt: 'Go on.', peer: PEER, inbound: [waiting], remaining: 0, now: at(180) })
    expect(late.prompt).toContain(`- Atlas (Research & Briefs), ${POSTED} (sent 3 hours ago: check it still holds before acting on it):\n  The tests pass on main.`)
    const fresh = composeRuntimePrompt({ prompt: 'Go on.', peer: PEER, inbound: [waiting], remaining: 0, now: at(5) })
    expect(fresh.prompt).toContain(`- Atlas (Research & Briefs), ${POSTED}:\n  The tests pass on main.`)
  })

  it('is read against the time now when the host prepares a run', async () => {
    const workroom = {
      unread: async () => ({ messages: [waiting], remaining: 0 })
    } as unknown as Workroom
    const exchange = createPeerExchange({ workroom, ledger: {} as MissionLedger })
    const prepared = await exchange.prepare('Go on.', PEER, 'claude')
    expect(prepared.runtimePrompt).toMatch(/\(sent (?:\d+ (?:minutes|hours|days) ago|an hour ago|a day ago): check it still holds before acting on it\)/)
  })
})
