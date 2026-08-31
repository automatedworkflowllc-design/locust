import type { RuntimeDiscovery } from '@teammate/runtime-adapters'

export const RUNTIME_DISCOVERY_CHANNEL = 'runtime-discovery:get'

export type LocalRuntimeId = 'codex' | 'claude' | 'omniroute'
export type RuntimeAuthState = 'authenticated' | 'unauthenticated' | 'unknown' | 'not-applicable'
export type RuntimeProbeStatus = 'ready' | 'not-installed' | 'auth-required' | 'offline' | 'probe-failed'

export interface PublicRuntimeStatus {
  readonly id: LocalRuntimeId
  readonly displayName: string
  readonly installed: boolean
  readonly version: string | null
  readonly auth: RuntimeAuthState
  readonly ready: boolean
  readonly status: RuntimeProbeStatus
}

export interface RuntimeDiscoverySnapshot {
  readonly checkedAt: string
  readonly runtimes: readonly PublicRuntimeStatus[]
}

export type RuntimeDiscoveryResponse =
  | { readonly ok: true; readonly data: RuntimeDiscoverySnapshot }
  | {
      readonly ok: false
      readonly error: {
        readonly code: 'DISCOVERY_FAILED'
        readonly message: string
      }
    }

export interface RuntimeDiscoveryService {
  get(): Promise<RuntimeDiscoveryResponse>
  invalidate(): void
}

interface RuntimeDiscoveryServiceOptions {
  readonly probe: () => Promise<readonly RuntimeDiscovery[]>
  readonly now?: () => Date
  readonly cacheTtlMs?: number
}

function publicStatus(runtime: RuntimeDiscovery): PublicRuntimeStatus {
  const installed = runtime.availability === 'available'
  const auth: RuntimeAuthState = runtime.id === 'omniroute'
    ? 'not-applicable'
    : runtime.readiness === 'ready'
      ? 'authenticated'
      : runtime.readiness === 'authentication-required'
        ? 'unauthenticated'
        : 'unknown'

  let status: RuntimeProbeStatus
  if (!installed) status = 'not-installed'
  else if (runtime.readiness === 'ready') status = 'ready'
  else if (runtime.readiness === 'authentication-required') status = 'auth-required'
  else if (runtime.readiness === 'unhealthy') status = 'offline'
  else status = 'probe-failed'

  return {
    id: runtime.id,
    displayName: runtime.displayName,
    installed,
    version: runtime.version?.version ?? null,
    auth,
    ready: status === 'ready',
    status
  }
}

function discoveryFailed(): RuntimeDiscoveryResponse {
  return {
    ok: false,
    error: {
      code: 'DISCOVERY_FAILED',
      message: 'Local runtime discovery could not complete.'
    }
  }
}

export function createRuntimeDiscoveryService(
  options: RuntimeDiscoveryServiceOptions
): RuntimeDiscoveryService {
  const now = options.now ?? (() => new Date())
  const cacheTtlMs = options.cacheTtlMs ?? 10_000
  if (!Number.isFinite(cacheTtlMs) || cacheTtlMs < 0) {
    throw new Error('cacheTtlMs must be a non-negative finite number')
  }

  let cached: { readonly expiresAt: number; readonly response: RuntimeDiscoveryResponse } | undefined
  let inFlight: Promise<RuntimeDiscoveryResponse> | undefined

  return {
    get(): Promise<RuntimeDiscoveryResponse> {
      const currentTime = now().getTime()
      if (cached && currentTime < cached.expiresAt) return Promise.resolve(cached.response)
      if (inFlight) return inFlight

      inFlight = options.probe()
        .then((runtimes): RuntimeDiscoveryResponse => ({
          ok: true,
          data: {
            checkedAt: now().toISOString(),
            runtimes: runtimes.map(publicStatus)
          }
        }))
        .catch(() => discoveryFailed())
        .then((response) => {
          cached = { expiresAt: now().getTime() + cacheTtlMs, response }
          return response
        })
        .finally(() => {
          inFlight = undefined
        })

      return inFlight
    },
    invalidate(): void {
      cached = undefined
    }
  }
}
