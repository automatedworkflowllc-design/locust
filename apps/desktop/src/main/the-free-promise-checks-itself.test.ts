import { describe, expect, it } from 'vitest'

import type { PublicModel, PublicRuntimeStatus } from '../shared/ipc.js'
import { freeStartStillFree } from '../renderer/src/status.js'

/**
 * Colin, 2026-09-21, asking about Muse: *"i know its available on opencode
 * but idk how long that will continue for."*
 *
 * The thing that actually depends on that is not an integration, it is a
 * SENTENCE. `FirstLaunch` tells a brand-new person, unconditionally:
 *
 * > OpenCode needs no account — one install and you have a working teammate.
 *
 * The first half is about auth and is ours to know. The second half is a
 * claim about somebody else's price list, and nothing checked it. If OpenCode
 * stops publishing a free model, Locust would keep promising a free teammate
 * to the one person least able to tell it was wrong.
 *
 * The rule under test is the third state. `unknown` — not installed, or its
 * list never read — is the ORDINARY case at first launch, and it must leave
 * the promise alone. Only positive evidence changes the words.
 */

const runtime = (status: PublicRuntimeStatus['status']): PublicRuntimeStatus =>
  ({ id: 'opencode', status, installed: status !== 'not-installed', version: null } as PublicRuntimeStatus)

const model = (id: string, runtimeId = 'opencode'): PublicModel =>
  ({ id, runtime: runtimeId, displayName: id, description: '', supportedEfforts: [] } as unknown as PublicModel)

describe('the free promise checks itself', () => {
  it('stands when a free model is listed', () => {
    expect(
      freeStartStillFree([runtime('ready')], [model('opencode/muse-spark-1.3-contributor-free'), model('opencode/paid-thing')])
    ).toBe('yes')
  })

  it('is disproved only when the list was read and nothing in it is free', () => {
    expect(freeStartStillFree([runtime('ready')], [model('opencode/paid-thing')])).toBe('no')
  })

  it('says unknown when the runtime is not ready, and never weakens the promise', () => {
    for (const status of ['not-installed', 'auth-required', 'probe-failed', 'offline'] as const) {
      expect(freeStartStillFree([runtime(status)], [])).toBe('unknown')
    }
    // The common first-launch case: nothing installed at all.
    expect(freeStartStillFree([], [])).toBe('unknown')
  })

  it('says unknown when it is ready but no list has been read', () => {
    // A ready runtime whose models we never read tells us nothing about its
    // prices. Absence of evidence is not disproof.
    expect(freeStartStillFree([runtime('ready')], [])).toBe('unknown')
  })

  it('ignores other runtimes entirely, free or not', () => {
    // A free model belonging to somebody else cannot rescue the claim, and a
    // paid one belonging to somebody else cannot sink it.
    expect(freeStartStillFree([runtime('ready')], [model('cursor-thing-free', 'cursor')])).toBe('unknown')
    expect(
      freeStartStillFree([runtime('ready')], [model('opencode/free-one-free'), model('cursor-paid', 'cursor')])
    ).toBe('yes')
  })
})
