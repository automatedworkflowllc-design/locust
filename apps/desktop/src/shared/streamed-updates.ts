import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'
import type { CodexMissionUpdate } from './ipc.js'

/** One IPC message for consecutive text fragments; activity keeps its path. */
export function streamedUpdates(
  runId: string,
  missionId: string,
  events: readonly NormalizedRuntimeEvent[]
): readonly CodexMissionUpdate[] {
  const updates: CodexMissionUpdate[] = []
  let deltas: Extract<NormalizedRuntimeEvent, { readonly type: 'message.delta' }>[] = []
  const flush = (): void => {
    if (deltas.length === 0) return
    updates.push({ kind: 'message-deltas', runId, missionId, events: deltas })
    deltas = []
  }
  for (const event of events) {
    if (event.type === 'message.delta') deltas.push(event)
    else {
      flush()
      updates.push({ kind: 'event', runId, missionId, event })
    }
  }
  flush()
  return updates
}
