import type { MissionLedger } from '@teammate/mission-store'
import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'
import type { CodexMissionUpdate } from '../shared/ipc.js'
import { streamedUpdates } from '../shared/streamed-updates.js'

/** The fsynced ledger is the only source for both bookkeeping and the screen. */
export async function persistEventUpdates(
  ledger: Pick<MissionLedger, 'appendEvents'>,
  runId: string,
  missionId: string,
  events: readonly NormalizedRuntimeEvent[],
  track: (events: readonly NormalizedRuntimeEvent[]) => void,
  emit: (update: CodexMissionUpdate) => void
): Promise<void> {
  await ledger.appendEvents(missionId, events)
  track(events)
  for (const update of streamedUpdates(runId, missionId, events)) emit(update)
}
