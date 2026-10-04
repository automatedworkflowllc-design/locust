import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { taskSection } from '../shared/room-task.js'
import { createRoomStore } from './room-store.js'

/**
 * A2.15: NEVER BOUNCE A STAGE BETWEEN MEMBERS (Rakazo's room rules, in the
 * plan). A handoff straight back to whoever handed a task over is refused by
 * the host, not only discouraged in the brief: two teammates passing one task
 * between them spend a relay hop each time and finish nothing. A person can
 * still move it anywhere.
 */
let root: string
afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true })
})
async function store() {
  root = await mkdtemp(join(tmpdir(), 'locust-bounce-'))
  let ids = 0
  return createRoomStore({ rootDirectory: root, now: () => new Date('2026-09-24T12:00:00.000Z'), createId: () => `id${String(++ids)}` })
}
const ROSTER = [
  { teammateId: 'tm_wren', name: 'Wren' },
  { teammateId: 'tm_booty', name: 'Booty' },
  { teammateId: 'tm_ash', name: 'Ash' }
]
const WREN = { teammateId: 'tm_wren', name: 'Wren', missionId: 'mission_w' }
const BOOTY = { teammateId: 'tm_booty', name: 'Booty', missionId: 'mission_b' }
const ASH = { teammateId: 'tm_ash', name: 'Ash', missionId: 'mission_a' }
const TASK = 'Check the version string'

describe('a handed task', () => {
  it('cannot be handed straight back to the teammate who handed it over', async () => {
    const rooms = await store()
    const room = await rooms.create({ name: 'Release', teammateIds: ['tm_wren', 'tm_booty', 'tm_ash'] })
    await rooms.applyTaskOps(room.roomId, [{ kind: 'handoff', text: TASK, to: 'Booty' }], WREN, ROSTER)
    const back = await rooms.applyTaskOps(room.roomId, [{ kind: 'handoff', text: TASK, to: 'wren' }], BOOTY, ROSTER)
    expect(back.changed).toEqual([])
    expect(back.refused).toEqual([`Booty tried to hand "${TASK}" back to Wren, who handed it over. It stays with Booty.`])
    expect((await rooms.get(room.roomId))!.tasks[0]).toMatchObject({ ownerId: 'tm_booty', handedBy: 'tm_wren' })
  })

  it('can still go on to a third member, and the bounce rule follows the latest hand', async () => {
    const rooms = await store()
    const room = await rooms.create({ name: 'Release', teammateIds: ['tm_wren', 'tm_booty', 'tm_ash'] })
    await rooms.applyTaskOps(room.roomId, [{ kind: 'handoff', text: TASK, to: 'Booty' }], WREN, ROSTER)
    const on = await rooms.applyTaskOps(room.roomId, [{ kind: 'handoff', text: TASK, to: 'Ash' }], BOOTY, ROSTER)
    expect(on.changed).toEqual([`Booty handed "${TASK}" to Ash.`])
    // Ash may hand it to Wren (who did not hand it to Ash), not back to Booty.
    expect((await rooms.applyTaskOps(room.roomId, [{ kind: 'handoff', text: TASK, to: 'Booty' }], ASH, ROSTER)).refused).toHaveLength(1)
    expect((await rooms.applyTaskOps(room.roomId, [{ kind: 'handoff', text: TASK, to: 'Wren' }], ASH, ROSTER)).changed).toHaveLength(1)
  })

  it('is free again once someone claims it or a person reassigns it', async () => {
    const rooms = await store()
    const room = await rooms.create({ name: 'Release', teammateIds: ['tm_wren', 'tm_booty', 'tm_ash'] })
    await rooms.applyTaskOps(room.roomId, [{ kind: 'handoff', text: TASK, to: 'Booty' }], WREN, ROSTER)
    await rooms.applyTaskOps(room.roomId, [{ kind: 'claim', text: TASK }], BOOTY, ROSTER)
    expect((await rooms.get(room.roomId))!.tasks[0]!.handedBy).toBeUndefined()
    expect((await rooms.applyTaskOps(room.roomId, [{ kind: 'handoff', text: TASK, to: 'Wren' }], BOOTY, ROSTER)).changed).toHaveLength(1)
    // Wren now has it from Booty; a person moves it to Booty and the rule does not stand in the way.
    const task = (await rooms.get(room.roomId))!.tasks[0]!
    await rooms.updateTask({ roomId: room.roomId, op: 'assign', taskId: task.taskId, ownerId: 'tm_booty' })
    const moved = (await rooms.get(room.roomId))!.tasks[0]!
    expect(moved.ownerId).toBe('tm_booty')
    expect(moved.handedBy).toBeUndefined()
    expect((await rooms.applyTaskOps(room.roomId, [{ kind: 'handoff', text: TASK, to: 'Wren' }], BOOTY, ROSTER)).changed).toHaveLength(1)
  })

  it('is not handed to yourself: that is a claim', async () => {
    const rooms = await store()
    const room = await rooms.create({ name: 'Release', teammateIds: ['tm_wren', 'tm_booty'] })
    const self = await rooms.applyTaskOps(room.roomId, [{ kind: 'handoff', text: TASK, to: 'Wren' }], WREN, ROSTER)
    expect(self.refused).toEqual([`Wren handed "${TASK}" to themselves; to take it on, claim it.`])
    expect((await rooms.get(room.roomId))!.tasks).toEqual([])
  })

  it('is remembered across a restart: who handed it is on disk', async () => {
    const rooms = await store()
    const room = await rooms.create({ name: 'Release', teammateIds: ['tm_wren', 'tm_booty'] })
    await rooms.applyTaskOps(room.roomId, [{ kind: 'handoff', text: TASK, to: 'Booty' }], WREN, ROSTER)
    const again = createRoomStore({ rootDirectory: root, now: () => new Date('2026-09-24T13:00:00.000Z'), createId: () => 'later' })
    expect((await again.applyTaskOps(room.roomId, [{ kind: 'handoff', text: TASK, to: 'Wren' }], BOOTY, ROSTER)).refused).toHaveLength(1)
  })
})

describe('the board brief', () => {
  it('tells every member never to hand a task back to whoever handed it over', () => {
    const brief = taskSection({ selfName: 'Booty', roomName: 'Release', memberNames: ['Wren', 'Booty'], tasks: [] })
    expect(brief).toContain('Never hand a task back to the teammate who handed it to you')
  })
})
