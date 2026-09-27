import { describe, expect, it } from 'vitest'

import { createKeepAwake } from './keep-awake.js'

/** A power blocker that records what it was asked. */
function fakeBlocker(options: { readonly failsToStart?: boolean } = {}) {
  const calls: string[] = []
  let next = 7
  return {
    calls,
    blocker: {
      start: () => {
        calls.push('start')
        if (options.failsToStart === true) throw new Error('no')
        return next++
      },
      stop: (id: number) => {
        calls.push(`stop ${String(id)}`)
      }
    }
  }
}

describe('the computer stays awake while a teammate works', () => {
  it('holds when the first run goes live, once, and lets go when none is', () => {
    const { calls, blocker } = fakeBlocker()
    const awake = createKeepAwake(blocker)
    awake.update(0)
    expect(awake.holding).toBe(false)
    awake.update(1)
    awake.update(3)
    awake.update(2)
    expect(awake.holding).toBe(true)
    // One hold for however many runs: never a second one stacked on the first.
    expect(calls).toEqual(['start'])
    awake.update(0)
    expect(awake.holding).toBe(false)
    expect(calls).toEqual(['start', 'stop 7'])
    // And holds again for the next run.
    awake.update(1)
    expect(calls).toEqual(['start', 'stop 7', 'start'])
  })

  it('lets go for good when the app quits, whatever is running', () => {
    const { calls, blocker } = fakeBlocker()
    const awake = createKeepAwake(blocker)
    awake.update(2)
    awake.dispose()
    awake.update(2)
    expect(awake.holding).toBe(false)
    expect(calls).toEqual(['start', 'stop 7'])
  })

  it('a machine that will not be held is left as it is, and asked again on the next beat', () => {
    const { calls, blocker } = fakeBlocker({ failsToStart: true })
    const awake = createKeepAwake(blocker)
    expect(() => awake.update(1)).not.toThrow()
    expect(awake.holding).toBe(false)
    awake.update(1)
    expect(calls).toEqual(['start', 'start'])
  })
})
