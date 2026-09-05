import { describe, expect, it } from 'vitest'

import type { CodexMissionStartResponse, CodexMissionUpdate, PublicRoutine } from '../shared/ipc.js'
import { createRoutineRunner } from './routine-runner.js'
import type { RoutineRunnerOptions } from './routine-runner.js'
import type { MissionPeerContext } from './workroom-briefing.js'

const WREN: MissionPeerContext = {
  self: { teammateId: 'tm_wren', name: 'Wren', role: 'Code & Migrations' },
  others: []
}

const routine = (overrides: Partial<PublicRoutine> = {}): PublicRoutine => ({
  routineId: 'rt_1',
  name: 'Nightly tidy',
  teammateId: 'tm_wren',
  route: { runtime: 'cursor', model: 'composer-2.5', mode: 'ask' },
  steps: ['Read status.ts.', 'List every file.', 'Say done.'],
  learnedFrom: ['mission_a', 'mission_b', 'mission_c'],
  createdAt: '2026-09-05T00:00:00.000Z',
  runs: 0,
  ...overrides
})

interface Harness {
  readonly starts: Parameters<RoutineRunnerOptions['start']>[0][]
  readonly updates: CodexMissionUpdate[]
  readonly phases: Map<string, 'completed' | 'failed' | 'cancelled' | 'interrupted'>
  readonly runs: string[]
  readonly options: RoutineRunnerOptions
}

function harness(input: {
  readonly routines?: readonly PublicRoutine[]
  readonly peer?: MissionPeerContext | undefined
  readonly startFails?: boolean
} = {}): Harness {
  const starts: Harness['starts'] = []
  const updates: CodexMissionUpdate[] = []
  const phases = new Map<string, 'completed' | 'failed' | 'cancelled' | 'interrupted'>()
  const runs: string[] = []
  let counter = 0
  const held = new Map((input.routines ?? [routine()]).map((entry) => [entry.routineId, entry]))
  const options: RoutineRunnerOptions = {
    routines: {
      get: async (id) => held.get(String(id)),
      recordRun: async (id) => {
        runs.push(String(id))
      }
    },
    peerContextFor: async () => ('peer' in input ? input.peer : WREN),
    start: async (request) => {
      starts.push(request)
      if (input.startFails === true) {
        return { ok: false, error: { code: 'RUNTIME_START_FAILED', message: 'no runtime' } } as CodexMissionStartResponse
      }
      counter += 1
      return {
        ok: true,
        data: {
          runId: `run_${String(counter)}`,
          missionId: `mission_${String(counter)}`,
          runtime: request.runtime,
          sandbox: 'read-only',
          model: request.model
        }
      } as unknown as CodexMissionStartResponse
    },
    assignOwner: async () => undefined,
    phaseOf: async (missionId) => phases.get(missionId),
    notify: (update) => {
      updates.push(update)
    }
  }
  return { starts, updates, phases, runs, options }
}

const notices = (h: Harness): string[] =>
  h.updates.flatMap((update) => (update.kind === 'relay-notice' ? [update.message] : []))

