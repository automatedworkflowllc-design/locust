import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { slotPassedDuring } from '../shared/routine-schedule.js'
import { createRoutineStore } from './routine-store.js'

/**
 * A TIME THAT PASSED WHILE THE ROUTINE WAS STILL RUNNING IS MISSED, NOT LOST (0.690).
 *
 * The runner never starts a routine over its own running copy. When that
 * copy ended, its last run became the end, so a daily 08:00 that came while
 * a 07:50 run was still going was neither run nor recorded: no Missed line,
 * no Run now (Grok's read of 0.687). The end now records it as a miss, the
 * way a time that passed while Locust was closed is recorded.
 */
const roots: string[] = []
afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(roots.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

const at = (hour: number, minute: number, day = 7): Date => new Date(2026, 9, day, hour, minute)

describe('a clock time that passed during a run', () => {
  it('is the daily time between the start and the end, and nothing when the run began at or after it', () => {
    const daily = { kind: 'daily', at: '08:00' } as const
    expect(slotPassedDuring(daily, at(7, 50).toISOString(), at(8, 20))?.toISOString()).toBe(at(8, 0).toISOString())
    // The run that 08:00 itself started.
    expect(slotPassedDuring(daily, at(8, 0).toISOString(), at(8, 40))).toBeUndefined()
    // Ended before the time came.
    expect(slotPassedDuring(daily, at(7, 10).toISOString(), at(7, 40))).toBeUndefined()

    // Across midnight: a 23:30 that came while a 23:00 run went past 00:00 (2026-10-10 sweep).
    const late = { kind: 'daily', at: '23:30' } as const
    expect(slotPassedDuring(late, at(23, 0).toISOString(), at(0, 30, 8))?.toISOString()).toBe(at(23, 30).toISOString())
  })

  it('is a weekly time on its day, and never an interval or a file', () => {
    // 2026-10-07 is a Wednesday.
    expect(slotPassedDuring({ kind: 'weekly', days: [3], at: '09:00' }, at(8, 45).toISOString(), at(9, 30))?.toISOString()).toBe(at(9, 0).toISOString())
    expect(slotPassedDuring({ kind: 'weekly', days: [4], at: '09:00' }, at(8, 45).toISOString(), at(9, 30))).toBeUndefined()
    // Every N hours counts from the last run's end: a long run delays the next one, it drops nothing.
    expect(slotPassedDuring({ kind: 'every', hours: 1 }, at(8, 0).toISOString(), at(10, 30))).toBeUndefined()
    expect(slotPassedDuring({ kind: 'files', folder: 'C:/inbox' } as never, at(8, 0).toISOString(), at(10, 30))).toBeUndefined()
  })
})

describe("the routine's record when the run ends", () => {
  it('says Missed for the time that passed, counts the run, and keeps it in the history', async () => {
    const root = await mkdtemp(join(tmpdir(), 'locust-overlap-'))
    roots.push(root)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(at(7, 50))
    const store = createRoutineStore({ rootDirectory: root })
    const routine = await store.create({
      name: 'Morning digest',
      teammateId: 'tm_wren',
      route: { runtime: 'cursor', model: 'composer-2.5', mode: 'ask' },
      steps: ['Say good morning.'],
      learnedFrom: [],
      schedule: { kind: 'daily', at: '08:00' }
    } as never)
    await store.saveProgress(routine.routineId, { attemptId: 'attempt_1', step: 1, of: 1, status: 'running', missionId: 'mission_1',
      runId: 'run_1', workspaceId: 'ws_test', startedAt: at(7, 50).toISOString(), updatedAt: at(7, 50).toISOString(),
      steps: routine.steps, route: routine.route }, null)
    vi.setSystemTime(at(8, 20))
    await store.recordRun(routine.routineId, 'attempt_1')
    const ended = await store.get(routine.routineId)
    expect(ended?.runs).toBe(1)
    expect(ended?.lastRunAt).toBe(at(8, 20).toISOString())
    expect(ended?.missedAt).toBe(at(8, 0).toISOString())
    expect(ended?.history).toEqual([{ kind: 'missed', dueAt: at(8, 0).toISOString(), recordedAt: at(8, 20).toISOString() }])
  })

  it('records nothing missed for a run that ended before its next time', async () => {
    const root = await mkdtemp(join(tmpdir(), 'locust-overlap-'))
    roots.push(root)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(at(8, 0))
    const store = createRoutineStore({ rootDirectory: root })
    const routine = await store.create({
      name: 'Morning digest',
      teammateId: 'tm_wren',
      route: { runtime: 'cursor', model: 'composer-2.5', mode: 'ask' },
      steps: ['Say good morning.'],
      learnedFrom: [],
      schedule: { kind: 'daily', at: '08:00' }
    } as never)
    await store.saveProgress(routine.routineId, { attemptId: 'attempt_1', step: 1, of: 1, status: 'running', missionId: 'mission_1',
      runId: 'run_1', workspaceId: 'ws_test', startedAt: at(8, 0).toISOString(), updatedAt: at(8, 0).toISOString(),
      steps: routine.steps, route: routine.route }, null)
    vi.setSystemTime(at(8, 30))
    await store.recordRun(routine.routineId, 'attempt_1')
    const ended = await store.get(routine.routineId)
    expect(ended?.missedAt).toBeUndefined()
    expect(ended?.history ?? []).toEqual([])
  })
})
