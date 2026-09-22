import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRoutineRunner } from './routine-runner.js'
import type { RoutineRunnerOptions } from './routine-runner.js'
import { createRoutineStore } from './routine-store.js'
import type { CodexMissionStartResponse, PublicRoutine } from '../shared/ipc.js'
import type { RoutineExecution } from '../shared/routine-recovery.js'
import { decideRoutineRecovery } from './routine-recovery-ipc.js'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'locust-recovery-'))
  roots.push(directory)
  const store = createRoutineStore({ rootDirectory: directory })
  const routine = await store.create({ name: 'Release', teammateId: 'tm_one', route: { runtime: 'codex', model: 'account-default', mode: 'ask' },
    steps: ['Open the PR.', 'Summarise the changes.', 'Report the result.'], learnedFrom: [], schedule: { kind: 'every', hours: 6 } })
  const phases = new Map<string, 'completed' | 'interrupted' | 'failed'>()
  let counter = 0
  const start = vi.fn(async (): Promise<CodexMissionStartResponse> => ({ ok: true, data: {
    missionId: `mission_${++counter}`, runId: `run_${counter}`, runtime: 'codex', sandbox: 'read-only'
  } } as CodexMissionStartResponse))
  const notify = vi.fn()
  const options: RoutineRunnerOptions = { workspaceId: 'ws_test', routines: store, start,
    peerContextFor: async () => ({ self: { teammateId: 'tm_one', name: 'One', role: 'Custom' }, others: [] }),
    assignOwner: async () => undefined, phaseOf: async (id) => phases.get(id), askedAQuestion: async () => false, notify }
  const restart = () => createRoutineRunner({ ...options, routines: createRoutineStore({ rootDirectory: directory }) })
  const read = () => createRoutineStore({ rootDirectory: directory }).get(routine.routineId)
  const disk = async () => JSON.parse(await readFile(join(directory, 'routines.json'), 'utf8')) as { routines: PublicRoutine[] }
  /*
   * EVERY TICK RELATIVE TO THE ROUTINE'S OWN CREATION, not to the wall clock.
   *
   * These read `new Date()` and `Date.now()` while the routine under test had
   * its `createdAt` stamped from the real clock a few milliseconds earlier,
   * so every due/not-due assertion sat on a boundary whose two sides came
   * from two different readings of the same clock. Under a loaded parallel
   * run those readings drift, which is the shape of a flake -- both these
   * files were on the handoff's flaky list.
   *
   * NOT a reproduction: they passed alone three times and in the full suite
   * every run tonight, and a fix claimed for a failure nobody has seen is a
   * guess. What this removes is the DEPENDENCE. The assertions are unchanged
   * and still mean what they meant; they just no longer ask the clock twice.
   */
  const at = (afterMs: number): Date => new Date(Date.parse(routine.createdAt) + afterMs)
  return { directory, routine, store, phases, start, notify, options, restart, read, disk, at }
}

