import type { RuntimeDiscovery } from '@teammate/runtime-adapters'
import { describe, expect, it, vi } from 'vitest'
import { createRuntimeDiscoveryService } from './runtime-discovery.js'

function runtime(
  id: RuntimeDiscovery['id'],
  readiness: RuntimeDiscovery['readiness'],
  available = true
): RuntimeDiscovery {
  return {
    id,
    kind: id === 'omniroute' ? 'provider-gateway' : 'agent-runtime',
    displayName: id === 'codex' ? 'Codex CLI' : id === 'claude' ? 'Claude Code' : 'OmniRoute',
    optional: id === 'omniroute',
    availability: available ? 'available' : 'unavailable',
    readiness,
    supportedFeatures: [],
    requiredFeatures: [],
    diagnostics: []
  }
}

describe('runtime discovery service', () => {
  it('publishes only sanitized status fields', async () => {
    const codex: RuntimeDiscovery = {
      ...runtime('codex', 'authentication-required'),
      executable: {
        commandName: 'codex',
        discoveredPath: 'C:\\private\\codex.exe',
        executablePath: 'C:\\private\\codex.exe',
        prefixArgs: [],
        kind: 'native'
      },
      version: {
        raw: 'codex-cli 0.151.0-alpha.7.2',
        version: '0.151.0-alpha.7.2',
        major: 0,
        minor: 151,
        patch: 0,
        prerelease: 'alpha.7.2'
      }
    }
    const service = createRuntimeDiscoveryService({
      probe: async () => [codex, runtime('claude', 'ready'), runtime('omniroute', 'unknown', false)],
      now: () => new Date('2026-08-30T12:00:00.000Z')
    })

    const response = await service.get()
    expect(response.ok).toBe(true)
    if (!response.ok) return
    expect(response.data.runtimes).toEqual([
      {
        id: 'codex',
        displayName: 'Codex CLI',
        installed: true,
        version: '0.151.0-alpha.7.2',
        auth: 'unauthenticated',
        ready: false,
        status: 'auth-required'
      },
      {
        id: 'claude',
        displayName: 'Claude Code',
        installed: true,
        version: null,
        auth: 'authenticated',
        ready: true,
        status: 'ready'
      },
      {
        id: 'omniroute',
        displayName: 'OmniRoute',
        installed: false,
        version: null,
        auth: 'not-applicable',
        ready: false,
        status: 'not-installed'
      }
    ])
    expect(JSON.stringify(response)).not.toContain('private')
  })

  it('deduplicates in-flight probes and uses its short cache', async () => {
    let complete: ((value: readonly RuntimeDiscovery[]) => void) | undefined
    const probe = vi.fn(() => new Promise<readonly RuntimeDiscovery[]>((resolve) => {
      complete = resolve
    }))
    let nowMs = Date.parse('2026-08-30T12:00:00.000Z')
    const service = createRuntimeDiscoveryService({
      probe,
      now: () => new Date(nowMs),
      cacheTtlMs: 100
    })

    const first = service.get()
    const second = service.get()
    expect(first).toBe(second)
    expect(probe).toHaveBeenCalledTimes(1)
    complete?.([runtime('claude', 'ready')])
    await first

    await service.get()
    expect(probe).toHaveBeenCalledTimes(1)
    nowMs += 101
    const third = service.get()
    expect(probe).toHaveBeenCalledTimes(2)
    complete?.([runtime('claude', 'ready')])
    await third
  })

  it('returns a generic error and never leaks adapter failures', async () => {
    const service = createRuntimeDiscoveryService({
      probe: async () => {
        throw new Error('secret path and raw stderr')
      }
    })

    await expect(service.get()).resolves.toEqual({
      ok: false,
      error: {
        code: 'DISCOVERY_FAILED',
        message: 'Local runtime discovery could not complete.'
      }
    })
  })
})
