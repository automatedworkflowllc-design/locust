import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { CodexMissionStartResponse, PublicRoutine } from '../shared/ipc.js'
import { nextRoutineDueLine, scheduleBase } from '../shared/routine-schedule.js'
import { routineScheduleSummary } from '../renderer/src/routines.js'
import { createRoutineRunner } from './routine-runner.js'
import type { RoutineRunnerOptions } from './routine-runner.js'
import { createRoutineStore } from './routine-store.js'
import type { MissionPeerContext } from './workroom-briefing.js'

/**
 * PAUSE A ROUTINE (0.705, from Paperclip's routine management). Paused, its
 * schedule does not start it and no miss is recorded; resumed, its clock
 * counts from the resume, so a week's pause does not fire on the spot.
 */

const WREN: MissionPeerContext = { self: { teammateId: 'tm_wren', name: 'Wren', role: 'Ops & Scheduling' }, others: [] }
const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

const saved = (over: Partial<PublicRoutine> = {}): PublicRoutine => ({
  routineId: 'rt_1', name: 'Morning digest', teammateId: 'tm_wren',
  route: { runtime: 'cursor', model: 'composer-2.5', mode: 'ask' },
  steps: ['Say good morning.'], learnedFrom: [],
  createdAt: new Date(2026, 9, 2, 8, 0).toISOString(), lastRunAt: new Date(2026, 9, 2, 8, 0).toISOString(),
  runs: 0, schedule: { kind: 'every', hours: 1 }, ...over
})

function harness(routine: PublicRoutine, openedAt: Date) {
  const held = new Map([[routine.routineId, routine]])
  const starts: unknown[] = []
  const misses: unknown[] = []
  const options = {
    workspaceId: 'ws_test', openedAt,
    routines: {
      get: async (id: unknown) => held.get(String(id)),
      list: async () => [...held.values()],
      recordRun: async () => undefined, saveProgress: async () => undefined, clearProgress: async () => undefined,
      abandon: async () => undefined, keepSchedule: async () => undefined,
      recordMiss: async (...args: unknown[]) => { misses.push(args) }
    },
    peerContextFor: async () => WREN,
    start: async () => { starts.push(true); return { ok: true, data: { missionId: 'mission_1', runId: 'run_1' } } as unknown as CodexMissionStartResponse },
    assignOwner: async () => undefined, phaseOf: async () => undefined, notify: () => undefined
  } as unknown as RoutineRunnerOptions
  return { held, starts, misses, options }
}

describe('a paused routine waits to be resumed', () => {
  it('is not started by its schedule and records no miss, however overdue', async () => {
    const h = harness(saved({ paused: true }), new Date(2026, 9, 2, 7, 0))
    expect(await createRoutineRunner(h.options).tick(new Date(2026, 9, 3, 9, 0))).toEqual([])
    expect(h.starts).toEqual([])
    expect(h.misses).toEqual([])
  })
  it('still starts when a person presses Run', async () => {
    const h = harness(saved({ paused: true }), new Date(2026, 9, 2, 7, 0))
    const ran = await createRoutineRunner(h.options).run('rt_1')
    expect(ran.ok).toBe(true)
    expect(h.starts).toEqual([true])
  })
  it('resumed, counts from the resume: a long-overdue hourly routine does not fire on the spot, and does an hour on', async () => {
    const resumedAt = new Date(2026, 9, 9, 10, 0)
    const h = harness(saved({ resumedAt: resumedAt.toISOString() }), new Date(2026, 9, 9, 9, 0))
    const runner = createRoutineRunner(h.options)
    expect(await runner.tick(new Date(2026, 9, 9, 10, 0, 30))).toEqual([])
    expect(h.misses).toEqual([])
    expect(await runner.tick(new Date(2026, 9, 9, 11, 0, 30))).toEqual(['rt_1'])
  })
  it('counts from its last run when that is later than an old resume', () => {
    expect(scheduleBase({ createdAt: '2026-10-01T00:00:00.000Z', lastRunAt: '2026-10-05T00:00:00.000Z', resumedAt: '2026-10-03T00:00:00.000Z' })).toBe('2026-10-05T00:00:00.000Z')
    expect(scheduleBase({ createdAt: '2026-10-01T00:00:00.000Z', resumedAt: '2026-10-03T00:00:00.000Z' })).toBe('2026-10-03T00:00:00.000Z')
    expect(scheduleBase({ createdAt: '2026-10-01T00:00:00.000Z' })).toBe('2026-10-01T00:00:00.000Z')
  })
  it('says "paused" on its chip, and the tray counts it out of "next"', () => {
    const now = new Date(2026, 9, 3, 9, 0)
    expect(routineScheduleSummary(saved({ paused: true }), now)).toBe('every hour · paused')
    expect(nextRoutineDueLine([saved({ paused: true, lastRunAt: now.toISOString() })], now)).toBe('No routine due')
  })
  it('keeps pause and resume in the routine file, and ignores what is not a yes or no', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'locust-pause-'))
    roots.push(directory)
    const store = createRoutineStore({ rootDirectory: directory })
    const made = await store.create({ name: 'Morning digest', teammateId: 'tm_wren', route: { runtime: 'cursor', model: 'composer-2.5', mode: 'ask' },
      steps: ['Say good morning.'], learnedFrom: [], schedule: { kind: 'daily', at: '08:00' } })
    const at = '2026-10-08T06:00:00.000Z'
    expect((await store.setPaused(made.routineId, true, at))?.paused).toBe(true)
    expect((await createRoutineStore({ rootDirectory: directory }).get(made.routineId))?.paused).toBe(true)
    for (const odd of ['true', 1, null]) expect(await store.setPaused(made.routineId, odd, at)).toBeUndefined()
    expect(await store.setPaused('rt_nobody', false, at)).toBeUndefined()
    const resumed = await store.setPaused(made.routineId, false, at)
    expect(resumed?.paused).toBeUndefined()
    expect(resumed?.resumedAt).toBe(at)
    const again = await createRoutineStore({ rootDirectory: directory }).get(made.routineId)
    expect(again?.paused).toBeUndefined()
    expect(again?.resumedAt).toBe(at)
    expect(again?.schedule).toEqual({ kind: 'daily', at: '08:00' })
  })
})
