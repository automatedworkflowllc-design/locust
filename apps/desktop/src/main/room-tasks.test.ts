import type { RecoveredMission } from '@teammate/mission-store'
import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'
import { describe, expect, it, vi } from 'vitest'

import type { CodexMissionUpdate, PublicRoom, PublicTeammate } from '../shared/ipc.js'
import { createRoomTasks, roomMissionOf } from './room-tasks.js'

const NOW = '2026-09-05T09:00:00.000Z'
const NL = String.fromCharCode(10)

const WREN: PublicTeammate = { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: NOW } as PublicTeammate
const BOOTY: PublicTeammate = { teammateId: 'tm_booty', name: 'Booty', hue: 'blue', role: 'Custom', createdAt: NOW } as PublicTeammate

function room(): PublicRoom {
  return {
    roomId: 'room_release',
    name: 'Release',
    teammateIds: ['tm_wren', 'tm_booty'],
    createdAt: NOW,
    posts: [{ postId: 'post_1', text: 'Get the release out', at: NOW, missions: { tm_wren: 'mission_w', tm_booty: 'mission_b' } }],
    tasks: []
  }
}

function replied(text: string): RecoveredMission {
  const events = [
    {
      id: 'e1', runId: 'run_w', missionId: 'mission_w', sequence: 1, type: 'message.delta', occurredAt: NOW, sourceAdapter: 'codex',
      payload: { itemId: 'a', operation: 'append', text, final: true, evidence: { redacted: true } }
    },
    {
      id: 'e2', runId: 'run_w', missionId: 'mission_w', sequence: 2, type: 'run.completed', occurredAt: NOW, sourceAdapter: 'codex',
      payload: { process: {}, evidence: { redacted: true } }
    }
  ] as unknown as NormalizedRuntimeEvent[]
  return { metadata: { missionId: 'mission_w' }, events } as unknown as RecoveredMission
}

function harness(text: string | undefined, rooms: readonly PublicRoom[] = [room()]) {
  const applied: unknown[] = []
  const notices: CodexMissionUpdate[] = []
  const tasks = createRoomTasks({
    rooms: {
      list: async () => rooms,
      applyTaskOps: async (roomId, ops, actor, roster) => {
        applied.push({ roomId, ops, actor, roster: roster.map((entry) => entry.name) })
        return { changed: ops.map((op) => `${actor.name} did ${op.kind} "${op.text}".`), refused: [] }
      }
    },
    ledger: { getMission: async () => (text === undefined ? undefined : replied(text)) },
    teammates: { list: async () => [WREN, BOOTY] },
    notify: (update) => notices.push(update)
  })
  return { tasks, applied, notices }
}

describe('which room a mission answered for', () => {
  it('finds the room and the teammate by the mission id a post recorded', () => {
    expect(roomMissionOf([room()], 'mission_b')).toMatchObject({ teammateId: 'tm_booty' })
    expect(roomMissionOf([room()], 'mission_nope')).toBeUndefined()
  })
})

describe('when a room mission ends', () => {
  it('reads the reply’s task block and moves the board as that teammate', async () => {
    const { tasks, applied, notices } = harness(
      ['I wrote them.', '<locust-task>', 'claim :: Write the release notes', 'done :: Write the release notes', '</locust-task>'].join(NL)
    )
    await tasks.onRunEnded({ missionId: 'mission_w' })
    expect(applied).toHaveLength(1)
    expect(applied[0]).toMatchObject({
      roomId: 'room_release',
      actor: { teammateId: 'tm_wren', name: 'Wren', missionId: 'mission_w' },
      roster: ['Wren', 'Booty']
    })
    expect((applied[0] as { ops: unknown[] }).ops).toHaveLength(2)
    expect(notices).toHaveLength(1)
    expect(notices[0]).toMatchObject({ kind: 'room-changed', roomId: 'room_release', roomName: 'Release' })
    expect(notices[0]?.kind === 'room-changed' ? notices[0].message : '').toContain('Wren did claim')
  })

  it('does nothing for a reply with no block, a mission of no room’s, or a mission the ledger cannot find', async () => {
    const plain = harness('Nothing to report.')
    await plain.tasks.onRunEnded({ missionId: 'mission_w' })
    expect(plain.applied).toHaveLength(0)
    expect(plain.notices).toHaveLength(0)

    const stranger = harness('<locust-task>' + NL + 'claim :: x' + NL + '</locust-task>')
    await stranger.tasks.onRunEnded({ missionId: 'mission_elsewhere' })
    expect(stranger.applied).toHaveLength(0)

    const missing = harness(undefined)
    await missing.tasks.onRunEnded({ missionId: 'mission_w' })
    expect(missing.applied).toHaveLength(0)
  })
})

