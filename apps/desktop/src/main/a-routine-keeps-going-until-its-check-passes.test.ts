import { describe, expect, it } from 'vitest'

import type { CodexMissionStartResponse, CodexMissionUpdate, PublicRoutine } from '../shared/ipc.js'
import type { RoutineExecution } from '../shared/routine-recovery.js'
import { createRoutineRunner, goalFixPrompt } from './routine-runner.js'
import type { GoalCheck, RoutineRunnerOptions } from './routine-runner.js'
import { parsedRoutine, validGoal } from './routine-store.js'

/**
 * A ROUTINE KEEPS GOING UNTIL ITS CHECK PASSES (0.534, a standing goal). With
 * its steps done the folder's check runs; while it fails, the same teammate
 * is asked to fix what it said, in the same conversation, at most N times.
 */
const setUp = (checks: readonly GoalCheck[], tries: number) => {
  const held = new Map<string, PublicRoutine>([['rt_tests', {
    routineId: 'rt_tests', name: 'Green tests', teammateId: 'tm_wren',
    route: { runtime: 'codex', model: 'gpt-6-luna', mode: 'accept-edits' },
    steps: ['Fix the cart total.'], learnedFrom: [], createdAt: '2026-10-01T00:00:00.000Z', runs: 0,
    untilCheck: { tries }
  }]])
  const started: { prompt: string; followUpOf: string | undefined }[] = []
  const notices: string[] = []
  const recorded: string[] = []
  let checked = 0
  let mission = 0
  const options = {
    workspaceId: 'ws_test',
    folderNow: () => 'C:/work',
    goalCheck: async () => checks[Math.min(checked++, checks.length - 1)],
    routines: {
      get: async (id: unknown) => held.get(String(id)),
      list: async () => [...held.values()],
      recordRun: async (id: string) => {
        recorded.push(id)
        const { execution: _execution, ...rest } = held.get(id)!
        held.set(id, { ...rest, runs: rest.runs + 1 })
      },
      saveProgress: async (id: string, execution: RoutineExecution) => { held.set(id, { ...held.get(id)!, execution }) },
      clearProgress: async () => undefined,
      abandon: async () => undefined,
      keepSchedule: async () => undefined
    },
    peerContextFor: async () => ({ self: { teammateId: 'tm_wren', name: 'Wren', role: 'Code' }, others: [] }),
    start: async (request: { readonly prompt: string; readonly followUpOf: string | undefined }) => {
      started.push({ prompt: request.prompt, followUpOf: request.followUpOf })
      mission += 1
      return { ok: true, data: { runId: `run_${String(mission)}`, missionId: `mission_${String(mission)}`, runtime: 'codex', sandbox: 'workspace-write' } } as unknown as CodexMissionStartResponse
    },
    assignOwner: async () => undefined,
    phaseOf: async () => 'completed',
    askedAQuestion: async () => false,
    notify: (update: CodexMissionUpdate) => { if (update.kind === 'relay-notice') notices.push(update.message) }
  } as unknown as RoutineRunnerOptions
  return { held, started, notices, recorded, runner: createRoutineRunner(options) }
}
const failing: GoalCheck = { command: 'npm test', passed: false, tail: ['FAIL cart.test.js', 'expected 6, got 0'] }
const passing: GoalCheck = { command: 'npm test', passed: true, tail: [] }

describe('a routine that keeps going until its check passes', () => {
  it('asks the same teammate to fix what the check said, in the same conversation, then finishes when it passes', async () => {
    const { started, notices, recorded, held, runner } = setUp([failing, passing], 3)
    await runner.run('rt_tests')
    await runner.onRunEnded({ missionId: 'mission_1' })
    expect(started).toHaveLength(2)
    expect(started[1]!.followUpOf).toBe('mission_1')
    expect(started[1]!.prompt).toBe(goalFixPrompt(failing, 1, 3))
    expect(started[1]!.prompt).toContain('expected 6, got 0')
    expect(held.get('rt_tests')?.execution?.goalTry).toBe(1)
    expect(notices.at(-1)).toBe('Routine "Green tests": the check `npm test` failed, so Wren is fixing it (fix 1 of 3).')
    await runner.onRunEnded({ missionId: 'mission_2' })
    expect(recorded).toEqual(['rt_tests'])
    expect(notices.at(-1)).toBe('Routine "Green tests" finished: the check `npm test` passed after 1 fix.')
  })

  it('stops at its limit and says what still fails; the run does not count as done', async () => {
    const { started, notices, recorded, held, runner } = setUp([failing], 1)
    await runner.run('rt_tests')
    await runner.onRunEnded({ missionId: 'mission_1' })
    await runner.onRunEnded({ missionId: 'mission_2' })
    expect(started).toHaveLength(2)
    expect(recorded).toEqual([])
    expect(held.get('rt_tests')?.execution?.status).toBe('held')
    expect(held.get('rt_tests')?.execution?.reason).toMatch(/^The check `npm test` still fails after 1 fix: FAIL cart\.test\.js \/ expected 6, got 0\. The run does not count as done\./)
    expect(notices.at(-1)).toMatch(/stopped: the check `npm test` still fails after 1 fix/)
  })

  it('finishes at once when the check passes the first time, and says so', async () => {
    const { started, notices, recorded, runner } = setUp([passing], 3)
    await runner.run('rt_tests')
    await runner.onRunEnded({ missionId: 'mission_1' })
    expect(started).toHaveLength(1)
    expect(recorded).toEqual(['rt_tests'])
    expect(notices.at(-1)).toBe('Routine "Green tests" finished: the check `npm test` passed.')
  })

  it('keeps 1 to 5 fixes, and drops a goal that does not read rather than the routine', () => {
    expect([0, 1, 5, 6, 2.5].map((tries) => validGoal({ tries }))).toEqual([false, true, true, false, false])
    const base = { routineId: 'rt_tests', name: 'Green tests', teammateId: 'tm_wren', route: { runtime: 'codex', model: 'gpt-6-luna', mode: 'accept-edits' }, steps: ['Fix it.'], learnedFrom: [], createdAt: '2026-10-01T00:00:00.000Z', runs: 0 }
    expect(parsedRoutine({ ...base, untilCheck: { tries: 3 } })?.untilCheck).toEqual({ tries: 3 })
    const bad = parsedRoutine({ ...base, untilCheck: { tries: 99 } })
    expect(bad?.name).toBe('Green tests')
    expect(bad?.untilCheck).toBeUndefined()
  })
})
