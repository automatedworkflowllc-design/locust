import { describe, expect, it } from 'vitest'

import type { PublicRuntimeStatus } from '../../shared/ipc.js'
import { staleChecking } from './status.js'
import APP from './App.tsx?raw'

/**
 * A LATE CHECK IS NEVER LOST (0.639).
 *
 * Since 0.634 the first screen waits for no agent past two seconds: a slow one
 * is shown as being checked, and its answer is stored when it lands. On a busy
 * machine (packaged 0.638 and 0.639, the CPU loaded,
 * probe-picker-after-a-late-check.mjs) three slow agents answered late one
 * after another; each re-ask still found OpenCode being checked, and the
 * window spent its give-up budget on a check that was simply still running.
 * OpenCode answered twenty seconds in, the window had given up, and its nine
 * free models said CHECKING for good while the host's own list said ready.
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

  it('never spends the give-up budget on a check that is still running', () => {
    expect(APP).toMatch(/const stillChecking = response\.data\.runtimes\.some\(\n\s+\(entry\) => entry\.installed && entry\.checking !== true && \(entry\.status === 'probe-failed' \|\| entry\.status === 'offline'\)/)
  })

  it('reads the held answer back on a finish: no new check, and past giving up', () => {
    // A finish is kept and the held answer read -- not `askAgain`, which the
    // give-up budget stops, and which started a NEW check of the agent.
    expect(APP).toMatch(/if \(event\.kind !== 'probe\.finished'\) return[\s\S]{0,700}?finishedChecks\.add\(event\.id\)\n\s+readAgainIfStale\(\)/)
    expect(APP).not.toMatch(/entry\.checking === true && entry\.status !== 'ready'\)\) askAgain\(\)/)
    // The first answer and the held read reconcile once `known` is set; so does every re-ask's answer.
    expect(APP.match(/known = response\.data\.runtimes\n\s+unanswered = worthAskingAgain\(response\.data\.runtimes\)\n\s+readAgainIfStale\(\)/g)?.length ?? 0).toBe(2)
    expect(APP).toMatch(/lastCheckedAt = response\.data\.checkedAt\n\s+known = response\.data\.runtimes\n\s+readAgainIfStale\(\)/)
    // A plain read of what the host holds: no names, so it starts no new check.
    expect(APP).toMatch(/function readHeld\(\): void \{[\s\S]{0,200}?\.getLocalRuntimes\(\)\n/)
    // Once per finish, so a new check of the same agent cannot loop it.
    expect(APP).toMatch(/for \(const id of stale\) finishedChecks\.delete\(id\)/)
  })
})
