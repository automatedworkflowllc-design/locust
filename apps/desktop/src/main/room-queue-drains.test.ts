import { describe, expect, it, vi } from 'vitest'

import type { CodexMissionUpdate, PublicRoom, PublicTeammate } from '../shared/ipc.js'
import { createRoomTasks } from './room-tasks.js'

/**
 * A member who had no slot is started when one frees.
 *
 * The queue, decided by Colin on 2026-09-09 after the design agent argued
 * for it: "Probably queued makes sense."
 *
 * Their case was that the two costs are not the same kind of thing. The
 * wave cost -- a room resolving over minutes instead of at once -- is
 * transient and paid by whoever is watching, and nobody watches a room;
 * that is what rooms are for. The never-start cost is permanent and paid by
 * the RECORD: a member who never ran left no mission at all, so the next day
 * nothing showed they had been asked. A warning before the post does not
 * repair a record after it.
 *
 * This covers the drain, which is the half that can lose people. A queue
 * nothing empties is worse than no queue: no mission, no line naming them,
 * and nobody coming back. It runs on EVERY mission ending, not just a
 * room's, because the cap is one pool -- a teammate finishing their own work
 * is what lets a room post reach the rest of its members.
 */

const WREN = { teammateId: 'tm_wren', name: 'Wren' } as PublicTeammate
const NOW = '2026-09-09T12:00:00.000Z'

function room(queued: readonly string[]): PublicRoom {
  return {
    roomId: 'room_standup',
    name: 'Standup',
    teammateIds: ['tm_wren', 'tm_booty', 'tm_gem', 'tm_fen'],
    createdAt: NOW,
    posts: [
      {
        postId: 'post_1',
        text: 'Say your word',
        at: NOW,
        missions: { tm_wren: 'mission_w' },
        ...(queued.length === 0 ? {} : { queued })
      }
    ],
    tasks: []
  }
}

/** The drain, with a host that answers however the test needs. */
function harness(
  queued: readonly string[],
  answer: (teammateId: string) => { readonly missionId: string } | 'no-slot' | 'refused'
) {
  const started: string[] = []
  const recorded: { teammateId: string; missionId: string }[] = []
  const notices: CodexMissionUpdate[] = []
  const tasks = createRoomTasks({
    rooms: {
      list: async () => [room(queued)],
      applyTaskOps: async () => ({ changed: [], refused: [] }),
      updateTask: async () => ({}) as never,
      startQueued: async (_roomId, _postId, teammateId, missionId) => {
        recorded.push({ teammateId, missionId })
      }
    },
    // The ended mission has no reply, so nothing below the drain runs.
    ledger: { getMission: async () => undefined },
    teammates: { list: async () => [WREN] },
    notify: (update) => notices.push(update),
    startQueued: async (_room, _postId, teammateId) => {
      started.push(teammateId)
      return answer(teammateId)
    }
  })
  return { tasks, started, recorded, notices }
}

describe('when a slot frees', () => {
  it('starts the people who were waiting, in room order', async () => {
    const { tasks, started, recorded } = harness(['tm_booty', 'tm_gem'], (id) => ({ missionId: `m_${id}` }))
    await tasks.onRunEnded({ missionId: 'mission_w' })

    // THE point of the queue: they run rather than never being asked.
    expect(started).toEqual(['tm_booty', 'tm_gem'])
    // And the post records it, so a reload does not start them twice.
    expect(recorded).toEqual([
      { teammateId: 'tm_booty', missionId: 'm_tm_booty' },
      { teammateId: 'tm_gem', missionId: 'm_tm_gem' }
    ])
  })

  it('stops asking the moment the pool is full again', async () => {
    /*
     * A start answering 'no-slot' means the cap is reached, so nothing in
     * any queue anywhere can start either. Walking the rest would be a
     * request per waiting member per ending run, for nothing.
     */
    const { tasks, started, recorded } = harness(['tm_booty', 'tm_gem', 'tm_fen'], () => 'no-slot')
    await tasks.onRunEnded({ missionId: 'mission_w' })
    expect(started).toEqual(['tm_booty'])
    expect(recorded).toEqual([])
  })

  it('passes over someone waiting cannot help, and keeps going', async () => {
    // Gone from the roster, or a runtime a room cannot post to. Waiting will
    // never fix it, so it must not block the person behind them.
    const { tasks, started, recorded } = harness(['tm_booty', 'tm_gem'], (id) =>
      id === 'tm_booty' ? 'refused' : { missionId: 'm_gem' }
    )
    await tasks.onRunEnded({ missionId: 'mission_w' })
    expect(started).toEqual(['tm_booty', 'tm_gem'])
    expect(recorded).toEqual([{ teammateId: 'tm_gem', missionId: 'm_gem' }])
  })

  it('does nothing at all when nobody is waiting', async () => {
    const { tasks, started } = harness([], () => ({ missionId: 'never' }))
    await tasks.onRunEnded({ missionId: 'mission_w' })
    expect(started).toEqual([])
  })

  it('leaves the run alive when the post cannot be updated', async () => {
    /*
     * The mission IS running. Failing to record it against the post must not
     * throw the drain away: a queue entry that outlives its start is visible
     * on the next drain, a lost run is not.
     */
    const failing = vi.fn(async () => {
      throw new Error('disk full')
    })
    const started: string[] = []
    const tasks = createRoomTasks({
      rooms: {
        list: async () => [room(['tm_booty', 'tm_gem'])],
        applyTaskOps: async () => ({ changed: [], refused: [] }),
        updateTask: async () => ({}) as never,
        startQueued: failing
      },
      ledger: { getMission: async () => undefined },
      teammates: { list: async () => [WREN] },
      notify: () => undefined,
      startQueued: async (_room, _postId, teammateId) => {
        started.push(teammateId)
        return { missionId: `m_${teammateId}` }
      }
    })
    await expect(tasks.onRunEnded({ missionId: 'mission_w' })).resolves.toBeUndefined()
    expect(started).toEqual(['tm_booty', 'tm_gem'])
    expect(failing).toHaveBeenCalledTimes(2)
  })

  it('survives a host that throws instead of answering', async () => {
    const { tasks, recorded } = harness(['tm_booty'], () => {
      throw new Error('the transport is gone')
    })
    await expect(tasks.onRunEnded({ missionId: 'mission_w' })).resolves.toBeUndefined()
    expect(recorded).toEqual([])
  })
})
