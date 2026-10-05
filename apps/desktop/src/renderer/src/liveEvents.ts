import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'
import { EVENT_WINDOW } from '../../shared/event-window.js'
import { withMessageDeltas } from '../../shared/messageFragments.js'

/** A full window is not necessarily trimmed. Remember an actual eviction, even after a later merge. */
export function withLiveEvents(
  held: { readonly events: readonly NormalizedRuntimeEvent[]; readonly eventsTruncated?: boolean },
  arrivals: readonly NormalizedRuntimeEvent[]
): { readonly events: readonly NormalizedRuntimeEvent[]; readonly eventsTruncated: boolean } {
  let eventsTruncated = held.eventsTruncated === true
  const events = withMessageDeltas(held.events, arrivals, EVENT_WINDOW, () => { eventsTruncated = true })
  return { events, eventsTruncated }
}
