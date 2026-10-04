import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RecoveredMission } from '@teammate/mission-store'
import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'
import { afterEach, describe, expect, it } from 'vitest'

import type { PublicTeammate } from '../shared/ipc.js'
import { boardLines, taskSection } from '../shared/room-task.js'
import { createRoomStore } from './room-store.js'
import { createRoomTasks } from './room-tasks.js'

/**
 * A2.6: A HANDOVER IN THE TEAMMATE'S OWN WORDS, AND A GAP SAID AS ONE.
 *
 * A task handed over used to arrive as a board row and nothing else. The
 * brief now asks for a message to the new owner in the same reply -- what was
 * done, how it was checked, what is left -- and when the reply wrote them
 * nothing, the new owner's row says so, in the host's words, rather than
 * leaving them to guess that there was nothing to find.
 */
const NOW = '2026-09-24T12:00:00.000Z'
const NL = String.fromCharCode(10)
let root: string
afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true })
})
const WREN = { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: NOW } as PublicTeammate
const BOOTY = { teammateId: 'tm_booty', name: 'Booty', hue: 'blue', role: 'Custom', createdAt: NOW } as PublicTeammate

function replied(text: string): RecoveredMission {
  return {
    metadata: { missionId: 'mission_w' },
    events: [
      { id: 'e1', runId: 'run_w', missionId: 'mission_w', sequence: 1, type: 'message.delta', occurredAt: NOW, sourceAdapter: 'codex', payload: { itemId: 'a', operation: 'append', text, final: true, evidence: { redacted: true } } },
      { id: 'e2', runId: 'run_w', missionId: 'mission_w', sequence: 2, type: 'run.completed', occurredAt: NOW, sourceAdapter: 'codex', payload: { process: {}, evidence: { redacted: true } } }
    ] as unknown as NormalizedRuntimeEvent[]
  } as unknown as RecoveredMission
}

async function handOver(reply: string) {
  root = await mkdtemp(join(tmpdir(), 'locust-handover-'))
  let ids = 0
  const rooms = createRoomStore({ rootDirectory: root, now: () => new Date(NOW), createId: () => `id${String(++ids)}` })
  const room = await rooms.create({ name: 'Release', teammateIds: ['tm_wren', 'tm_booty'] })
  await rooms.addPost(room.roomId, { postId: 'post_1', text: 'Ship it', at: NOW, missions: { tm_wren: 'mission_w' } } as never)
  const tasks = createRoomTasks({
    rooms,
    ledger: { getMission: async () => replied(reply) },
    teammates: { list: async () => [WREN, BOOTY] },
    notify: () => undefined
  })
  await tasks.onRunEnded({ missionId: 'mission_w' })
  const task = (await rooms.get(room.roomId))!.tasks[0]!
  const row = taskSection({
    roomName: 'Release',
    selfName: 'Booty',
    memberNames: ['Wren', 'Booty'],
    tasks: boardLines([task], [WREN, BOOTY])
  })
  return { task, row }
}

describe('a task handed over', () => {
  it('with no message to its new owner says so on their row', async () => {
    const { task, row } = await handOver(['Over to Booty.', '<locust-task>', 'handoff Booty :: Check the version string', '</locust-task>'].join(NL))
    expect(task.handedWithoutNote).toBe(true)
    expect(row).toContain('Check the version string (yours, handed over by Wren with no note: ask them what is done and what is left before you start)')
  })

  it('with a message to them in the same reply says only who handed it over', async () => {
    const { task, row } = await handOver([
      'Over to Booty.',
      '<locust-share to="Booty">I bumped it in package.json and ran the tests; the changelog still says the old version.</locust-share>',
      '<locust-task>', 'handoff Booty :: Check the version string', '</locust-task>'
    ].join(NL))
    expect(task.handedWithoutNote).toBeUndefined()
    expect(row).toContain('Check the version string (yours, handed over by Wren)')
    expect(row).not.toContain('with no note')
  })

  it('a message to somebody else is not a note to them', async () => {
    const { task } = await handOver([
      '<locust-share to="Wren">note to self</locust-share>',
      '<locust-task>', 'handoff Booty :: Check the version string', '</locust-task>'
    ].join(NL))
    expect(task.handedWithoutNote).toBe(true)
  })
})

describe('the board brief', () => {
  it('asks for the handover in the teammate’s own words', () => {
    const brief = taskSection({ roomName: 'Release', selfName: 'Wren', memberNames: ['Wren', 'Booty'], tasks: [] })
    expect(brief).toContain('When you hand a task over, send that teammate a message in the same reply: what you did, how you checked it, and what is left.')
  })
})
