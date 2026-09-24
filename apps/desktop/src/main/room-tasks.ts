import type { MissionLedger } from '@teammate/mission-store'

import type { CodexMissionUpdate, PublicRoom, PublicTeammate } from '../shared/ipc.js'
import { parseShareBlocks } from '../shared/peer-share.js'
import { parseTaskBlocks, rowToClaimAtStart } from '../shared/room-task.js'
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
  readonly rooms: Pick<RoomStore, 'list' | 'applyTaskOps' | 'startQueued' | 'refuseQueued' | 'updateTask'>
  readonly ledger: Pick<MissionLedger, 'getMission'>
  readonly teammates: { list(): Promise<readonly PublicTeammate[]> }
  readonly notify: (update: CodexMissionUpdate) => void
  /**
   * Start one member who has been waiting for a slot.
   *
   * The host owns this: it knows the routes, the briefing and the three
   * transports. Answers the mission id when the run started; `'no-slot'`
   * when every run slot is taken -- which ends the drain rather than
   * spinning; `'busy'` when THIS member is mid-run, so the members behind
   * them still get asked; `{ refused }`, with the host's words, when waiting
   * will never fix it; and `'refused'` when there is nothing left to record
   * it on.
   */
  readonly startQueued?: (
    room: PublicRoom,
    postId: string,
    teammateId: string
  ) => Promise<{ readonly missionId: string } | 'no-slot' | 'busy' | 'refused' | { readonly refused: string }>
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

/**
 * How many waiting members one ending run may start.
 *
 * A run ending frees exactly one slot, so one start is the honest number --
 * but a run can end while several are queued and the pool has room for more
 * than one (a person stopped three at once). This is the ceiling on that,
 * not the target: the start itself answers 'no-slot' as soon as the pool is
 * full, and that is what actually ends the drain.
 */
const MAX_DRAIN_PER_RUN = 8

