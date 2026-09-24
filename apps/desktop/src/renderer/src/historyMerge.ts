import type { PublicRecoveredMission } from '../../shared/ipc.js'

/**
 * WHAT THIS WINDOW ALREADY HOLDS, and what to do with a read that says so.
 *
 * Every history read used to replace the whole list with new objects: the
 * newest twenty missions whole, 2.69 MB on Colin's ledger (Batch C), sent on
 * every run end. The host now leaves out the events of a record whose digest
 * the window handed it (`eventsKept`), and the window keeps its own copy --
 * THE SAME OBJECT, so a turn memoised on its events is not built again.
 */

/**
 * H3: which turns of a conversation came as rows only -- no events, though
 * the ledger holds some -- and so must be read before it is shown whole.
 */
export function missingTranscripts(missionIds: readonly string[], byId: ReadonlyMap<string, PublicRecoveredMission>): readonly string[] {
  return [...new Set(missionIds)].filter((missionId) => {
    const mission = byId.get(missionId)
    return mission !== undefined && mission.events.length === 0 && mission.eventCount > 0
  })
}

/** The records held whole, by the digest each was sent under. Undefined when there are none. */
export function heldDigests(history: readonly PublicRecoveredMission[]): Readonly<Record<string, string>> | undefined {
  const held: Record<string, string> = {}
  let any = false
  for (const mission of history) {
    if (mission.digest === undefined || mission.events.length === 0) continue
    held[mission.missionId] = mission.digest
    any = true
  }
  return any ? held : undefined
}

/**
 * A read, with each record the host kept taken from what is held. A kept
 * record the window no longer holds under that digest -- a second read raced
 * this one, or a delete -- becomes an ordinary row without events, which is
 * what an older conversation is anyway, and the next read sends it whole
 * again because `heldDigests` does not name it.
 */
export function mergeHistory(
  held: readonly PublicRecoveredMission[],
  incoming: readonly PublicRecoveredMission[]
): readonly PublicRecoveredMission[] {
  const byId = new Map(held.map((mission) => [mission.missionId, mission]))
  return incoming.map((mission) => {
    /*
     * H3: a ROW for a record this window holds whole -- an older
     * conversation it opened and read (`missingTranscripts`) -- keeps the
     * whole one while the ledger still has as many events as it did. It
     * used to be replaced by the row on the next read, and the replies went
     * again.
     */
    if (mission.eventsKept !== true && mission.events.length === 0) {
      const mine = byId.get(mission.missionId)
      if (mine !== undefined && mine.events.length > 0 && mine.eventCount === mission.eventCount) return mine
      return mission
    }
    if (mission.eventsKept !== true) return mission
    const mine = byId.get(mission.missionId)
    if (mine !== undefined && mine.digest === mission.digest && mine.events.length > 0) return mine
    const { eventsKept: _kept, digest: _digest, ...row } = mission
    return row
  })
}
