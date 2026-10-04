import { describe, expect, it } from 'vitest'

import type { PublicRecoveredMission } from '../../shared/ipc.js'
import { heldDigests, mergeHistory } from './historyMerge.js'

/**
 * AN UNCHANGED HISTORY IS NOT SENT AGAIN, AND WHAT IS HELD IS NOT REBUILT.
 *
 * Batch C: every run end sent the newest twenty missions whole -- 2.69 MB a
 * read on Colin's ledger -- and the window swapped every object for a new
 * one, so the earlier turns memoised on their events were built again. The
 * host now keeps a record back when the window holds it (see
 * mission-history's `missionDigest`); these are the window's half.
 */
const event = { type: 'run.started' } as unknown as PublicRecoveredMission['events'][number]

const mission = (missionId: string, extra: Partial<PublicRecoveredMission> = {}): PublicRecoveredMission =>
  ({ missionId, runId: `run_${missionId}`, events: [event], eventCount: 1, eventsTruncated: false, ...extra }) as PublicRecoveredMission

describe('what the window says it holds', () => {
  it('is each whole record by the digest it came with', () => {
    expect(heldDigests([mission('a', { digest: 'd1' }), mission('b', { digest: 'd2' })])).toEqual({ a: 'd1', b: 'd2' })
  })

  it('leaves out a row without events, a record that came without a digest, and says nothing when nothing is held', () => {
    expect(heldDigests([mission('a', { digest: 'd1', events: [] }), mission('b')])).toBeUndefined()
    expect(heldDigests([])).toBeUndefined()
  })
})

describe('a read the host kept records back from', () => {
  it('keeps the very objects the window holds for them, and takes the rest as sent', () => {
    const heldA = mission('a', { digest: 'd1' })
    const heldB = mission('b', { digest: 'd2' })
    const changedB = mission('b', { digest: 'd3', prompt: 'new' })
    const merged = mergeHistory([heldA, heldB], [mission('a', { digest: 'd1', events: [], eventsKept: true }), changedB])
    expect(merged[0]).toBe(heldA)
    expect(merged[1]).toBe(changedB)
  })

  it('makes a kept record it no longer holds an ordinary row, which the next read will send whole', () => {
    const merged = mergeHistory([mission('a', { digest: 'old' })], [mission('a', { digest: 'd1', events: [], eventsKept: true })])
    expect(merged[0]?.events).toEqual([])
    expect(merged[0]?.eventsKept).toBeUndefined()
    expect(merged[0]?.digest).toBeUndefined()
    expect(heldDigests(merged)).toBeUndefined()
  })

  it('follows the order of the read, not of what was held', () => {
    const heldA = mission('a', { digest: 'd1' })
    const heldB = mission('b', { digest: 'd2' })
    const merged = mergeHistory(
      [heldA, heldB],
      [mission('b', { digest: 'd2', events: [], eventsKept: true }), mission('a', { digest: 'd1', events: [], eventsKept: true })]
    )
    expect(merged).toEqual([heldB, heldA])
  })
})
