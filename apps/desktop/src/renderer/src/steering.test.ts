import { describe, expect, it } from 'vitest'

import { queuedVerdict, requeuedTo } from './steering.js'

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
    // steps follow. Every held state names the REASON: a note that described
    // the button instead ("ready to send") was the one state a person could
    // not act on intelligently, and it is now unreachable.
    expect(queuedVerdict({ running: false, phase: 'failed', onScreen: true })).toEqual({
      kind: 'held',
      note: 'held — the run failed'
    })
    expect(queuedVerdict({ running: false, phase: 'cancelled', onScreen: true })).toEqual({
      kind: 'held',
      note: 'held — the run was stopped'
    })
    expect(queuedVerdict({ running: false, phase: 'interrupted', onScreen: true })).toEqual({
      kind: 'held',
      note: 'held — the run did not finish'
    })
  })

  it('is held when the person has moved to another conversation', () => {
    // Sending would put it into whatever is on screen now, which is not what
    // they were replying to.
    expect(queuedVerdict({ running: false, phase: 'completed', onScreen: false })).toEqual({
      kind: 'held',
      note: 'typed in another conversation — sending puts it here instead'
    })
  })

  it('is held rather than sent when the run it belonged to is gone', () => {
    expect(queuedVerdict({ running: false, phase: undefined, onScreen: true })).toEqual({
      kind: 'held',
      note: 'held — that conversation is no longer open'
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

describe('a queued message follows its conversation', () => {
  // A first outside tester, typing the next line quickly: NEXT went to
  // "held -- that conversation is no longer open" about the conversation on
  // screen. A mission is created under a temporary key and moved to the
  // host's real runId the moment the host answers; `shownKey` followed that
  // move and the queue did not.
  it('moves to the real runId when the run is re-keyed', () => {
    expect(requeuedTo({ key: 'start_1', text: 'and then deploy it' }, 'start_1', 'run_9')).toEqual({
      key: 'run_9',
      text: 'and then deploy it'
    })
  })

  it('leaves a message queued against another conversation alone', () => {
    const elsewhere = { key: 'run_other', text: 'and then deploy it' }
    expect(requeuedTo(elsewhere, 'start_1', 'run_9')).toBe(elsewhere)
  })

  it('has nothing to move when nothing is queued', () => {
    expect(requeuedTo(undefined, 'start_1', 'run_9')).toBeUndefined()
  })

  it('no longer reports the conversation as gone once it has followed', () => {
    const moved = requeuedTo({ key: 'start_1', text: 'and then deploy it' }, 'start_1', 'run_9')
    expect(queuedVerdict({ running: true, phase: 'running', onScreen: moved?.key === 'run_9' })).toEqual({
      kind: 'waiting'
    })
  })
})
