import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { CodexMissionStartResponse, PublicRoutine } from '../shared/ipc.js'
import { createRoutineRunner } from './routine-runner.js'
import type { RoutineRunnerOptions } from './routine-runner.js'
import { createRoutineStore } from './routine-store.js'
import type { MissionPeerContext } from './workroom-briefing.js'

/**
 * No catch-up. A routine whose time passed while Locust was closed shows as
 * missed and does not start at launch. Record the miss in the routine's history.
 * A time that arrives while Locust is open still starts.
 */

const WREN: MissionPeerContext = {
  self: { teammateId: 'tm_wren', name: 'Wren', role: 'Ops & Scheduling' },
  others: []
}

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

const saved = (over: Partial<PublicRoutine> = {}): PublicRoutine => ({
  routineId: 'rt_1',
  name: 'Morning digest',
  teammateId: 'tm_wren',
  route: { runtime: 'cursor', model: 'composer-2.5', mode: 'ask' },
  steps: ['Say good morning.'],
  learnedFrom: [],
  createdAt: new Date(2026, 9, 2, 8, 0).toISOString(),
  lastRunAt: new Date(2026, 9, 2, 8, 0).toISOString(),
  runs: 0,
  schedule: { kind: 'daily', at: '08:00' },
  ...over
})

function harness(routine: PublicRoutine, openedAt: Date) {
  const held = new Map([[routine.routineId, routine]])
  const starts: unknown[] = []
  const options: RoutineRunnerOptions = {
    workspaceId: 'ws_test',
    openedAt,
    routines: {
      get: async (id) => held.get(String(id)),
      list: async () => [...held.values()],
      recordRun: async () => undefined,
      saveProgress: async () => undefined,
      clearProgress: async () => undefined,
      abandon: async () => undefined,
      keepSchedule: async () => undefined,
      recordMiss: async (id, dueAt, recordedAt) => {
        const entry = held.get(String(id))
        if (entry === undefined) return
        held.set(String(id), {
          ...entry,
          lastRunAt: dueAt,
          missedAt: dueAt,
          history: [...(entry.history ?? []), { kind: 'missed', dueAt, recordedAt }]
        })
      }
    },
    peerContextFor: async () => WREN,
    start: async () => {
      starts.push(true)
      return { ok: true, data: { missionId: 'mission_1', runId: 'run_1' } } as unknown as CodexMissionStartResponse
    },
    assignOwner: async () => undefined,
    phaseOf: async () => undefined,
    notify: () => undefined
  }
  return { held, starts, options }
}

describe('a routine whose time passed while Locust was closed', () => {
  it('is missed and not started, and one that comes due while Locust is open still starts', async () => {
    const opened = new Date(2026, 9, 3, 9, 0, 0)
    const closed = harness(saved(), opened)
    const runner = createRoutineRunner(closed.options)
    expect(await runner.tick(new Date(2026, 9, 3, 9, 0, 15))).toEqual([])
    expect(closed.starts).toEqual([])
    const missed = await closed.options.routines.get('rt_1')
    expect(missed?.runs).toBe(0)
    expect(missed?.missedAt).toBe(new Date(2026, 9, 3, 8, 0, 0).toISOString())
    expect(missed?.history).toEqual([
      { kind: 'missed', dueAt: new Date(2026, 9, 3, 8, 0, 0).toISOString(), recordedAt: new Date(2026, 9, 3, 9, 0, 15).toISOString() }
    ])
    // The next tick does not start it either: the miss moved the clock.
    expect(await runner.tick(new Date(2026, 9, 3, 9, 1, 0))).toEqual([])
    expect(closed.starts).toEqual([])

    const open = harness(saved(), new Date(2026, 9, 3, 7, 0, 0))
    expect(await createRoutineRunner(open.options).tick(new Date(2026, 9, 3, 8, 0, 15))).toEqual(['rt_1'])
    expect(open.starts).toEqual([true])
  })

  it('records one miss for several missed hours, and does not start on the next tick', async () => {
    const opened = new Date(2026, 9, 3, 15, 0, 0)
    const routine = saved({
      schedule: { kind: 'every', hours: 1 },
      lastRunAt: new Date(2026, 9, 3, 10, 0, 0).toISOString()
    })
    const h = harness(routine, opened)
    const runner = createRoutineRunner(h.options)
    expect(await runner.tick(opened)).toEqual([])
    expect(h.starts).toEqual([])
    const missed = await h.options.routines.get('rt_1')
    expect(missed?.history).toHaveLength(1)
    expect(missed?.missedAt).toBe(new Date(2026, 9, 3, 15, 0, 0).toISOString())
    expect(await runner.tick(new Date(2026, 9, 3, 15, 1, 0))).toEqual([])
    expect(h.starts).toEqual([])
    expect((await h.options.routines.get('rt_1'))?.history).toHaveLength(1)
  })

  it('keeps the miss in the routine file, and a later read still has it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'locust-miss-'))
    roots.push(directory)
    const store = createRoutineStore({ rootDirectory: directory })
    const made = await store.create({
      name: 'Morning digest',
      teammateId: 'tm_wren',
      route: { runtime: 'cursor', model: 'composer-2.5', mode: 'ask' },
      steps: ['Say good morning.'],
      learnedFrom: [],
      schedule: { kind: 'daily', at: '08:00' }
    })
    const dueAt = new Date(2026, 9, 3, 8, 0, 0).toISOString()
    const recordedAt = new Date(2026, 9, 3, 9, 0, 0).toISOString()
    await store.recordMiss(made.routineId, dueAt, recordedAt)
    const again = await createRoutineStore({ rootDirectory: directory }).get(made.routineId)
    expect(again?.runs).toBe(0)
    expect(again?.missedAt).toBe(dueAt)
    expect(again?.history).toEqual([{ kind: 'missed', dueAt, recordedAt }])
  })
})