export function createRoomTasks(options: RoomTasksOptions): RoomTasks {
  return {
    async onRunEnded(mission) {
      let rooms: readonly PublicRoom[]
      try {
        rooms = await options.rooms.list()
      } catch {
        return
      }
      /*
       * A slot just freed, so start whoever has been waiting for one.
       *
       * FIRST, before anything below reads the record: this fires on EVERY
       * mission ending, not just a room's, because the cap is one pool
       * across the whole app -- a teammate finishing their own work is what
       * lets a room post reach the rest of its members.
       *
       * Room order is queue order, and one start per freed slot: the start
       * answers 'no-slot' the moment the pool is full again, which is what
       * ends this rather than a count. Bounded anyway, because a drain that
       * cannot end is worse than a queue that does not move.
       */
      if (options.startQueued !== undefined) {
        let started = 0
        for (const room of rooms) {
          for (const post of room.posts) {
            for (const teammateId of post.queued ?? []) {
              if (started >= MAX_DRAIN_PER_RUN) break
              let outcome
              try {
                outcome = await options.startQueued(room, post.postId, teammateId)
              } catch {
                continue
              }
              // Still full. Nothing else in any queue can start either, so
              // stop asking.
              if (outcome === 'no-slot') return
              // This one is mid-run; the members behind them may be free.
              if (outcome === 'busy' || outcome === 'refused') continue
              if ('refused' in outcome) {
                /*
                 * Waiting will never fix it: out of the queue and onto the
                 * post's refusals, with the host's words. It stayed queued,
                 * asked again at every run end, the post showing someone
                 * "waiting" who never would start (harness review,
                 * 2026-09-24).
                 */
                await options.rooms.refuseQueued(room.roomId, post.postId, teammateId, outcome.refused).catch(() => undefined)
                continue
              }
              started += 1
              try {
                await options.rooms.startQueued(room.roomId, post.postId, teammateId, outcome.missionId)
                /*
                 * Claim the row the person named, at START.
                 *
                 * A `locust-task` block is read from the END of a reply, so a
                 * teammate cannot claim while it is working -- and that window
                 * is exactly the one that matters, because the briefing sends
                 * other teammates at unassigned rows. Grok watched a row sit
                 * unassigned through a whole live run whose own reply said
                 * "Starting the release notes task" (2026-09-14, finding 3).
                 *
                 * Only when the post names ONE open row beyond argument. A
                 * post that says "start that board task" names nothing, and
                 * the app does not get to decide which row somebody meant --
                 * see `rowToClaimAtStart`, and the teammate must be the one named too.
                 */
                const named = rowToClaimAtStart({
                  postText: post.text,
                  tasks: room.tasks,
                  members: (await options.teammates.list().catch(() => [])).filter((mate) =>
                    room.teammateIds.includes(mate.teammateId)
                  ),
                  startedTeammateId: teammateId
                })
                if (named !== undefined) {
                  // A claim that fails is not a reason to hold up a run that
                  // has already started; the board is behind, not broken.
                  await options.rooms
                    .updateTask({ roomId: room.roomId, op: 'assign', taskId: named, ownerId: teammateId })
                    .catch(() => undefined)
                }
              } catch {
                // The run is live and the post did not record it. Left to
                // the next drain rather than stopped: a queue entry that
                // outlives its start is visible, a lost run is not.
              }
            }
          }
        }
      }
      const found = roomMissionOf(rooms, mission.missionId)
      if (found === undefined) return
      const say = (message: string): void =>
        options.notify({ kind: 'room-changed', roomId: found.room.roomId, roomName: found.room.name, message })

      // The reply, rebuilt from the record the same way a share is.
      let text: string | undefined
      let post = found.room.posts.find((entry) => Object.values(entry.missions).includes(mission.missionId))
      try {
        const recovered = await options.ledger.getMission(mission.missionId)
        if (recovered === undefined) return
        const tracker = createTranscriptTracker()
        tracker.track(recovered.events)
        text = tracker.latestFinal
      } catch {
        return
      }

      // Everyone in the room has answered this post: the one moment a
      // person waiting on a room most wants to hear about. Decided from
      // the record, not from memory of who was started.
      if (post !== undefined) {
        let allDone = true
        for (const id of Object.values(post.missions)) {
          if (id === mission.missionId) continue
          try {
            const other = await options.ledger.getMission(id)
            // Answered means ENDED on the record: completed, failed or
            // cancelled. Interrupted, missing, or a phase the record does
            // not state is not an answer, however the fixture reads.
            if (other === undefined || (other.phase !== 'completed' && other.phase !== 'failed' && other.phase !== 'cancelled')) {
              allDone = false
              break
            }
          } catch {
            allDone = false
            break
          }
        }
        /*
         * "Everyone" means every MEMBER, not everyone who started.
         *
         * A post only starts as many missions as the live cap allows, so a
         * room with more members than that gets a post where some members
         * never ran at all -- their cards read "did not start". Those
         * members are absent from post.missions, so the loop above never
         * looked at them, and a six-member room whose four started runs
         * finished was told "Everyone in Standup has answered."
         *
         * Worse than merely untrue: the host's refusal line naming who
         * could not start is shown in this same slot, so the false claim
         * REPLACED the true one and the person was left with no way to
         * learn two teammates were never asked.
         *
         * Seen on 2026-09-09 driving a six-member room, with four answers
         * on screen and two empty cards beside them.
         */
        // Anyone still waiting has not answered, and is not "never started"
        // either -- their turn is coming. Saying everyone has answered while
        // a queue is draining would be the same false claim in a new shape.
        const waiting = (post.queued ?? []).length
        const missing = found.room.teammateIds.filter(
          (id) => post?.missions[id] === undefined && !(post?.queued ?? []).includes(id)
        ).length
        if (allDone && Object.keys(post.missions).length > 1) {
          const answered = String(Object.keys(post.missions).length)
          const total = String(found.room.teammateIds.length)
          say(
            waiting > 0
              ? `${answered} of ${total} in ${found.room.name} answered; ${String(waiting)} still waiting for a slot.`
              : missing === 0
                ? `Everyone in ${found.room.name} has answered.`
                : `${answered} of ${total} in ${found.room.name} answered; ${String(missing)} never started.`
          )
        }
      }
      post = undefined

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
      // A2.6: whom the same reply wrote to, so a handoff with no note says so on the board.
      const notedTo = parseShareBlocks(text)
        .map((block) => roster.find((entry) => entry.name.toLowerCase() === block.to.trim().toLowerCase())?.teammateId)
        .filter((id): id is string => id !== undefined)
      const result = await options.rooms.applyTaskOps(
        found.room.roomId,
        ops,
        { teammateId: found.teammateId, name: actor?.name ?? found.teammateId, missionId: mission.missionId, notedTo },
        roster.map((entry) => ({ teammateId: entry.teammateId, name: entry.name }))
      )
      if (result.changed.length === 0 && result.refused.length === 0) return
      say([...result.changed, ...result.refused].join(' '))
    }
  }
}
