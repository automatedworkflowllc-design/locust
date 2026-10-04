import type { RuntimeDiscovery } from '@teammate/runtime-adapters'
import { describe, expect, it, vi } from 'vitest'

import { createStartReadiness } from './start-readiness.js'

/**
 * A START ASKS ONLY ITS OWN RUNTIME.
 *
 * Past five minutes, starting a run swept EVERY runtime and waited for the
 * slowest -- 3-6 s before the first message after a break (main-process
 * audit, 2026-09-22). The start needs one answer.
 */
const TTL = 5 * 60_000

const runtime = (id: string, readiness: RuntimeDiscovery['readiness'] = 'ready'): RuntimeDiscovery =>
  ({
    id,
    kind: 'agent-runtime',
    displayName: id,
    optional: false,
    availability: 'available',
    readiness,
    executable: { commandName: id, discoveredPath: id, executablePath: id, prefixArgs: [], kind: 'native' },
    supportedFeatures: [],
    requiredFeatures: [],
    diagnostics: []
  }) as unknown as RuntimeDiscovery

function harness(clock: { t: number }) {
  let held: { at: number; value: readonly RuntimeDiscovery[] } | undefined = {
    at: 0,
    value: [runtime('claude'), runtime('codex'), runtime('opencode')]
  }
  const sweep = vi.fn(async () => held!.value)
  const askOne = vi.fn(async (id: string) => runtime(id))
  const readiness = createStartReadiness({
    ttlMs: TTL,
    now: () => clock.t,
    held: () => held,
    store: (value) => {
      held = { at: held?.at ?? 0, value }
    },
    sweep,
    askOne,
    sweepOnly: new Set(['antigravity'])
  })
  readiness.swept(held.value, 0)
  return { readiness, sweep, askOne, setHeld: (value: readonly RuntimeDiscovery[]) => { held = { at: 0, value } } }
}

describe('a start asks only its own runtime', () => {
  it('asks nothing while the last answer is fresh', async () => {
    const clock = { t: 60_000 }
    const { readiness, sweep, askOne } = harness(clock)
    await readiness.forStart('claude')
    expect(sweep).not.toHaveBeenCalled()
    expect(askOne).not.toHaveBeenCalled()
  })

  it('asks the starting runtime ALONE once the answer is stale', async () => {
    const clock = { t: TTL + 1 }
    const { readiness, sweep, askOne } = harness(clock)
    await readiness.forStart('claude')
    expect(askOne).toHaveBeenCalledTimes(1)
    expect(askOne).toHaveBeenCalledWith('claude')
    expect(sweep).not.toHaveBeenCalled()
    // And that answer is fresh now: the next start on it asks nothing.
    await readiness.forStart('claude')
    expect(askOne).toHaveBeenCalledTimes(1)
    // A DIFFERENT runtime is still stale -- asking one did not vouch for all.
    await readiness.forStart('codex')
    expect(askOne).toHaveBeenLastCalledWith('codex')
  })

  it('still sweeps for a runtime that was not ready, and for Antigravity', async () => {
    // The controls. A runtime that was signed out needs the full path (the
    // screens learn from it too), and Antigravity is not a CLI to ask alone.
    const clock = { t: TTL + 1 }
    const { readiness, sweep, askOne, setHeld } = harness(clock)
    setHeld([runtime('claude', 'authentication-required'), runtime('antigravity')])
    await readiness.forStart('claude')
    await readiness.forStart('antigravity')
    expect(sweep).toHaveBeenCalledTimes(2)
    expect(askOne).not.toHaveBeenCalled()
  })

  it('falls back to the full sweep when asking alone fails', async () => {
    const clock = { t: TTL + 1 }
    const { readiness, sweep, askOne } = harness(clock)
    askOne.mockRejectedValueOnce(new Error('probe blew up'))
    await readiness.forStart('opencode')
    expect(sweep).toHaveBeenCalledTimes(1)
  })
})
