import { describe, expect, it } from 'vitest'

import { combineQueued, retriedAfterBusy } from './steering.js'
import type { QueuedRow } from './steering.js'

/**
 * A QUEUED MESSAGE THE HOST REFUSES AS BUSY WAITS; IT IS NOT DROPPED.
 *
 * drive-long-conversation on the packaged 0.297 (2026-09-23): turn 5, queued
 * behind turn 4, went the moment the window saw turn 4 end, was refused by a
 * host still winding turn 4 down, and vanished -- the window was left on the
 * teammate's home screen. The host now takes that turn (see the main-side
 * test); whatever it still refuses goes back in line here.
 */
const row = (extra: Partial<QueuedRow> = {}): QueuedRow => ({ id: 'q_0_run_4', key: 'run_4', text: 'Create five.txt', origin: 'person', ...extra })

describe('a queued message refused as busy', () => {
  it('goes back pointed at the conversation it was typed in, not before its retry time', () => {
    const back = retriedAfterBusy(row(), 'run_4', 1_000)
    expect(back).toMatchObject({ key: 'run_4', text: 'Create five.txt', tries: 1, retryAt: 1_500 })
  })

  it('waits longer each time, and no longer than eight seconds', () => {
    let current = row()
    const waits: number[] = []
    for (let i = 0; i < 7; i += 1) {
      current = retriedAfterBusy(current, 'run_4', 0)
      waits.push(current.retryAt!)
    }
    expect(waits).toEqual([500, 1_000, 2_000, 4_000, 8_000, 8_000, 8_000])
  })

  it('keeps its retry time when the queue folds what was typed behind it into it', () => {
    const waiting = retriedAfterBusy(row(), 'run_4', 1_000)
    const [folded] = combineQueued([waiting, row({ id: 'q_1_run_4', text: 'And six.txt' })])
    expect(folded?.retryAt).toBe(1_500)
    expect(folded?.text).toContain('And six.txt')
  })
})
