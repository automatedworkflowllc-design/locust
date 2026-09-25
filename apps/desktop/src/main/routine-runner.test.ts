import { describe, expect, it } from 'vitest'

import type { CodexMissionStartResponse, CodexMissionUpdate, PublicRoutine } from '../shared/ipc.js'
import { SCHEDULE_HOLD_OFF_MS, createRoutineRunner } from './routine-runner.js'
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
  /** Missions whose final message carried a decision block. */
  readonly asked: Set<string>
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
  /** Missions whose final message carried a decision block. */
  const asked = new Set<string>()
  const runs: string[] = []
  let counter = 0
  const held = new Map((input.routines ?? [routine()]).map((entry) => [entry.routineId, entry]))
  const options: RoutineRunnerOptions = {
    workspaceId: 'ws_test',
    routines: {
      get: async (id) => held.get(String(id)),
      list: async () => [...held.values()],
      recordRun: async (id) => {
        runs.push(String(id))
        const entry = held.get(String(id))!
        const { execution: _execution, ...rest } = entry
        held.set(String(id), { ...rest, runs: entry.runs + 1, lastRunAt: new Date().toISOString() })
      },
      saveProgress: async (id, execution) => { held.set(id, { ...held.get(id)!, execution }) },
      clearProgress: async (id) => {
        const { execution: _execution, ...rest } = held.get(id)!
        held.set(id, rest)
      },
      abandon: async (id) => {
        const { schedule: _schedule, ...rest } = held.get(id)!
        held.set(id, { ...rest, execution: { ...rest.execution!, status: 'abandoned' } })
      }
    },
    peerContextFor: async () => ('peer' in input ? input.peer : WREN),
    start: async (request) => {
      starts.push(request)
      if (input.startFails === true) {
        // An unavailable runtime is a preflight refusal, not an uncertain spawn.
        return { ok: false, error: { code: 'CODEX_UNAVAILABLE', message: 'no runtime' } } as CodexMissionStartResponse
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
    askedAQuestion: async (missionId) => asked.has(missionId),
    notify: (update) => {
      updates.push(update)
    }
  }
  return { starts, updates, phases, runs, asked, options }
}

const notices = (h: Harness): string[] =>
  h.updates.flatMap((update) => (update.kind === 'relay-notice' ? [update.message] : []))

describe('running a routine', () => {
  it('starts step 1 on the routine route, recorded as the routine, but counts only completion', async () => {
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
    // Contract changed deliberately: starting step 1 is not a completed routine.
    expect(h.runs).toEqual([])
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
    const read = h.options.routines.get
    h.options.routines.get = async (id) => ({ ...edited, ...((await read(id))?.execution === undefined ? {} : { execution: (await read(id))!.execution! }) })
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

describe('a routine that runs on its own', () => {
  const NOON = new Date('2026-09-05T12:00:00.000Z')

  /** A harness whose store keeps lastRunAt, so a second tick sees the first. */
  function scheduled(input: { readonly routines: readonly PublicRoutine[]; readonly busy?: readonly string[]; readonly startFails?: boolean; readonly homeOf?: RoutineRunnerOptions['homeOf'] }) {
    const base = harness({ routines: input.routines, ...(input.startFails === true ? { startFails: true } : {}) })
    const held = new Map(input.routines.map((entry) => [entry.routineId, entry]))
    let clock = NOON
    const options: RoutineRunnerOptions = {
      ...base.options,
      routines: {
        ...base.options.routines,
        get: async (id) => held.get(String(id)),
        list: async () => [...held.values()],
        saveProgress: async (id, execution) => { held.set(id, { ...held.get(id)!, execution }) },
        clearProgress: async (id) => {
          const { execution: _execution, ...rest } = held.get(id)!
          held.set(id, rest)
        },
        recordRun: async (id) => {
          base.runs.push(String(id))
          const routine = held.get(String(id))
          if (routine !== undefined) {
            const { execution: _execution, ...rest } = routine
            held.set(routine.routineId, { ...rest, runs: routine.runs + 1, lastRunAt: clock.toISOString() })
          }
        }
      },
      // The real peer context is the routine's own teammate; the base stub answers Wren for everyone.
      peerContextFor: async (teammateId) => ({ self: { teammateId, name: 'Wren', role: 'Code & Migrations' }, others: [] }),
      teammateBusy: async (teammateId) => (input.busy ?? []).includes(teammateId),
      ...(input.homeOf === undefined ? {} : { homeOf: input.homeOf })
    }
    const runner = createRoutineRunner(options)
    return {
      ...base,
      runner,
      tick: (at: Date) => {
        clock = at
        return runner.tick(at)
      }
    }
  }

  it('a due routine starts on the tick as if Run were pressed; an undue one, and one with no schedule, do not', async () => {
    const h = scheduled({
      routines: [
        routine({ routineId: 'rt_due', teammateId: 'tm_a', schedule: { kind: 'every', hours: 2 }, createdAt: '2026-09-05T09:00:00.000Z' }),
        routine({ routineId: 'rt_soon', teammateId: 'tm_b', schedule: { kind: 'every', hours: 4 }, createdAt: '2026-09-05T09:00:00.000Z' }),
        routine({ routineId: 'rt_manual', teammateId: 'tm_c' })
      ]
    })
    expect(await h.tick(NOON)).toEqual(['rt_due'])
    expect(h.starts.map((start) => start.startedBy)).toEqual([{ kind: 'routine', routineId: 'rt_due', step: 1 }])
    // The old assertion counted a scheduled START. Only final completion counts.
    expect(h.runs).toEqual([])
    expect(h.updates.some((update) => update.kind === 'mission-started' && update.missionId === 'mission_1')).toBe(true)
    // The next minute: progress blocks a duplicate, not a premature lastRunAt.
    expect(await h.tick(new Date('2026-09-05T12:01:00.000Z'))).toEqual([])
    // Two hours on, rt_soon (four hours from nine) is due too, and rt_due is
    // still replaying step 1 so it waits.
    expect(await h.tick(new Date('2026-09-05T14:00:00.000Z'))).toEqual(['rt_soon'])
    expect(h.starts).toHaveLength(2)
  })

  /*
   * M15 (the code review): routines are global and a tick started a due one
   * in whichever folder was open -- a routine made to fix tests in project A
   * replayed its steps, in its write mode, in project B, with nobody there.
   */
  it('runs on its own only in the folder it was made in', async () => {
    const at = '2026-09-05T09:00:00.000Z'
    const h = scheduled({
      routines: [
        routine({ routineId: 'rt_here', teammateId: 'tm_a', schedule: { kind: 'every', hours: 1 }, createdAt: at, workspaceId: 'ws_test' }),
        routine({ routineId: 'rt_there', teammateId: 'tm_b', schedule: { kind: 'every', hours: 1 }, createdAt: at, workspaceId: 'ws_other' }),
        // Saved before the folder was recorded: found from the mission it was learned from.
        routine({ routineId: 'rt_old_there', teammateId: 'tm_c', schedule: { kind: 'every', hours: 1 }, createdAt: at, learnedFrom: ['mission_in_other'] }),
        routine({ routineId: 'rt_old_unknown', teammateId: 'tm_d', schedule: { kind: 'every', hours: 1 }, createdAt: at, learnedFrom: ['mission_gone'] })
      ],
      homeOf: async (entry) => entry.workspaceId ?? (entry.learnedFrom[0] === 'mission_in_other' ? 'ws_other' : undefined)
    })
    expect(await h.tick(NOON)).toEqual(['rt_here', 'rt_old_unknown'])
  })

  it("a teammate busy with a person's run is skipped and tried next tick, not queued and not held off", async () => {
    const busy = ['tm_wren']
    const h = scheduled({
      routines: [routine({ schedule: { kind: 'every', hours: 1 }, createdAt: '2026-09-05T09:00:00.000Z' })],
      busy
    })
    expect(await h.tick(NOON)).toEqual([])
    expect(h.starts).toHaveLength(0)
    busy.length = 0
    expect(await h.tick(new Date('2026-09-05T12:01:00.000Z'))).toEqual(['rt_1'])
  })

  it('a scheduled start that fails is held off for an hour rather than retried every minute', async () => {
    const h = scheduled({
      routines: [routine({ schedule: { kind: 'every', hours: 1 }, createdAt: '2026-09-05T09:00:00.000Z' })],
      startFails: true
    })
    expect(await h.tick(NOON)).toEqual([])
    expect(h.starts).toHaveLength(1)
    await h.tick(new Date(NOON.getTime() + 60_000))
    await h.tick(new Date(NOON.getTime() + SCHEDULE_HOLD_OFF_MS - 1))
    expect(h.starts).toHaveLength(1)
    await h.tick(new Date(NOON.getTime() + SCHEDULE_HOLD_OFF_MS))
    expect(h.starts).toHaveLength(2)
    // Nothing was recorded as a run: the routine still says it never ran.
    expect(h.runs).toEqual([])
  })

  it('daily at a time runs once that day, whichever minute the tick lands on', async () => {
    const h = scheduled({
      routines: [routine({ schedule: { kind: 'daily', at: '09:00' }, createdAt: '2026-09-01T00:00:00.000Z' })]
    })
    const local = (h2: number, m: number) => new Date(2026, 8, 5, h2, m, 0)
    expect(await h.tick(local(8, 59))).toEqual([])
    expect(await h.tick(local(9, 3))).toEqual(['rt_1'])
    // Step 1 completes; the routine is over (one step matters not -- three
    // steps run on, but the day's slot is spent either way).
    for (const at of [local(9, 4), local(13, 0), local(23, 59)]) {
      expect(await h.tick(at)).toEqual([])
    }
  })

  // --- a scheduled start that is refused (0.35.2 QA) ---
    // The runner held it off for an hour and tried again, silently, for as long
    // as the refusal lasted -- Auto revoked after the routine was saved, a
    // runtime signed out, anything. A scheduled run is the one nobody watches
    // start, so a refusal nobody is told about is a routine that has quietly
    // stopped happening. `index.ts` already carried a comment admitting it.

    /** One due routine, on a runner whose every start is refused. */
    const scheduledFailing = () =>
      scheduled({
        startFails: true,
        routines: [
          routine({
            routineId: 'rt_due',
            teammateId: 'tm_a',
            schedule: { kind: 'every', hours: 2 },
            createdAt: '2026-09-05T09:00:00.000Z'
          })
        ]
      })

    it('tells the window, names the routine, and says when it will try again', async () => {
      const h = scheduledFailing()
      await h.tick(NOON)
      const blocked = h.updates.filter((update) => update.kind === 'routine-blocked')
      expect(blocked).toHaveLength(1)
      const only = blocked[0]
      if (only?.kind !== 'routine-blocked') throw new Error('not a routine-blocked update')
      expect(only.name).toBe('Nightly tidy')
      expect(only.message).toContain('no runtime')
      expect(Date.parse(only.retryAt)).toBeGreaterThan(NOON.getTime())
    })

    it('says it once per attempt, not once per tick, because the hold-off holds', async () => {
      const h = scheduledFailing()
      await h.tick(NOON)
      await h.tick(new Date(NOON.getTime() + 60_000))
      expect(h.updates.filter((update) => update.kind === 'routine-blocked')).toHaveLength(1)
    })
})

describe('a routine step that ends by asking something', () => {
  it('stops there instead of starting the next step', async () => {
    /*
     * A turn that ends on a decision block completes normally -- exit 0, a
     * receipt, phase 'completed' -- so the runner read it as success and began
     * step 2. The person's answer then reached a teammate already working and
     * was refused as RUN_ALREADY_ACTIVE, so the routine carried on without the
     * answer it had asked for. Verified 2026-09-08 from a Cursor teammate's
     * read of this source.
     */
    const h = harness()
    const runner = createRoutineRunner(h.options)
    await runner.run('rt_1')
    h.phases.set('mission_1', 'completed')
    h.asked.add('mission_1')
    await runner.onRunEnded({ missionId: 'mission_1' })
    // Step 2 never started, and the routine is no longer holding the teammate.
    expect(h.starts).toHaveLength(1)
    expect(runner.running()).toHaveLength(0)
    expect(notices(h).join(' ')).toMatch(/asked you something/i)
  })

  it('still advances when the step asked nothing', async () => {
    // The control. A runner that stopped on every completed step would never
    // finish a routine at all.
    const h = harness()
    const runner = createRoutineRunner(h.options)
    await runner.run('rt_1')
    h.phases.set('mission_1', 'completed')
    await runner.onRunEnded({ missionId: 'mission_1' })
    expect(h.starts).toHaveLength(2)
  })
})
