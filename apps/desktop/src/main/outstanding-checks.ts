import type { RuntimeDiscovery } from '@teammate/runtime-adapters'

import { isStillBeingChecked, type SweepCheck } from './sweep-settle.js'

/**
 * The checks the sweep went on without (sweep-settle.ts), by agent.
 *
 * Held so that
 *  - a start ON an agent waits for that agent's own check and for no other,
 *  - the next sweep joins a check that is going instead of starting a second
 *    `opencode` or `agy` beside it, and
 *  - nothing reads one of these agents as having been asked.
 */
export interface OutstandingChecks {
  set(check: SweepCheck): void
  get(id: string): SweepCheck | undefined
  has(id: string): boolean
  delete(id: string): void
  values(): readonly SweepCheck[]
  /**
   * The runtimes as a start on `runtimeId` should see them: if that agent's
   * check is still going and it is shown only as being checked, its answer is
   * waited for and put in; anything else
   * about it, and every other agent, is as it was -- a start on another agent
   * never waits for this one.
   */
  forStart(runtimeId: string | undefined, found: readonly RuntimeDiscovery[]): Promise<readonly RuntimeDiscovery[]>
}

export function createOutstandingChecks(): OutstandingChecks {
  const held = new Map<string, SweepCheck>()
  return {
    set: (check) => void held.set(check.id, check),
    get: (id) => held.get(id),
    has: (id) => held.has(id),
    delete: (id) => void held.delete(id),
    values: () => [...held.values()],
    async forStart(runtimeId, found) {
      if (runtimeId === undefined) return found
      const checking = held.get(runtimeId)
      if (checking === undefined) return found
      // Shown from its last definite answer while the new one is awaited: nothing to wait for.
      const shown = found.find((entry) => entry.id === runtimeId)
      if (shown !== undefined && !isStillBeingChecked(shown)) return found
      const answer = await checking.result.catch(() => undefined)
      return answer === undefined ? found : found.map((entry) => (entry.id === runtimeId ? answer : entry))
    }
  }
}
