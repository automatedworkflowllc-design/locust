import { describe, expect, it } from 'vitest'

import type { LocalRuntimeId, PublicRuntimeStatus } from '../../shared/ipc.js'
import { runtimeReach, teammateStatusView } from './status.js'

/**
 * A TEAMMATE IS NOT STUCK WHILE ITS AGENTS ARE STILL BEING FOUND (0.563).
 *
 * Found by drive-pet-looks.mjs on the way to pets: for the first seconds of
 * every launch, before the window's first answer about which AI agents are on
 * this machine, the runtime list is empty -- and "none of an empty list is
 * usable" made every teammate BLOCKED. A screen showed red crosses for eyes,
 * and a pet slumped in its failure, at every launch, for nothing. Not known
 * is not blocked.
 */

const runtime = (id: LocalRuntimeId, usable: boolean, installed = usable): PublicRuntimeStatus => ({
  id,
  displayName: id,
  installed,
  version: installed ? '1.0.0' : null,
  auth: usable ? 'authenticated' : 'unknown',
  ready: usable,
  status: usable ? 'ready' : installed ? 'auth-required' : 'not-installed'
})

const view = (reach: ReturnType<typeof runtimeReach>) =>
  teammateStatusView({ runtime: undefined, ...reach, hasRunningMission: false, pendingApprovals: 0, roleLabel: 'Docs & QA' })

describe('a teammate before the agents on this machine are known', () => {
  it('is idle, not blocked, while discovery has not answered', () => {
    expect(runtimeReach([], false)).toEqual({})
    expect(view(runtimeReach([], false)).activity).toBe('idle')
    expect(view(runtimeReach([], false)).status).not.toBe('blocked')
  })

  it('is blocked once discovery says nothing can run -- and says why', () => {
    const none = view(runtimeReach([runtime('opencode', false), runtime('claude', false)], true))
    expect(none.activity).toBe('blocked')
    expect(none.label).toBe('No AI agent installed')
    const unsigned = view(runtimeReach([runtime('opencode', false, true)], true))
    expect(unsigned.activity).toBe('blocked')
    expect(unsigned.label).toBe('Sign-in needed')
  })

  it('is idle once one agent can run', () => {
    expect(view(runtimeReach([runtime('opencode', true), runtime('claude', false)], true)).activity).toBe('idle')
  })
})
