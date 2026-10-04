import type { DiscoveryEvent } from '../shared/ipc.js'

/**
 * What discovery is doing, kept so a late subscriber sees all of it.
 *
 * The boot screen is a view of these events. The window is created while the
 * first sweep is already running, so a screen that only saw what arrived
 * after it subscribed would open halfway through its own story — and on a
 * fast machine it would open after the end of it. So every event is recorded
 * and replayed to each new subscriber in order.
 *
 * Only THIS launch's sweep is kept. A later re-check (Settings → Check now,
 * or a cache expiry) starts a new log: `started` clears what came before,
 * because the screen shows one sweep and a log with two beginnings in it is
 * not a log of anything.
 */
export interface DiscoveryLog {
  emit(event: DiscoveryEvent): void
  subscribe(listener: (event: DiscoveryEvent) => void): () => void
  /** Everything recorded for the current sweep, oldest first. */
  replay(): readonly DiscoveryEvent[]
}

export function createDiscoveryLog(): DiscoveryLog {
  let events: DiscoveryEvent[] = []
  const listeners = new Set<(event: DiscoveryEvent) => void>()

  return {
    emit(event) {
      /*
       * A new sweep is a new log -- but `context` survives it.
       *
       * Without the reset the screen would show five probes and then five
       * more underneath them. Without the exception the preamble
       * disappeared: `context` is emitted once per launch and a sweep
       * starting after it wiped it, so the first drive opened straight at
       * "scanning PATH" with nothing above it. The version, the folder and
       * the ledger are facts about this launch and are true across as many
       * sweeps as it runs.
       */
      if (event.kind === 'started') {
        events = events.filter((held) => held.kind === 'context')
      }
      events.push(event)
      for (const listener of listeners) {
        // One bad listener must not stop the rest, and must not stop the
        // sweep: discovery is the thing that has to finish here.
        try {
          listener(event)
        } catch {
          // Nothing to do about a renderer that has gone away.
        }
      }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    replay() {
      return [...events]
    }
  }
}

/**
 * How a probe's result reads on the boot screen.
 *
 * Deliberately coarser than `RuntimeProbeStatus`: the screen has one line per
 * runtime and four tones. `error` is kept apart from `missing` because they
 * are different things to a person — one is "you do not have this", the other
 * is "you have it and something went wrong", and only the second is worth
 * looking into.
 */
export function bootOutcome(input: {
  readonly installed: boolean
  readonly status: string
}): 'missing' | 'needs-signin' | 'ready' | 'error' {
  if (!input.installed) return 'missing'
  if (input.status === 'ready') return 'ready'
  if (input.status === 'auth-required') return 'needs-signin'
  return 'error'
}
