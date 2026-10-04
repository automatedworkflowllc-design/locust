import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { routineAwaitsReview } from '../shared/routine-recovery.js'
import { createRoutineStore } from './routine-store.js'

/**
 * H2 (second half): a routine whose last attempt is unsettled -- held for the
 * person's review, or still dispatching or running -- is not removed out from
 * under it. Remove used to delete it and its uncertain-attempt record in one
 * press, skipping the checkbox the review card puts in front of Abandon.
 */
let root: string | undefined
afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true })
})
const ROUTE = { runtime: 'cursor', model: 'composer-2.5', mode: 'ask' } as const

async function withAttempt(status: 'dispatching' | 'running' | 'held' | 'abandoned' | undefined) {
  root = await mkdtemp(join(tmpdir(), 'locust-routine-review-'))
  const store = createRoutineStore({ rootDirectory: root })
  const routine = await store.create({ name: 'Nightly report', teammateId: 'tm_wren', route: ROUTE, steps: ['Summarise the day.'], learnedFrom: ['mission_1'] })
  if (status !== undefined) {
    await store.saveProgress(routine.routineId, {
      attemptId: 'attempt_1', step: 1, of: 1, status: status === 'abandoned' ? 'held' : status, workspaceId: 'ws_test',
      startedAt: routine.createdAt, updatedAt: routine.createdAt, steps: routine.steps, route: routine.route
    }, null)
    if (status === 'abandoned') await store.abandon(routine.routineId, 'attempt_1')
  }
  return { store, routine: (await store.get(routine.routineId))! }
}

describe('removing a routine', () => {
  for (const status of ['dispatching', 'running', 'held'] as const) {
    it(`is refused while its last attempt is ${status}, and the routine stays`, async () => {
      const { store, routine } = await withAttempt(status)
      expect(routineAwaitsReview(routine)).toBe(true)
      await expect(store.remove(routine.routineId)).rejects.toThrow('waiting for your review')
      expect(await store.get(routine.routineId)).toBeDefined()
    })
  }

  it('goes once the attempt is abandoned, or when there never was one', async () => {
    const abandoned = await withAttempt('abandoned')
    expect(routineAwaitsReview(abandoned.routine)).toBe(false)
    await abandoned.store.remove(abandoned.routine.routineId)
    expect(await abandoned.store.list()).toEqual([])

    const plain = await withAttempt(undefined)
    await plain.store.remove(plain.routine.routineId)
    expect(await plain.store.list()).toEqual([])
  })
})
