import { describe, expect, it } from 'vitest'

import type { PublicRuntimeStatus } from '../../shared/ipc.js'
import { staleChecking } from './status.js'
import APP from './App.tsx?raw'

/**
 * A LATE CHECK IS NEVER LOST (0.639).
 *
 * Since 0.634 the first screen waits for no agent past two seconds: a slow one
 * is shown as being checked, and the window asks again when the host says its
 * check finished. Measured on the packaged 0.638 (probe-picker-after-a-late-
 * check.mjs): OpenCode answered two seconds in, and its nine free models in
 * the open picker said CHECKING forty seconds later -- reopened or not -- while
 * the host's own list said ready. The finish crossed the window's list: it came
 * before the window held one, or the window's ask reached the host a tick
 * before the late answer was stored. The window now keeps every finished
 * check and reads the held answer again when a list still calls one of them
 * being checked.
 */
const entry = (id: PublicRuntimeStatus['id'], checking: boolean, status: PublicRuntimeStatus['status'] = checking ? 'probe-failed' : 'ready'): PublicRuntimeStatus => ({
  id,
  displayName: id,
  installed: true,
  version: null,
  auth: 'not-applicable',
  ready: status === 'ready',
  status,
  ...(checking ? { checking: true as const } : {})
})

describe('a late check is never lost', () => {
  it('names an agent still called "being checked" whose check has finished', () => {
    expect(staleChecking([entry('opencode', true), entry('codex', false)], new Set(['opencode']))).toEqual(['opencode'])
  })

  it('leaves alone one still being checked, and one already ready', () => {
    expect(staleChecking([entry('opencode', true)], new Set())).toEqual([])
    expect(staleChecking([entry('opencode', false)], new Set(['opencode']))).toEqual([])
  })

  it('is wired: every finish is kept, every answer is reconciled, and the re-read names no agent', () => {
    expect(APP).toMatch(/if \(event\.kind !== 'probe\.finished'\) return\s+finishedChecks\.add\(event\.id\)/)
    // The first answer and every re-ask's answer reconcile once `known` is set.
    expect(APP.match(/known = response\.data\.runtimes\n\s+unanswered = worthAskingAgain\(response\.data\.runtimes\)\n\s+readAgainIfStale\(\)/g)?.length ?? 0).toBeGreaterThanOrEqual(1)
    expect(APP).toMatch(/lastCheckedAt = response\.data\.checkedAt\n\s+known = response\.data\.runtimes\n\s+readAgainIfStale\(\)/)
    // A plain read of what the host holds: no names, so it starts no new check.
    expect(APP).toMatch(/function readHeld\(\): void \{[\s\S]{0,200}?\.getLocalRuntimes\(\)\n/)
    // Once per finish, so a new check of the same agent cannot loop it.
    expect(APP).toMatch(/for \(const id of stale\) finishedChecks\.delete\(id\)/)
  })
})
