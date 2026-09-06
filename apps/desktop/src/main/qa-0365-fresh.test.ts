import { describe, expect, it } from 'vitest'

import { createRuntimeDiscoveryService } from './runtime-discovery.js'
import type { RuntimeDiscovery } from '@teammate/runtime-adapters'

/**
 * "Signed in on this machine, using your own account" -- said to someone who
 * has never signed in to anything.
 *
 * From the independent QA pass on 0.36.5 (2026-09-06), reproduced live:
 * `opencode auth list` reports ZERO credentials on the machine every drive in
 * this repo runs on, and the Settings row for OpenCode still reads
 * "account-default · Signed in on this machine, using your own account.
 * READY".
 *
 * The cause is that OpenCode's readiness probe is `opencode models`, which
 * answers happily with no account at all, and `publicStatus` maps every
 * `readiness: 'ready'` to `auth: 'authenticated'` -- for every runtime except
 * omniroute. `RuntimeAuthState` already carries `'not-applicable'` for
 * exactly this case.
 *
 * It matters beyond wording: OpenCode's free model needing no account is the
 * on-ramp the whole first-run screen is built around, and the one surface
 * that describes the runtime tells the person the opposite.
 */

const found = (id: string, readiness: RuntimeDiscovery['readiness']): RuntimeDiscovery =>
  ({
    id,
    displayName: id === 'opencode' ? 'OpenCode' : 'Codex CLI',
    availability: 'available',
    readiness,
    version: '1.0.0',
    diagnostics: []
  }) as unknown as RuntimeDiscovery

const rowFor = async (runtimes: readonly RuntimeDiscovery[], id: string) => {
  const service = createRuntimeDiscoveryService({ probe: async () => runtimes })
  const response = await service.get()
  if (!response.ok) throw new Error('discovery refused')
  return response.data.runtimes.find((runtime) => runtime.id === id)
}

describe('what discovery claims about an account', () => {
  it('is not reported to the window as signed in', async () => {
    // OpenCode answers `opencode models` with no credential, so "ready" here
    // is a statement about the CLI being usable, not about an account
    // existing. Reporting it as authenticated invents a sign-in that never
    // happened.
    const row = await rowFor([found('opencode', 'ready')], 'opencode')
    expect(row?.auth).not.toBe('authenticated')
    expect(row?.auth).toBe('not-applicable')
  })

  it('still reports a runtime whose readiness DOES mean an account', async () => {
    // The control. Without it, "opencode is not authenticated" is equally
    // satisfied by a mapping that never reports anyone as signed in.
    const row = await rowFor([found('codex', 'ready')], 'codex')
    expect(row?.auth).toBe('authenticated')
  })

  it('still reports a signed-out runtime as signed out', async () => {
    const row = await rowFor([found('codex', 'authentication-required')], 'codex')
    expect(row?.auth).toBe('unauthenticated')
  })
})