describe('durable routine recovery — policy (c)', () => {
  it('restart proof: step 2 survives a fresh store and runner without replaying step 1', async () => {
    const f = await fixture()
    const first = f.restart()
    await first.run(f.routine.routineId)
    f.phases.set('mission_1', 'completed')
    await first.onRunEnded({ missionId: 'mission_1' })
    // This assertion goes red against the old RAM-only implementation.
    expect((await f.read())?.execution).toMatchObject({ step: 2, missionId: 'mission_2', status: 'running' })
    const next = f.restart()
    await next.tick(f.at(0))
    expect((await f.read())?.execution).toMatchObject({ step: 2, status: 'held', canContinue: false })
    expect(f.start).toHaveBeenCalledTimes(2)
    expect(await next.run(f.routine.routineId)).toMatchObject({ ok: false })
    expect(f.start).toHaveBeenCalledTimes(2)
  })

  it('completion accounting proof: step 1 start does not stamp lastRunAt or consume the six-hour interval', async () => {
    const f = await fixture()
    const runner = f.restart()
    await runner.run(f.routine.routineId)
    // Deliberate replacement of the old "start counts as a run" contract.
    expect((await f.read())?.lastRunAt).toBeUndefined()
    expect((await f.read())?.runs).toBe(0)
    f.phases.set('mission_1', 'completed')
    await runner.onRunEnded({ missionId: 'mission_1' })
    const next = f.restart()
    await next.tick(f.at(0)) // Not due yet: reconciliation must still run.
    expect((await f.read())?.execution?.status).toBe('held')
    f.phases.set('mission_2', 'completed') // Runtime finished while Electron was gone.
    await next.tick(f.at(60_000))
    expect((await f.read())?.execution?.canContinue).toBe(true)
    expect(f.start).toHaveBeenCalledTimes(2) // Only reconciliation retried, never effects.
    expect(f.notify).toHaveBeenCalledWith({ kind: 'routine-recovery-changed' })
    const execution = (await f.read())!.execution!
    expect(await next.recover({ routineId: f.routine.routineId, attemptId: execution.attemptId, step: execution.step, decision: 'continue' })).toEqual({ ok: true })
    expect(f.start).toHaveBeenCalledTimes(3)
    expect((await f.read())?.lastRunAt).toBeUndefined()
    f.phases.set('mission_3', 'completed')
    await next.onRunEnded({ missionId: 'mission_3' })
    expect((await f.disk()).routines[0]).toMatchObject({ runs: 1, lastRunAt: expect.any(String) })
    expect((await f.disk()).routines[0]?.execution).toBeUndefined()
    await next.onRunEnded({ missionId: 'mission_3' })
    await f.restart().tick(f.at(0))
    expect((await f.read())?.runs).toBe(1)
  })

  it('records dispatch intent before spawn; a thrown start is uncertain after restart', async () => {
    const f = await fixture()
    f.start.mockImplementationOnce(async () => {
      expect((await f.read())?.execution).toMatchObject({ status: 'dispatching', step: 1 })
      expect((await f.read())?.execution?.missionId).toBeUndefined()
      throw new Error('crash after spawn')
    })
    await expect(f.restart().run(f.routine.routineId)).rejects.toThrow('crash after spawn')
    await f.restart().tick(f.at(4 * 86_400_000))
    expect((await f.read())?.execution).toMatchObject({ status: 'held', canContinue: false, reason: expect.stringContaining('uncertain') })
    expect(f.start).toHaveBeenCalledTimes(1)
  })

  it('failure to save intent prevents dispatch; failure to save the returned id never permits replay', async () => {
    const f = await fixture()
    const save = f.store.saveProgress.bind(f.store)
    const fail = vi.spyOn(f.store, 'saveProgress').mockRejectedValueOnce(new Error('disk full'))
    await expect(createRoutineRunner(f.options).run(f.routine.routineId)).rejects.toThrow('disk full')
    expect(f.start).not.toHaveBeenCalled()
    fail.mockImplementation(async (id, execution, expected) => {
      if (execution.status === 'running') throw new Error('receipt write failed')
      return save(id, execution, expected)
    })
    await expect(createRoutineRunner(f.options).run(f.routine.routineId)).rejects.toThrow('receipt write failed')
    expect((await f.read())?.execution?.status).toBe('dispatching')
    await f.restart().tick(f.at(0))
    expect((await f.read())?.execution?.status).toBe('held')
    expect(f.start).toHaveBeenCalledTimes(1)
  })

  it('reconciles final completion after a crash exactly once, without dispatching anything', async () => {
    const f = await fixture()
    await f.store.update({ routineId: f.routine.routineId, name: 'Release', steps: ['Only step.'] })
    await f.restart().run(f.routine.routineId)
    f.phases.set('mission_1', 'completed')
    await f.restart().tick(f.at(0))
    await f.restart().tick(f.at(0))
    expect((await f.read())?.runs).toBe(1)
    expect((await f.read())?.execution).toBeUndefined()
    expect(f.start).toHaveBeenCalledTimes(1)
  })

  it('a failed completion write leaves progress and retries accounting on next reconciliation', async () => {
    const f = await fixture()
    await f.store.update({ routineId: f.routine.routineId, name: 'Release', steps: ['Only step.'] })
    await f.restart().run(f.routine.routineId)
    f.phases.set('mission_1', 'completed')
    vi.spyOn(f.store, 'recordRun').mockRejectedValueOnce(new Error('disk full'))
    await expect(createRoutineRunner(f.options).reconcile()).rejects.toThrow('disk full')
    expect((await f.read())?.execution).toBeDefined()
    expect((await f.read())?.runs).toBe(0)
    await f.restart().reconcile()
    expect((await f.read())?.runs).toBe(1)
    expect((await f.read())?.execution).toBeUndefined()
  })

  it('refuses stale and duplicate decisions; continuation uses the saved route and steps', async () => {
    const f = await fixture()
    await f.restart().run(f.routine.routineId)
    f.phases.set('mission_1', 'completed')
    const next = f.restart()
    await next.reconcile()
    const execution = (await f.read())!.execution!
    await f.store.update({ routineId: f.routine.routineId, name: 'Edited', steps: ['Different', 'Publish everything'] })
    expect(await next.recover({ routineId: f.routine.routineId, attemptId: 'old_attempt', step: execution.step, decision: 'continue' })).toMatchObject({ ok: false })
    const request = { routineId: f.routine.routineId, attemptId: execution.attemptId, step: execution.step, decision: 'continue' } as const
    const answers = await Promise.all([next.recover(request), next.recover(request)])
    expect(answers.map((answer) => answer.ok)).toEqual([true, false])
    expect(f.start).toHaveBeenCalledTimes(2)
    expect(f.start).toHaveBeenLastCalledWith(expect.objectContaining({ prompt: 'Summarise the changes.', followUpOf: 'mission_1' }))
    f.phases.set('mission_2', 'completed')
    await next.onRunEnded({ missionId: 'mission_2' })
    expect(f.start).toHaveBeenLastCalledWith(expect.objectContaining({ prompt: 'Report the result.' }))
    expect(await next.recover({ ...request, decision: 'abandon' })).toMatchObject({ ok: false })
  })

  it('abandon is durable acknowledgement, removes the schedule and never claims completion', async () => {
    const f = await fixture()
    await f.restart().run(f.routine.routineId)
    const next = f.restart()
    await next.reconcile()
    const execution = (await f.read())!.execution!
    expect(await next.recover({ routineId: f.routine.routineId, attemptId: execution.attemptId, step: execution.step, decision: 'continue' })).toMatchObject({ ok: false })
    expect(await next.recover({ routineId: f.routine.routineId, attemptId: execution.attemptId, step: execution.step, decision: 'abandon' })).toEqual({ ok: true })
    await f.restart().tick(f.at(4 * 86_400_000))
    expect((await f.read())?.execution?.status).toBe('abandoned')
    expect((await f.read())?.schedule).toBeUndefined()
    expect((await f.read())?.runs).toBe(0)
    expect((await f.read())?.lastRunAt).toBeUndefined()
    expect(f.start).toHaveBeenCalledTimes(1)
  })

  it('question and unreadable question receipts hold even the final step without counting', async () => {
    for (const probe of [async () => true, async (): Promise<boolean> => { throw new Error('unreadable') }]) {
      const f = await fixture()
      await f.store.update({ routineId: f.routine.routineId, name: 'Release', steps: ['Only step.'] })
      await f.restart().run(f.routine.routineId)
      f.phases.set('mission_1', 'completed')
      await createRoutineRunner({ ...f.options, askedAQuestion: probe }).reconcile()
      expect((await f.read())?.execution).toMatchObject({ status: 'held', canContinue: false })
      expect((await f.read())?.runs).toBe(0)
    }
  })

  it('a different workspace cannot continue an otherwise complete step', async () => {
    const f = await fixture()
    await f.restart().run(f.routine.routineId)
    f.phases.set('mission_1', 'completed')
    const next = createRoutineRunner({ ...f.options, workspaceId: 'ws_other' })
    await next.reconcile()
    const execution = (await f.read())!.execution!
    expect(execution.reason).toContain('original workspace')
    expect(await next.recover({ routineId: f.routine.routineId, attemptId: execution.attemptId, step: execution.step, decision: 'continue' })).toMatchObject({ ok: false })
    expect(f.start).toHaveBeenCalledTimes(1)
  })

  it('a malformed progress receipt is held instead of dropped and replayed', async () => {
    const f = await fixture()
    const file = await f.disk()
    await writeFile(join(f.directory, 'routines.json'), JSON.stringify({ ...file, routines: [{ ...file.routines[0], execution: { nonsense: true } }] }))
    await f.restart().tick(f.at(4 * 86_400_000))
    expect((await f.read())?.execution?.status).toBe('held')
    expect(f.start).not.toHaveBeenCalled()
  })

  it('store refuses overwriting an active attempt and duplicate completion', async () => {
    const f = await fixture()
    await f.restart().run(f.routine.routineId)
    const execution = (await f.read())!.execution!
    await expect(f.store.saveProgress(f.routine.routineId, execution, null)).rejects.toThrow('changed')
    await expect(f.store.recordRun(f.routine.routineId, execution.attemptId)).rejects.toThrow('completion')
    const final: RoutineExecution = { ...execution, step: 3 }
    await f.store.saveProgress(f.routine.routineId, final, execution.attemptId)
    await f.store.recordRun(f.routine.routineId, execution.attemptId)
    await expect(f.store.recordRun(f.routine.routineId, execution.attemptId)).rejects.toThrow('completion')
    expect((await f.read())?.runs).toBe(1)
  })

  it('main IPC validates the sender, workspace, request and reports persistence failures', async () => {
    const f = await fixture()
    const runner = f.restart()
    const recover = vi.spyOn(runner, 'recover').mockResolvedValue({ ok: true })
    const request = { routineId: f.routine.routineId, attemptId: 'attempt_1', step: 1, decision: 'abandon' }
    for (const [input, own, workspace] of [[request, false, true], [request, true, false], [{ ...request, decision: 'replay' }, true, true], [null, true, true]] as const) {
      expect(await decideRoutineRecovery(input, own, workspace, runner)).toMatchObject({ ok: false })
    }
    expect(recover).not.toHaveBeenCalled()
    expect(await decideRoutineRecovery(request, true, true, runner)).toEqual({ ok: true })
    expect(recover).toHaveBeenCalledWith(request)
    recover.mockRejectedValueOnce(new Error('disk full'))
    expect(await decideRoutineRecovery(request, true, true, runner)).toMatchObject({ ok: false, error: { message: expect.stringContaining('Check disk access') } })
  })

  it('a returned spawn-boundary failure remains uncertain and does not use routine-blocked retry wording', async () => {
    const f = await fixture()
    f.start.mockResolvedValue({ ok: false, error: { code: 'RUNTIME_START_FAILED', message: 'spawn result unavailable' } })
    // Seven hours past the routine's own creation, so it is due -- measured
    // from the same instant the routine was stamped with, not from a second
    // reading of the wall clock.
    const later = f.at(7 * 3_600_000)
    const runner = f.restart()
    await runner.tick(later)
    await runner.tick(new Date(later.getTime() + 60_000))
    expect(f.start).toHaveBeenCalledTimes(1)
    expect((await f.read())?.execution?.status).toBe('held')
    expect(f.notify.mock.calls.some(([update]) => update.kind === 'routine-blocked')).toBe(false)
  })

  it('same-session completion persistence failures are reconciled on the next tick', async () => {
    const f = await fixture()
    await f.store.update({ routineId: f.routine.routineId, name: 'Release', steps: ['Only step.'] })
    const runner = createRoutineRunner(f.options)
    await runner.run(f.routine.routineId)
    f.phases.set('mission_1', 'completed')
    vi.spyOn(f.store, 'recordRun').mockRejectedValueOnce(new Error('disk full'))
    await expect(runner.onRunEnded({ missionId: 'mission_1' })).rejects.toThrow('disk full')
    await runner.tick(f.at(0))
    expect((await f.read())?.runs).toBe(1)
    expect((await f.read())?.execution).toBeUndefined()
    expect(f.start).toHaveBeenCalledTimes(1)
  })

  it('an old step acknowledgement cannot abandon a later held step of the same attempt', async () => {
    const f = await fixture()
    const first = f.restart()
    await first.run(f.routine.routineId)
    f.phases.set('mission_1', 'completed')
    const second = f.restart()
    await second.reconcile()
    const old = (await f.read())!.execution!
    await second.recover({ routineId: f.routine.routineId, attemptId: old.attemptId, step: old.step, decision: 'continue' })
    const third = f.restart()
    await third.reconcile()
    expect(await third.recover({ routineId: f.routine.routineId, attemptId: old.attemptId, step: old.step, decision: 'abandon' })).toMatchObject({ ok: false })
    expect((await f.read())?.execution).toMatchObject({ status: 'held', step: 2 })
    expect((await f.read())?.schedule).toBeDefined()
  })

  it('repeated reconciliation does not create an event/reload feedback loop', async () => {
    const f = await fixture()
    await f.restart().run(f.routine.routineId)
    const runner = f.restart()
    await runner.reconcile()
    const count = f.notify.mock.calls.length
    await runner.reconcile()
    await runner.reconcile()
    expect(f.notify.mock.calls).toHaveLength(count)
    expect((await f.read())?.execution?.status).toBe('held')
  })
})
