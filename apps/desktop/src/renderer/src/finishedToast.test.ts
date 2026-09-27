import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'
import { describe, expect, it } from 'vitest'

import { finishedToast, lastSaid } from './finishedToast.js'
import type { EndedRun } from './finishedToast.js'

const said = (text: string, final = true): NormalizedRuntimeEvent =>
  ({ type: 'message.delta', payload: { itemId: 'm', operation: final ? 'replace' : 'append', text, final } }) as unknown as NormalizedRuntimeEvent

const START = '2026-09-26T12:00:00.000Z'
const run = (over: Partial<EndedRun> = {}): EndedRun => ({
  phase: 'completed',
  startedAtIso: START,
  endedAtMs: Date.parse(START) + 4 * 60_000,
  startedBy: undefined,
  restored: false,
  teammateName: 'Wren',
  events: [said('Moved the port to 3001.\nAll 12 tests pass.')],
  error: undefined,
  ...over
})

describe('"Wren finished" -- when a finish is worth hearing about', () => {
  it('says who finished, the first line of what they said, and how long it took', () => {
    expect(finishedToast(run())).toEqual({ title: 'Wren finished', body: 'Moved the port to 3001. · took 4 min' })
  })

  it('stays quiet for a reply the person was very likely watching arrive', () => {
    expect(finishedToast(run({ endedAtMs: Date.parse(START) + 40_000 }))).toBeUndefined()
  })

  it('stays quiet for a stop the person pressed, and for anything not theirs or not new', () => {
    expect(finishedToast(run({ phase: 'cancelled' }))).toBeUndefined()
    expect(finishedToast(run({ phase: 'interrupted' }))).toBeUndefined()
    // A room member: the room gathers its own toasts.
    expect(finishedToast(run({ startedBy: { kind: 'room', roomId: 'r', postId: 'p' } }))).toBeUndefined()
    expect(finishedToast(run({ startedBy: { kind: 'relay' } }))).toBeUndefined()
    expect(finishedToast(run({ restored: true }))).toBeUndefined()
    expect(finishedToast(run({ startedAtIso: undefined }))).toBeUndefined()
  })

  it('says a failed run stopped, and why, in its own first line', () => {
    expect(finishedToast(run({ phase: 'failed', error: 'Copilot CLI is not signed in.\nRun copilot login.' })))
      .toEqual({ title: 'Wren stopped', body: 'Copilot CLI is not signed in. · after 4 min' })
  })

  it('reads the last thing said IN FULL, never a fragment still being written', () => {
    expect(lastSaid([said('Checking.'), said('half a sent', false)])).toBe('Checking.')
    expect(lastSaid([])).toBeUndefined()
    expect(finishedToast(run({ events: [] }))?.body).toBe('Done. · took 4 min')
  })

  it('bounds a long line, and says hours when it ran that long', () => {
    const long = 'x'.repeat(400)
    expect(lastSaid([said(long)])!.length).toBe(140)
    expect(finishedToast(run({ endedAtMs: Date.parse(START) + 125 * 60_000 }))?.body).toContain('took 2 h 5 min')
  })
})
