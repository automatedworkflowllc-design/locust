import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CodexMissionStartResponse } from '../shared/ipc.js'
import { createRoutineRunner } from './routine-runner.js'
import type { RoutineRunnerOptions } from './routine-runner.js'
import { createRoutineStore } from './routine-store.js'

/**
 * Colin, 2026-09-21. His routine card read:
 *
 * > Dispatch outcome is uncertain: the app stopped before saving a mission
 * > receipt. Review external work; nothing will be replayed.
 *
 * Every word of which was the wrong thing to tell him. The runtime had
 * REFUSED the start outright -- Cursor cannot be held read-only on Windows --
 * and `startStep` recorded exactly that, naming the mode to change. Then
 * `reconcile` re-decided the held attempt, found no mission to ask about,
 * and overwrote the reason with the generic one above.
 *
 * So the card blamed a restart for a refusal, and told him to go and review
 * external work for a run that had never started. A hold decided AT DISPATCH
 * is final: there is no mission whose phase could later move.
 */

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

const REFUSAL =
  'Cursor Agent cannot be held read-only on this system: its sandbox needs macOS or Linux, and plan mode alone does not stop it editing files. Choose "Edit" if it may change this workspace, or run this on Codex CLI or Claude Code.'

async function fixture(response: CodexMissionStartResponse) {
  const directory = await mkdtemp(join(tmpdir(), 'locust-refusal-'))
  roots.push(directory)
  const store = createRoutineStore({ rootDirectory: directory })
  const routine = await store.create({
    name: 'check robinhood',
    teammateId: 'tm_one',
    route: { runtime: 'cursor', model: 'cursor-grok-4.6-medium', mode: 'ask' },
    steps: ['check robinhood for me, my roth ira, and all associated news'],
    learnedFrom: []
  })
  const start = vi.fn(async (): Promise<CodexMissionStartResponse> => response)
  const options: RoutineRunnerOptions = {
    workspaceId: 'ws_test',
    routines: store,
    start,
    peerContextFor: async () => ({ self: { teammateId: 'tm_one', name: 'One', role: 'Custom' }, others: [] }),
    assignOwner: async () => undefined,
    phaseOf: async () => undefined,
    askedAQuestion: async () => false,
    notify: vi.fn()
  }
  return {
    directory,
    routine,
    start,
    options,
    // A fresh runner and a fresh store: exactly what a restart is.
    restart: () => createRoutineRunner({ ...options, routines: createRoutineStore({ rootDirectory: directory }) }),
    read: () => createRoutineStore({ rootDirectory: directory }).get(routine.routineId)
  }
}

const refused: CodexMissionStartResponse = { ok: false, error: { code: 'RUNTIME_START_FAILED', message: REFUSAL } }

describe('a refusal keeps the reason it was refused for', () => {
  it('records the runtime’s own words when the dispatch is refused', async () => {
    const f = await fixture(refused)
    await f.restart().run(f.routine.routineId)
    const execution = (await f.read())?.execution
    expect(execution?.status).toBe('held')
    expect(execution?.reason).toContain('cannot be held read-only')
    expect(execution?.settledAtDispatch).toBe(true)
    expect(execution?.canContinue).toBe(false)
  })

  it('does not rewrite that reason on the next reconcile', async () => {
    const f = await fixture(refused)
    const runner = f.restart()
    await runner.run(f.routine.routineId)
    await runner.reconcile()
    await runner.reconcile()
    expect((await f.read())?.execution?.reason).toContain('cannot be held read-only')
    expect((await f.read())?.execution?.reason).not.toContain('the app stopped')
  })

  it('survives an actual restart, which is when the old message appeared', async () => {
    const f = await fixture(refused)
    await f.restart().run(f.routine.routineId)
    // The app really does stop here -- his did, for an update -- and the
    // reason must still be the refusal, not the restart.
    await f.restart().reconcile()
    const execution = (await f.read())?.execution
    expect(execution?.reason).toContain('cannot be held read-only')
    expect(execution?.settledAtDispatch).toBe(true)
  })

  it('still reports a genuinely interrupted dispatch as uncertain', async () => {
    // The other half: a dispatch that never answered leaves `dispatching`,
    // and THAT is what the generic sentence is for. It must survive.
    const f = await fixture({ ok: true, data: { missionId: 'mission_1', runId: 'run_1', runtime: 'cursor', sandbox: 'read-only' } } as CodexMissionStartResponse)
    await f.restart().run(f.routine.routineId)
    const execution = (await f.read())?.execution
    expect(execution).toBeDefined()
    // Put it back to the state a stop between spawn and receipt leaves: a
    // dispatch in flight, with no mission recorded.
    const { missionId: _gone, runId: _also, ...inFlight } = execution!
    await createRoutineStore({ rootDirectory: f.directory }).saveProgress(
      f.routine.routineId,
      { ...inFlight, status: 'dispatching' },
      execution!.attemptId
    )
    await f.restart().reconcile()
    expect((await f.read())?.execution?.reason).toContain('the app stopped before saving a mission receipt')
  })
})
