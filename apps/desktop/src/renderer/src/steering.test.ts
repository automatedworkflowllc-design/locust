import { describe, expect, it } from 'vitest'

import { queuedVerdict } from './steering.js'

describe('a message queued while a teammate works', () => {
  it('waits while the run is still going', () => {
    expect(queuedVerdict({ running: true, phase: 'running', onScreen: true })).toEqual({ kind: 'waiting' })
  })

  it('goes as the next turn once that run completed', () => {
    expect(queuedVerdict({ running: false, phase: 'completed', onScreen: true })).toEqual({ kind: 'send' })
  })

  it('is HELD when the run did not complete, and says which way it ended', () => {
    // The next instruction assumes the last turn happened. Sending it after a
    // failure builds on work that never ran -- the same rule a routine's
    // steps follow.
    expect(queuedVerdict({ running: false, phase: 'failed', onScreen: true })).toEqual({
      kind: 'held',
      note: 'not sent: that run failed'
    })
    expect(queuedVerdict({ running: false, phase: 'cancelled', onScreen: true })).toEqual({
      kind: 'held',
      note: 'not sent: that run was stopped'
    })
    expect(queuedVerdict({ running: false, phase: 'interrupted', onScreen: true })).toEqual({
      kind: 'held',
      note: 'not sent: that run did not finish'
    })
  })

  it('is held when the person has moved to another conversation', () => {
    // Sending would put it into whatever is on screen now, which is not what
    // they were replying to.
    expect(queuedVerdict({ running: false, phase: 'completed', onScreen: false })).toEqual({
      kind: 'held',
      note: 'waiting: open that conversation to send it'
    })
  })

  it('is held rather than sent when the run it belonged to is gone', () => {
    expect(queuedVerdict({ running: false, phase: undefined, onScreen: true })).toEqual({
      kind: 'held',
      note: 'waiting: that conversation is no longer open'
    })
  })

  it('never sends on anything but a completed run that is on screen', () => {
    const sends: boolean[] = []
    for (const running of [true, false]) {
      for (const phase of [undefined, 'starting', 'running', 'completed', 'failed', 'cancelled', 'interrupted']) {
        for (const onScreen of [true, false]) {
          sends.push(queuedVerdict({ running, phase, onScreen }).kind === 'send')
        }
      }
    }
    expect(sends.filter(Boolean)).toHaveLength(1)
  })
})
