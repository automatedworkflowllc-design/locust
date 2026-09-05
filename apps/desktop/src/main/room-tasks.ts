import type { MissionLedger } from '@teammate/mission-store'

import type { CodexMissionUpdate, PublicRoom, PublicTeammate } from '../shared/ipc.js'
import { parseTaskBlocks } from '../shared/room-task.js'
import { createTranscriptTracker } from './peer-exchange.js'
import type { RoomStore } from './room-store.js'

/**
 * When a room mission's run ends, read its reply for a task block and move
 * the room's board.
 *
 * The mission itself knows nothing about rooms -- it is an ordinary mission
 * of its teammate's -- so this reads the room file to learn which post the
 * mission answered, rebuilds the reply from the ledger the way the share
 * exchange does, and hands the block's operations to the store. A reply
 * with no block moves nothing. Everything it did or refused is said back to
 * the window in one line, so the room can show it.
 */
export interface RoomTasksOptions {
  readonly rooms: Pick<RoomStore, 'list' | 'applyTaskOps'>
  readonly ledger: Pick<MissionLedger, 'getMission'>
  readonly teammates: { list(): Promise<readonly PublicTeammate[]> }
  readonly notify: (update: CodexMissionUpdate) => void
}

export interface RoomTasks {
  onRunEnded(mission: { readonly missionId: string }): Promise<void>
}

/** The room and teammate a mission answered for, if it was a room post's. */
export function roomMissionOf(
  rooms: readonly PublicRoom[],
  missionId: string
): { readonly room: PublicRoom; readonly teammateId: string } | undefined {
  for (const room of rooms) {
    for (const post of room.posts) {
      for (const [teammateId, id] of Object.entries(post.missions)) {
        if (id === missionId) return { room, teammateId }
      }
    }
  }
  return undefined
}

export function createRoomTasks(options: RoomTasksOptions): RoomTasks {
  return {
    async onRunEnded(mission) {
      let rooms: readonly PublicRoom[]
      try {
        rooms = await options.rooms.list()
      } catch {
        return
      }
      const found = roomMissionOf(rooms, mission.missionId)
      if (found === undefined) return

      // The reply, rebuilt from the record the same way a share is.
      let text: string | undefined
      try {
        const recovered = await options.ledger.getMission(mission.missionId)
        if (recovered === undefined) return
        const tracker = createTranscriptTracker()
        tracker.track(recovered.events)
        text = tracker.latestFinal
      } catch {
        return
      }
      if (text === undefined) return
      const ops = parseTaskBlocks(text)
      if (ops.length === 0) return

      let roster: readonly PublicTeammate[] = []
      try {
        roster = await options.teammates.list()
      } catch {
        // A roster that cannot be read means a handoff cannot be resolved;
        // the store refuses it by name, which is the truthful outcome.
      }
      const actor = roster.find((entry) => entry.teammateId === found.teammateId)
      const result = await options.rooms.applyTaskOps(
        found.room.roomId,
        ops,
        { teammateId: found.teammateId, name: actor?.name ?? found.teammateId, missionId: mission.missionId },
        roster.map((entry) => ({ teammateId: entry.teammateId, name: entry.name }))
      )
      if (result.changed.length === 0 && result.refused.length === 0) return
      options.notify({
        kind: 'room-changed',
        roomId: found.room.roomId,
        message: [...result.changed, ...result.refused].join(' ')
      })
    }
  }
}
