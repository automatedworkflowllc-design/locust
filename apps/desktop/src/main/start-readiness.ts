import type { RuntimeDiscovery } from '@teammate/runtime-adapters'

/**
 * Whether the runtime a run is about to start on is still ready, asked as
 * cheaply as the answer allows.
 *
 * A start used to trust the last sweep for five minutes and then run a FULL
 * sweep -- every runtime's probes, the slowest setting the pace -- before the
 * run could begin: 3-6 s measured before 2026-09-22, the first time somebody
 * sent a message after stepping away. The one answer a start needs is the
 * runtime it starts on, so a stale answer is refreshed for that runtime
 * alone (0.2-0.4 s for Claude Code or Codex).
 */
export interface StartReadinessOptions {
  readonly ttlMs: number
  readonly now: () => number
  /** The last full answer and when that sweep ran, if there is one. */
  readonly held: () => { readonly at: number; readonly value: readonly RuntimeDiscovery[] } | undefined
  /** Replace the held answer; `at` stays the sweep's own clock. */
  readonly store: (value: readonly RuntimeDiscovery[]) => void
  /** A full sweep, as every other caller gets. */
  readonly sweep: () => Promise<readonly RuntimeDiscovery[]>
  /** Ask one runtime alone. */
  readonly askOne: (runtimeId: string) => Promise<RuntimeDiscovery | undefined>
  /** Runtimes that are not a CLI to ask alone (Antigravity: the app itself). */
  readonly sweepOnly?: ReadonlySet<string>
}

export interface StartReadiness {
  forStart(runtimeId?: string): Promise<readonly RuntimeDiscovery[]>
  /** A full sweep answered every runtime at this moment. */
  swept(value: readonly RuntimeDiscovery[], at: number): void
}

const usable = (entry: RuntimeDiscovery | undefined): boolean =>
  entry !== undefined && entry.availability === 'available' && entry.readiness === 'ready' && entry.executable !== undefined

export function createStartReadiness(options: StartReadinessOptions): StartReadiness {
  /** When each runtime was last ASKED, by a sweep or on its own. */
  const askedAt = new Map<string, number>()
  return {
    swept(value, at) {
      for (const runtime of value) askedAt.set(runtime.id, at)
    },
    async forStart(runtimeId) {
      const held = options.held()
      if (runtimeId === undefined || held === undefined) return options.sweep()
      const chosen = held.value.find((entry) => entry.id === runtimeId)
      if (usable(chosen) && options.now() - (askedAt.get(runtimeId) ?? held.at) < options.ttlMs) return held.value
      // Not ready last time, or not a CLI: the full path, as before. Only a
      // runtime that WAS ready and has merely gone stale is asked alone.
      if (!usable(chosen) || options.sweepOnly?.has(runtimeId) === true) return options.sweep()
      try {
        const fresh = await options.askOne(runtimeId)
        if (fresh === undefined) return options.sweep()
        const current = options.held() ?? held
        const merged = current.value.map((entry) => (entry.id === runtimeId ? fresh : entry))
        options.store(merged)
        askedAt.set(runtimeId, options.now())
        return merged
      } catch {
        return options.sweep()
      }
    }
  }
}
