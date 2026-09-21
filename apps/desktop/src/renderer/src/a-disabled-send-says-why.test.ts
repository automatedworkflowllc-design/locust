import { describe, expect, it } from 'vitest'

import { sendBlockedReason } from './status.js'

/**
 * Sol's beta review, 2026-09-21, finding 6: typed `hello` on a machine with
 * no coding agent installed. Send stayed grey and its title still read
 * *"Start mission — Shift+Enter for a new line"* — a disabled control
 * describing the one thing it would not do.
 *
 * The test that matters is the LAST one. On a fresh profile every clause is
 * true at once, and saying "write a message first" to a person who has
 * written a message and has nothing to run it on is the original first-run
 * wall with more words on it.
 */
const blocked = {
  nothingInstalled: false,
  runtimeReady: true,
  routeCanRun: true,
  busy: false,
  empty: false
}

describe('a disabled send says why', () => {
  it('says nothing when the button is live', () => {
    expect(sendBlockedReason(blocked)).toBeUndefined()
  })

  it('names the install when there is nothing to run on', () => {
    expect(sendBlockedReason({ ...blocked, nothingInstalled: true })).toContain('install a coding agent')
  })

  it('names an empty box only when that is the real reason', () => {
    expect(sendBlockedReason({ ...blocked, empty: true })).toBe('Write a message first.')
  })

  it('names the install first when everything is wrong at once', () => {
    // Sol's exact situation: a fresh machine, a typed message, no runtime.
    // Then the same with the box cleared — still the install, because that is
    // the thing typing cannot fix.
    expect(sendBlockedReason({ nothingInstalled: true, runtimeReady: false, routeCanRun: false, busy: true, empty: false }))
      .toContain('install a coding agent')
    expect(sendBlockedReason({ nothingInstalled: true, runtimeReady: false, routeCanRun: false, busy: true, empty: true }))
      .toContain('install a coding agent')
  })

  it('separates a route that is not ready from a mode that cannot run on it', () => {
    expect(sendBlockedReason({ ...blocked, runtimeReady: false })).toContain('not ready on this machine')
    expect(sendBlockedReason({ ...blocked, routeCanRun: false })).toContain('This mode cannot run')
  })
})
