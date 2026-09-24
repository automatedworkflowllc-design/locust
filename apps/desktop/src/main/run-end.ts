import type { WorkroomMessage } from '@teammate/mission-store'

import type { EndedMission, SharingMission } from './relay.js'

/**
 * WHAT HAPPENS WHEN A RUN ENDS, IN ORDER, EACH ON ITS OWN (A2.14).
 *
 * The run-end handlers were a chain of awaits -- relay, routine, room tasks,
 * memory, attention -- and the code review's reported #16 found two faults
 * in it:
 *
 *   - The run's memory block was applied LAST, after the relay had already
 *     started the next teammate: a share starts the recipient before the run
 *     even ends, and a held reply starts in `relay.onRunEnded`. That teammate
 *     was briefed without the memory the run had just written.
 *   - One handler throwing skipped every handler after it, so a relay that
 *     failed took the routine's next step, the room's queue and the memory
 *     with it.
 *
 * So memory goes first, once per run -- at the share if there is one, else
 * at the end -- and every step runs whatever the one before it did, a
 * failure noted in the log instead of carried forward.
 */

interface EndStep {
  onRunEnded(mission: EndedMission): Promise<void>
}

export interface RunEndSteps {
  /** Bound late, so read when a run ends. */
  readonly memory: () => EndStep | undefined
  readonly relay: () => (EndStep & { onShared(mission: SharingMission, posted: readonly WorkroomMessage[]): Promise<void> }) | undefined
  /** The rest, in order, after the relay. */
  readonly after: readonly { readonly label: string; readonly step: () => EndStep | undefined }[]
  readonly note: (label: string, detail: string) => void
}

/** Runs remembered as having had their memory applied; the oldest go first. */
const MEMORY_REMEMBERED = 2_000

export function createRunEnd(steps: RunEndSteps): {
  onShared(mission: SharingMission, posted: readonly WorkroomMessage[]): Promise<void>
  onRunEnded(mission: EndedMission): Promise<void>
} {
  const applied = new Set<string>()
  const safely = async (label: string, missionId: string, work: () => Promise<void> | undefined): Promise<void> => {
    try {
      await work()
    } catch (error) {
      steps.note('run-end', `${label} failed for ${missionId}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const memoryOnce = async (mission: EndedMission): Promise<void> => {
    if (applied.has(mission.missionId)) return
    applied.add(mission.missionId)
    while (applied.size > MEMORY_REMEMBERED) {
      const oldest = applied.values().next().value
      if (oldest === undefined) break
      applied.delete(oldest)
    }
    await safely('memory', mission.missionId, () => steps.memory()?.onRunEnded(mission))
  }
  return {
    async onShared(mission, posted) {
      // Before the recipient is started, so their brief has what this run
      // remembered.
      await memoryOnce(mission)
      await safely('relay share', mission.missionId, () => steps.relay()?.onShared(mission, posted))
    },
    async onRunEnded(mission) {
      await memoryOnce(mission)
      await safely('relay', mission.missionId, () => steps.relay()?.onRunEnded(mission))
      for (const next of steps.after) {
        await safely(next.label, mission.missionId, () => next.step()?.onRunEnded(mission))
      }
    }
  }
}