describe('when the last teammate in a room answers', () => {
  function answered(phaseOfOther: string | undefined) {
    const notices: CodexMissionUpdate[] = []
    const tasks = createRoomTasks({
      rooms: { list: async () => [room()], applyTaskOps: async () => ({ changed: [], refused: [] }) },
      ledger: {
        getMission: async (missionId) => {
          if (missionId === 'mission_w') return replied('All done here.')
          if (missionId === 'mission_b' && phaseOfOther !== undefined) return { ...replied('x'), phase: phaseOfOther } as never
          return undefined
        }
      },
      teammates: { list: async () => [WREN, BOOTY] },
      notify: (update) => notices.push(update)
    })
    return { tasks, notices }
  }

  it('says so once the others have ended on the record', async () => {
    const { tasks, notices } = answered('completed')
    await tasks.onRunEnded({ missionId: 'mission_w' })
    expect(notices).toEqual([{ kind: 'room-changed', roomId: 'room_release', roomName: 'Release', message: 'Everyone in Release has answered.' }])
  })

  it('does not while another is still going, interrupted, or missing', async () => {
    for (const phase of ['interrupted', undefined]) {
      const { tasks, notices } = answered(phase)
      await tasks.onRunEnded({ missionId: 'mission_w' })
      expect(notices).toEqual([])
    }
  })

  /*
   * A post starts at most MAX_LIVE_MISSIONS runs, so a room with more
   * members than that has members who never ran -- absent from
   * post.missions, and drawn on screen as "did not start".
   *
   * The check walked post.missions, which is who STARTED, so those members
   * were never looked at and a six-member room whose four runs finished was
   * told "Everyone in Standup has answered." The same slot carries the
   * host's line naming who could not start, so the false claim replaced the
   * true one. Seen driving a six-member room on 2026-09-09.
   */
  function partly() {
    const notices: CodexMissionUpdate[] = []
    const big: PublicRoom = {
      ...room(),
      // Six members, four started: exactly what the live cap produces.
      teammateIds: ['tm_wren', 'tm_booty', 'tm_gem', 'tm_fen', 'tm_otto', 'tm_pike'],
      posts: [
        {
          postId: 'post_1',
          text: 'Get the release out',
          at: NOW,
          missions: { tm_wren: 'mission_w', tm_booty: 'mission_b', tm_gem: 'mission_g', tm_fen: 'mission_f' }
        }
      ]
    }
    const tasks = createRoomTasks({
      rooms: { list: async () => [big], applyTaskOps: async () => ({ changed: [], refused: [] }) },
      ledger: {
        getMission: async (missionId) => {
          if (missionId === 'mission_w') return replied('All done here.')
          if (['mission_b', 'mission_g', 'mission_f'].includes(missionId)) return { ...replied('x'), phase: 'completed' } as never
          return undefined
        }
      },
      teammates: { list: async () => [WREN, BOOTY] },
      notify: (update) => notices.push(update)
    })
    return { tasks, notices }
  }

  it('does not call four of six everyone', async () => {
    const { tasks, notices } = partly()
    await tasks.onRunEnded({ missionId: 'mission_w' })
    // The control: something IS said, so this cannot pass by silence.
    expect(notices).toHaveLength(1)
    const message = (notices[0] as { message: string }).message
    expect(message).not.toContain('Everyone')
    expect(message).toBe('4 of 6 in Release answered; 2 never started.')
  })
})
