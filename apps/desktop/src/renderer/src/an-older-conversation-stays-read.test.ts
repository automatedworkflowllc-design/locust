import { describe, expect, it } from 'vitest'

import type { PublicRecoveredMission } from '../../shared/ipc.js'
import { mergeHistory, missingTranscripts } from './historyMerge.js'

/**
 * H3, the window's half: which turns of a conversation opening it reads, and
 * that a turn read whole stays whole across the next history read.
 * (The host's single read is in main/an-older-conversation-opens-whole.)
 */
describe('what opening a conversation reads', () => {
  const row = (missionId: string, eventCount: number): PublicRecoveredMission => ({ missionId, events: [], eventCount } as unknown as PublicRecoveredMission)
  const whole = (missionId: string, eventCount: number): PublicRecoveredMission => ({ missionId, events: [{}] as never, eventCount, digest: 'd' } as unknown as PublicRecoveredMission)

  it('is every turn that came as a row though the ledger has events for it', () => {
    const byId = new Map([
      ['m1', row('m1', 3)],
      ['m2', whole('m2', 3)],
      ['m3', row('m3', 0)]
    ])
    expect(missingTranscripts(['m1', 'm2', 'm3', 'm1', 'nope'], byId)).toEqual(['m1'])
  })

  it('stays read: a later history row for the same unchanged record keeps the whole one', () => {
    const held = [whole('m1', 3)]
    expect(mergeHistory(held, [row('m1', 3)])[0]).toBe(held[0])
    // A record that grew is taken as sent, to be read again.
    expect(mergeHistory(held, [row('m1', 5)])[0]?.events).toEqual([])
  })
})