describe('running a routine', () => {
  it('starts step 1 on the routine route, recorded as the routine, and counts the run', async () => {
    const h = harness()
    const runner = createRoutineRunner(h.options)
    const response = await runner.run('rt_1')
    expect(response).toEqual({ ok: true, data: { missionId: 'mission_1', runId: 'run_1' } })
    expect(h.starts).toHaveLength(1)
    expect(h.starts[0]).toMatchObject({
      prompt: 'Read status.ts.',
      runtime: 'cursor',
      model: 'composer-2.5',
      mode: 'ask',
      followUpOf: undefined,
      startedBy: { kind: 'routine', routineId: 'rt_1', step: 1 }
    })
    expect(h.runs).toEqual(['rt_1'])
    const started = h.updates.find((update) => update.kind === 'mission-started')
    expect(started).toMatchObject({ teammateId: 'tm_wren', startedBy: { kind: 'routine', routineId: 'rt_1', step: 1 } })
    expect(runner.running()).toEqual([expect.objectContaining({ routineId: 'rt_1', step: 1, of: 3, missionId: 'mission_1' })])
    expect(notices(h)[0]).toContain('step 1 of 3')
  })

  it('each later step follows up the one before it, and only after it COMPLETED', async () => {
    const h = harness()
    const runner = createRoutineRunner(h.options)
    await runner.run('rt_1')
    // Some other mission ending moves nothing.
    await runner.onRunEnded({ missionId: 'mission_stranger' })
    expect(h.starts).toHaveLength(1)

    h.phases.set('mission_1', 'completed')
    await runner.onRunEnded({ missionId: 'mission_1' })
    expect(h.starts).toHaveLength(2)
    expect(h.starts[1]).toMatchObject({
      prompt: 'List every file.',
      followUpOf: 'mission_1',
      startedBy: { kind: 'routine', routineId: 'rt_1', step: 2 }
    })
    expect(runner.running()[0]).toMatchObject({ step: 2, missionId: 'mission_2' })

    h.phases.set('mission_2', 'completed')
    await runner.onRunEnded({ missionId: 'mission_2' })
    expect(h.starts[2]).toMatchObject({ prompt: 'Say done.', followUpOf: 'mission_2', startedBy: { step: 3 } })

    h.phases.set('mission_3', 'completed')
    await runner.onRunEnded({ missionId: 'mission_3' })
    expect(h.starts).toHaveLength(3)
    expect(runner.running()).toEqual([])
    expect(notices(h).at(-1)).toBe('Routine "Nightly tidy" finished: 3 steps completed.')
    // One run counted, however many steps.
    expect(h.runs).toEqual(['rt_1'])
  })

  it('a step that failed, was stopped or was interrupted ends the routine there and says which', async () => {
    for (const [phase, words] of [
      ['failed', 'that run failed'],
      ['cancelled', 'that run was stopped'],
      ['interrupted', 'that run was interrupted']
    ] as const) {
      const h = harness()
      const runner = createRoutineRunner(h.options)
      await runner.run('rt_1')
      h.phases.set('mission_1', phase)
      await runner.onRunEnded({ missionId: 'mission_1' })
      expect(h.starts).toHaveLength(1)
      expect(runner.running()).toEqual([])
      expect(notices(h).at(-1)).toBe(`Routine "Nightly tidy" stopped at step 1 of 3: ${words}.`)
    }
  })

  it('a record it cannot read is not a completion', async () => {
    const h = harness()
    const runner = createRoutineRunner(h.options)
    await runner.run('rt_1')
    await runner.onRunEnded({ missionId: 'mission_1' })
    expect(h.starts).toHaveLength(1)
    expect(notices(h).at(-1)).toContain('the record of that run could not be read')
  })

  it('a correction made while it runs is what the next step uses', async () => {
    const edited = routine({ steps: ['Read status.ts.', 'Now list only .ts files.'] })
    const h = harness({ routines: [routine()] })
    const runner = createRoutineRunner(h.options)
    await runner.run('rt_1')
    // The store now holds the edited routine.
    h.options.routines.get = async () => edited
    h.phases.set('mission_1', 'completed')
    await runner.onRunEnded({ missionId: 'mission_1' })
    expect(h.starts[1]?.prompt).toBe('Now list only .ts files.')
    h.phases.set('mission_2', 'completed')
    await runner.onRunEnded({ missionId: 'mission_2' })
    expect(notices(h).at(-1)).toBe('Routine "Nightly tidy" finished: 2 steps completed.')
  })

  it('refuses what it cannot honestly run, with the reason', async () => {
    const missing = createRoutineRunner(harness().options)
    expect(await missing.run('rt_nope')).toMatchObject({ ok: false, error: { message: 'That routine no longer exists.' } })

    const gone = createRoutineRunner(harness({ peer: undefined }).options)
    expect(await gone.run('rt_1')).toMatchObject({ ok: false, error: { message: expect.stringContaining('no longer exists') } })

    const antigravity = createRoutineRunner(
      harness({ routines: [routine({ route: { runtime: 'antigravity', model: 'x', mode: 'accept-edits' } })] }).options
    )
    expect(await antigravity.run('rt_1')).toMatchObject({ ok: false, error: { message: expect.stringContaining('antigravity') } })

    const failing = harness({ startFails: true })
    const runner = createRoutineRunner(failing.options)
    expect(await runner.run('rt_1')).toMatchObject({ ok: false, error: { message: 'no runtime' } })
    expect(runner.running()).toEqual([])
    expect(failing.runs).toEqual([])
  })

  it('one routine at a time per teammate', async () => {
    const h = harness({ routines: [routine(), routine({ routineId: 'rt_2', name: 'Other' })] })
    const runner = createRoutineRunner(h.options)
    await runner.run('rt_1')
    const second = await runner.run('rt_2')
    expect(second).toMatchObject({ ok: false, error: { message: expect.stringContaining('already running') } })
    expect(h.starts).toHaveLength(1)
  })
})
