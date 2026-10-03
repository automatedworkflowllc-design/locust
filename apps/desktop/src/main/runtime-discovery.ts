import type { RuntimeDiscovery } from '@teammate/runtime-adapters'
import type {
  LocalRuntimeId,
  PublicRuntimeStatus,
  RuntimeAuthState,
  RuntimeDiscoveryResponse,
  RuntimeProbeStatus
} from '../shared/ipc.js'
export { RUNTIME_DISCOVERY_CHANNEL } from '../shared/ipc.js'
export type {
  LocalRuntimeId,
  PublicRuntimeStatus,
  RuntimeAuthState,
  RuntimeDiscoveryResponse,
  RuntimeProbeStatus
} from '../shared/ipc.js'

export interface RuntimeDiscoverySnapshot {
  readonly checkedAt: string
  readonly runtimes: readonly PublicRuntimeStatus[]
}

export interface RuntimeDiscoveryService {
  get(): Promise<RuntimeDiscoveryResponse>
  invalidate(): void
}

interface RuntimeDiscoveryServiceOptions {
  readonly probe: () => Promise<readonly RuntimeDiscovery[]>
  readonly now?: () => Date
  readonly cacheTtlMs?: number
  /**
   * Whether npm can be run. Absent means "assume it is there", which is what
   * every existing caller and test expects; the app wires it for real.
   */
  readonly npmPresent?: () => Promise<boolean>
  /**
   * Whether the npm that would run is this app's own copy. Absent means no,
   * which is what every build before 0.178.0 and every existing test expect.
   */
  readonly npmIsBundled?: () => Promise<boolean>
  /** npm is on this machine and did not answer in five seconds. */
  readonly npmDidNotAnswer?: () => Promise<boolean>
  /** What an ACP agent last said it can do (acp-capabilities.ts, W12). */
  readonly agentCapabilities?: (runtime: LocalRuntimeId) => PublicRuntimeStatus['agentCapabilities']
}

function publicStatus(runtime: RuntimeDiscovery): PublicRuntimeStatus {
  const installed = runtime.availability === 'available'
  // "Ready" does not always mean "signed in". OpenCode's readiness probe is
  // `opencode models`, which answers happily with no account at all -- and on
  // the machine every drive in this repo runs on, `opencode auth list`
  // reports ZERO credentials while Settings said "Signed in on this machine,
  // using your own account" (QA, 2026-09-06, reproduced live). That is an
  // invented sign-in, and it contradicts the one thing the first-run screen
  // is built around: this runtime's free model needs no account.
  //
  // `not-applicable` is what the type already carries for a runtime whose
  // readiness is not a statement about an account.
  const auth: RuntimeAuthState = runtime.id === 'omniroute' || runtime.id === 'opencode'
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
    status,
    // Antigravity through its own CLI is an ordinary runtime, not the app's unpublished interface (0.541).
    ...(runtime.id === 'antigravity' && runtime.executable?.commandName === 'agy' ? { throughCli: true as const } : {})
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
        .then(async (runtimes): Promise<RuntimeDiscoveryResponse> => ({
          ok: true,
          data: {
            checkedAt: now().toISOString(),
            runtimes: runtimes.map((runtime) => {
              const status = publicStatus(runtime)
              const told = options.agentCapabilities?.(status.id)
              return told === undefined ? status : { ...status, agentCapabilities: told }
            }),
            npmPresent: options.npmPresent === undefined ? true : await options.npmPresent(),
            npmIsBundled: options.npmIsBundled === undefined ? false : await options.npmIsBundled(),
            npmDidNotAnswer: options.npmDidNotAnswer === undefined ? false : await options.npmDidNotAnswer()
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
