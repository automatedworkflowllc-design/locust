import { describe, expect, it } from 'vitest'

import type { EndedMission, SharingMission } from './relay.js'
import { createRunEnd } from './run-end.js'

/**
 * A2.14: A RUN'S END, IN ORDER, EACH ON ITS OWN.
 *
 * The code review's reported #16: the run's memory was applied after the
 * relay had already started the next teammate, and one handler throwing
 * skipped every handler after it.
 */
const mission: EndedMission = { missionId: 'mission_1', peer: undefined, relay: undefined }
const sharing = { ...mission, runId: 'run_1', runtime: 'claude', sandbox: 'read-only', model: 'haiku', peer: { self: { teammateId: 'tm_wren', name: 'Wren', role: 'Code' }, others: [] } } as unknown as SharingMission

function chain(failing?: string) {
  const order: string[] = []
  const notes: string[] = []
  const step = (label: string) => ({
    async onRunEnded() {
      order.push(label)
      if (failing === label) throw new Error(`${label} broke`)
    }
  })
  const end = createRunEnd({
    memory: () => step('memory'),
    relay: () => ({
      async onShared() {
        order.push('relay share')
        if (failing === 'relay share') throw new Error('relay share broke')
      },
      ...step('relay')
    }),
    after: [
      { label: 'routine', step: () => step('routine') },
      { label: 'room tasks', step: () => step('room tasks') },
      { label: 'attention', step: () => step('attention') }
    ],
    note: (_label, detail) => notes.push(detail)
  })
  return { end, order, notes }
}

describe("a run's end", () => {
  it('remembers before the relay starts anyone, from a share', async () => {
    const { end, order } = chain()
    await end.onShared(sharing, [])
    expect(order).toEqual(['memory', 'relay share'])
  })

  it('remembers once, whether the share or the end came first', async () => {
    const { end, order } = chain()
    await end.onShared(sharing, [])
    await end.onRunEnded(mission)
    expect(order.filter((label) => label === 'memory')).toHaveLength(1)
    expect(order).toEqual(['memory', 'relay share', 'relay', 'routine', 'room tasks', 'attention'])
  })

  it('runs every step when one throws, and says which failed', async () => {
    const { end, order, notes } = chain('relay')
    await end.onRunEnded(mission)
    expect(order).toEqual(['memory', 'relay', 'routine', 'room tasks', 'attention'])
    expect(notes).toEqual(['relay failed for mission_1: relay broke'])
  })

  it('still starts the recipient when remembering fails', async () => {
    const { end, order, notes } = chain('memory')
    await end.onShared(sharing, [])
    expect(order).toEqual(['memory', 'relay share'])
    expect(notes).toEqual(['memory failed for mission_1: memory broke'])
  })
})
