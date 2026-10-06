import type { WorkroomMessage } from '@teammate/mission-store'
import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

import type { PeerExchange } from './peer-exchange.js'

/** A spawn or a terminal failure is not evidence that the runtime took its prompt. */
export function deliverWhenRuntimeStarts(
  exchange: PeerExchange | undefined,
  missionId: string,
  messages: readonly WorkroomMessage[]
): (events: readonly NormalizedRuntimeEvent[]) => Promise<void> {
  let delivered = false
  return async (events) => {
    if (delivered || !events.some((event) =>
      event.type === 'run.started' || event.type === 'step.started'
      || event.type === 'tool.started' || event.type === 'message.delta'
    )) return
    delivered = true
    await exchange?.markDelivered(missionId, messages)
  }
}
