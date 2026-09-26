import { describe, expect, it } from 'vitest'

import type { CodexMissionStartResponse, PublicRoutine } from '../shared/ipc.js'
import { createRoutineRunner } from './routine-runner.js'
import type { RoutineRunnerOptions } from './routine-runner.js'

/*
 * A ROUTINE STEP REFUSED AT THE TEAMMATE'S MONTHLY LIMIT (0.353) never
 * started, and the card must say that. Every refusal but a few preflight ones
 * was held as "Dispatch not confirmed ... Review external work before
 * proceeding" -- which sends a person to look for side effects of a step the
 * host provably refused before recording anything.
 */

const ROUTE = { runtime: 'opencode', model: 'opencode/some-paid-model', mode: 'accept-edits' } as const
const LIMIT = "Wren has reached this month's limit: $5.02 of $5.00. Raise the limit by editing Wren, or it starts again on October 1."

const routine = (steps: readonly string[]): PublicRoutine => ({
  routineId: 'rt_1',
  name: 'Nightly check',
  teammateId: 'tm_wren',
  route: ROUTE,
  steps,
  learnedFrom: [],
  createdAt: '2026-09-05T00:00:00.000Z',
  runs: 0
})

/** Step N's start answers `answers[N - 1]`; a routine store held in memory. */
const harness = (held: PublicRoutine, answers: readonly ('ok' | 'limit')[]) => {
  const map = new Map([[held.routineId, held]])
  const phases = new Map<string, 'completed'>()
  const notices: string[] = []
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
    start: async () => {
      counter += 1
      if (answers[counter - 1] === 'limit') return { ok: false, error: { code: 'SPEND_LIMIT_REACHED', message: LIMIT } }
      return { ok: true, data: { runId: `run_${String(counter)}`, missionId: `mission_${String(counter)}`, runtime: 'opencode', sandbox: 'workspace-write' } } as unknown as CodexMissionStartResponse
    },
    assignOwner: async () => undefined,
    phaseOf: async (missionId) => phases.get(missionId),
    askedAQuestion: async () => false,
    notify: (update) => {
      if (update.kind === 'relay-notice') notices.push(update.message)
    }
  }
  return { map, phases, notices, runner: createRoutineRunner(options) }
}

describe('a routine at the monthly limit', () => {
  it('step 1: nothing is held and nothing is recorded; the refusal is the answer', async () => {
    const h = harness(routine(['Check the build.', 'Say done.']), ['limit'])
    const response = await h.runner.run('rt_1')
    expect(response.ok).toBe(false)
    expect(!response.ok && response.error.message).toContain("reached this month's limit")
    expect(h.map.get('rt_1')?.execution).toBeUndefined()
  })

  it('a later step: held as NOT STARTED, with the limit in its own words, and able to go on', async () => {
    const h = harness(routine(['Check the build.', 'Say done.']), ['ok', 'limit'])
    await h.runner.run('rt_1')
    h.phases.set('mission_1', 'completed')
    await h.runner.onRunEnded({ missionId: 'mission_1' })
    const execution = h.map.get('rt_1')?.execution
    expect(execution?.status).toBe('held')
    expect(execution?.status === 'held' && execution.reason).toBe(`Step 2 was not started: ${LIMIT}`)
    expect(execution?.status === 'held' && execution.reason).not.toContain('Dispatch not confirmed')
    expect(execution?.status === 'held' && execution.canContinue).toBe(true)
    // And a reconcile -- the Routines screen runs one -- keeps the reason.
    await h.runner.reconcile()
    const after = h.map.get('rt_1')?.execution
    expect(after?.status === 'held' && after.reason).toBe(`Step 2 was not started: ${LIMIT}`)
  })
})
