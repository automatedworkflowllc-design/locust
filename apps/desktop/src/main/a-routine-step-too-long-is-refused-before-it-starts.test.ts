import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import type { CodexMissionStartResponse, PublicRoutine } from '../shared/ipc.js'
import { STEP_BUDGET } from '../shared/step-budget.js'
import { createRoutineRunner } from './routine-runner.js'
import type { RoutineRunnerOptions } from './routine-runner.js'
import { createRoutineStore } from './routine-store.js'

/*
 * A ROUTINE STEP TOO LONG TO SEND IS REFUSED BEFORE IT STARTS (A5.1).
 *
 * The store saved steps up to 20,000 characters; a run's message carries
 * about 8,000. A longer step was written down as dispatching, refused by the
 * mission service -- "Enter a mission between 1 and 8,000 characters." --
 * and from step 2 on held as "Dispatch not confirmed ... Review external
 * work": a person sent to look for side effects of a step that never began.
 */

const LONG = 'x'.repeat(STEP_BUDGET + 1)
const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})
const store = async () => {
  const rootDirectory = await mkdtemp(join(tmpdir(), 'locust-longstep-'))
  roots.push(rootDirectory)
  return { rootDirectory, routines: createRoutineStore({ rootDirectory }) }
}
const ROUTE = { runtime: 'cursor', model: 'composer-2.5', mode: 'ask' } as const
const fresh = (steps: readonly string[]) => ({ name: 'Nightly tidy', teammateId: 'tm_wren', route: ROUTE, steps, learnedFrom: ['mission_1'] })

describe('saving', () => {
  it('refuses a step longer than a run can send, naming the step and the room', async () => {
    const { routines } = await store()
    await expect(routines.create(fresh(['Fine.', LONG]))).rejects.toThrow(`Step 2 is ${(STEP_BUDGET + 1).toLocaleString('en-US')} characters; a step can be at most ${STEP_BUDGET.toLocaleString('en-US')}.`)
    const saved = await routines.create(fresh(['Fine.']))
    await expect(routines.update({ routineId: saved.routineId, name: 'Nightly tidy', steps: [LONG] })).rejects.toThrow('Step 1 is')
  })

  it('still reads a routine saved before, with a step up to 20,000', async () => {
    const { rootDirectory, routines } = await store()
    const old = { routineId: 'rt_old', name: 'Old', teammateId: 'tm_wren', route: ROUTE, steps: ['x'.repeat(12_000)], learnedFrom: [], createdAt: '2026-09-05T00:00:00.000Z', runs: 0 }
    await writeFile(join(rootDirectory, 'routines.json'), JSON.stringify({ schemaVersion: 1, routines: [old] }), 'utf8')
    expect((await routines.list()).map((routine) => routine.routineId)).toEqual(['rt_old'])
  })
})

describe('running one saved before', () => {
  const routine = (steps: readonly string[]): PublicRoutine => ({
    routineId: 'rt_1',
    name: 'Nightly tidy',
    teammateId: 'tm_wren',
    route: ROUTE,
    steps,
    learnedFrom: [],
    createdAt: '2026-09-05T00:00:00.000Z',
    runs: 0
  })
  const harness = (held: PublicRoutine) => {
    const map = new Map([[held.routineId, held]])
    const starts: unknown[] = []
    const notices: string[] = []
    const phases = new Map<string, 'completed'>()
    let counter = 0
    const options: RoutineRunnerOptions = {
      workspaceId: 'ws_test',
      routines: {
        get: async (id) => map.get(String(id)),
        list: async () => [...map.values()],
        recordRun: async () => undefined,
        saveProgress: async (id, execution) => {
          map.set(id, { ...map.get(id)!, execution })
        },
        clearProgress: async (id) => {
          const { execution: _execution, ...rest } = map.get(id)!
          map.set(id, rest)
        },
        abandon: async () => undefined
      },
      peerContextFor: async () => ({ self: { teammateId: 'tm_wren', name: 'Wren', role: 'Code & Migrations' }, others: [] }),
      start: async (request) => {
        starts.push(request)
        counter += 1
        return { ok: true, data: { runId: `run_${String(counter)}`, missionId: `mission_${String(counter)}`, runtime: 'cursor', sandbox: 'read-only' } } as unknown as CodexMissionStartResponse
      },
      assignOwner: async () => undefined,
      phaseOf: async (missionId) => phases.get(missionId),
      askedAQuestion: async () => false,
      notify: (update) => {
        if (update.kind === 'relay-notice') notices.push(update.message)
      }
    }
    return { map, starts, notices, phases, runner: createRoutineRunner(options) }
  }

  it('step 1: refused with the reason, nothing started, nothing recorded', async () => {
    const h = harness(routine([LONG, 'Say done.']))
    const response = await h.runner.run('rt_1')
    // Run reports every refusal as the routine's; the reason rides in the message.
    expect(response).toMatchObject({ ok: false, error: { code: 'ROUTINE_REJECTED' } })
    expect(!response.ok && response.error.message).toContain('Step 1 is too long to send')
    expect(!response.ok && response.error.message).toContain('Nothing was started.')
    expect(h.starts).toEqual([])
    expect(h.map.get('rt_1')?.execution).toBeUndefined()
  })

  it('step 2: held for what it is -- too long, nothing started -- not as an uncertain dispatch', async () => {
    const h = harness(routine(['Read status.ts.', LONG]))
    await h.runner.run('rt_1')
    h.phases.set('mission_1', 'completed')
    await h.runner.onRunEnded({ missionId: 'mission_1' })
    expect(h.starts).toHaveLength(1)
    const execution = h.map.get('rt_1')?.execution
    expect(execution?.status).toBe('held')
    expect(execution?.status === 'held' && execution.reason).toContain('Step 2 is too long to send')
    expect(execution?.status === 'held' && execution.reason).not.toContain('Dispatch not confirmed')
    expect(h.notices.at(-1)).toContain('stopped before step 2 of 2: Step 2 is too long to send')
  })
})
