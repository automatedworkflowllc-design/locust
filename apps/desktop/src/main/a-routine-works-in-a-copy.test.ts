import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { CodexMissionStartResponse, PublicRoutine, RoutineStaged } from '../shared/ipc.js'
import { createRoutineCopies } from './routine-copy.js'
import { createRoutineRunner } from './routine-runner.js'
import type { RoutineRunnerOptions } from './routine-runner.js'
import { parsedRoutine } from './routine-store.js'

/**
 * A ROUTINE WORKS IN A COPY, AND NOTHING LANDS UNTIL YOU KEEP IT (0.533).
 * Sol's 0.528 pass, as an office user: "I would not trust a file routine's
 * no-change description after seeing it create files." Here the teammate is
 * a fake that writes a file wherever it is told to work.
 */
const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
const temp = async (prefix: string): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), prefix))
  roots.push(root)
  return root
}
const exists = (path: string): Promise<boolean> => stat(path).then(() => true, () => false)

describe('a routine\'s copy', () => {
  it('is the folder as it is; Keep writes its changes in, and remembers where from after a restart', async () => {
    const folder = await temp('locust-rtcopy-folder-')
    const root = await temp('locust-rtcopy-root-')
    await writeFile(join(folder, 'policy.md'), 'Cutoff is 4 pm.\n')
    const copies = createRoutineCopies(root)
    const copy = await copies.make('rt_abc', folder)
    expect(await readFile(join(copy, 'policy.md'), 'utf8')).toBe('Cutoff is 4 pm.\n')
    await writeFile(join(copy, 'policy.md'), 'Cutoff is 3 pm.\n')
    await writeFile(join(copy, 'receipt.md'), 'Received.\n')
    expect(await copies.changes('rt_abc')).toEqual({ changed: ['policy.md', 'receipt.md'], deleted: [] })
    // The folder is untouched until Keep.
    expect(await readFile(join(folder, 'policy.md'), 'utf8')).toBe('Cutoff is 4 pm.\n')
    const again = createRoutineCopies(root)
    expect(await again.source('rt_abc')).toBe(folder)
    expect(await again.keep('rt_abc')).toEqual({ kind: 'brought', files: ['policy.md', 'receipt.md'] })
    expect(await readFile(join(folder, 'policy.md'), 'utf8')).toBe('Cutoff is 3 pm.\n')
    expect(await readFile(join(folder, 'receipt.md'), 'utf8')).toBe('Received.\n')
  })

  it('refuses to Keep over a file the person changed since, and Discard leaves no copy behind', async () => {
    const folder = await temp('locust-rtcopy-folder-')
    const root = await temp('locust-rtcopy-root-')
    await writeFile(join(folder, 'policy.md'), 'Cutoff is 4 pm.\n')
    const copies = createRoutineCopies(root)
    const copy = await copies.make('rt_abc', folder)
    await writeFile(join(copy, 'policy.md'), 'Cutoff is 3 pm.\n')
    await writeFile(join(folder, 'policy.md'), 'Cutoff is 5 pm, said the person.\n')
    expect(await copies.keep('rt_abc')).toEqual({ kind: 'your-changes', files: ['policy.md'] })
    expect(await readFile(join(folder, 'policy.md'), 'utf8')).toBe('Cutoff is 5 pm, said the person.\n')
    await copies.discard('rt_abc')
    expect(await exists(copy)).toBe(false)
    expect(await copies.source('rt_abc')).toBeUndefined()
  })

  it('cannot be named so as to climb out of its root', async () => {
    const copies = createRoutineCopies(await temp('locust-rtcopy-root-'))
    expect(() => copies.path('../rt_x')).toThrow()
    expect(() => copies.path('rt_a/../../b')).toThrow()
  })
})

describe('a routine that works in a copy', () => {
  const setUp = async () => {
    const folder = await temp('locust-rtcopy-folder-')
    const root = await temp('locust-rtcopy-root-')
    await writeFile(join(folder, 'notes.md'), 'Old notes.\n')
    const held = new Map<string, PublicRoutine>([['rt_inbox', {
      routineId: 'rt_inbox', name: 'Inbox receipt', teammateId: 'tm_cedar',
      route: { runtime: 'codex', model: 'account-default', mode: 'accept-edits' },
      steps: ['Write a receipt.'], learnedFrom: [], createdAt: '2026-10-01T00:00:00.000Z', runs: 0,
      inCopy: true
    }]])
    const cwds: (string | undefined)[] = []
    const recorded: (RoutineStaged | undefined)[] = []
    const copies = createRoutineCopies(root)
    const options = {
      workspaceId: 'ws_test',
      copies,
      folderNow: () => folder,
      routines: {
        get: async (id: unknown) => held.get(String(id)),
        list: async () => [...held.values()],
        recordRun: async (id: string, _attempt: string, staged?: RoutineStaged) => {
          recorded.push(staged)
          const { execution: _execution, ...rest } = held.get(id)!
          held.set(id, { ...rest, runs: rest.runs + 1, ...(staged === undefined ? {} : { staged }) })
        },
        saveProgress: async (id: string, execution: unknown) => { held.set(id, { ...held.get(id)!, execution } as PublicRoutine) },
        clearProgress: async () => undefined,
        abandon: async () => undefined,
        keepSchedule: async () => undefined
      },
      peerContextFor: async () => ({ self: { teammateId: 'tm_cedar', name: 'Cedar', role: 'Office' }, others: [] }),
      // The teammate: writes a receipt wherever it is told to work.
      start: async (request: { readonly cwd?: string }) => {
        cwds.push(request.cwd)
        await writeFile(join(request.cwd ?? folder, 'receipt.md'), 'Received.\n')
        return { ok: true, data: { runId: 'run_1', missionId: 'mission_1', runtime: 'codex', sandbox: 'workspace-write' } } as unknown as CodexMissionStartResponse
      },
      assignOwner: async () => undefined,
      phaseOf: async () => 'completed',
      askedAQuestion: async () => false,
      notify: () => undefined
    } as unknown as RoutineRunnerOptions
    return { folder, root, held, cwds, recorded, copies, runner: createRoutineRunner(options) }
  }

  it('runs its step in the copy; the folder is untouched and the change waits, named', async () => {
    const { folder, held, cwds, recorded, copies, runner } = await setUp()
    expect((await runner.run('rt_inbox')).ok).toBe(true)
    expect(cwds).toEqual([copies.path('rt_inbox')])
    await runner.onRunEnded({ missionId: 'mission_1' })
    expect(await exists(join(folder, 'receipt.md'))).toBe(false)
    expect(recorded[0]).toEqual(expect.objectContaining({ folder, changed: ['receipt.md'], deleted: [] }))
    expect(held.get('rt_inbox')?.staged?.changed).toEqual(['receipt.md'])
  })

  it('will not run again while those changes wait, on Run or on its own', async () => {
    const { runner, held } = await setUp()
    await runner.run('rt_inbox')
    await runner.onRunEnded({ missionId: 'mission_1' })
    const again = await runner.run('rt_inbox')
    expect(again.ok).toBe(false)
    expect(again.ok ? '' : again.error.message).toMatch(/waiting under Routines\. Keep or Discard them/)
    held.set('rt_inbox', { ...held.get('rt_inbox')!, schedule: { kind: 'every', hours: 1 }, lastRunAt: '2026-09-01T00:00:00.000Z' })
    expect(await runner.tick(new Date('2026-10-02T00:00:00Z'))).toEqual([])
  })

  it('a run that changed nothing leaves nothing waiting, and no copy', async () => {
    const { held, recorded, copies, folder } = await setUp()
    const options = held.get('rt_inbox')!
    held.set('rt_inbox', { ...options, steps: ['Just read.'] })
    // A teammate that writes nothing this time.
    const quiet = createRoutineRunner({
      ...({} as RoutineRunnerOptions),
      workspaceId: 'ws_test',
      copies,
      folderNow: () => folder,
      routines: { get: async (id: unknown) => held.get(String(id)), list: async () => [...held.values()], recordRun: async (_id: string, _a: string, staged?: RoutineStaged) => { recorded.push(staged) }, saveProgress: async (id: string, execution: unknown) => { held.set(id, { ...held.get(id)!, execution } as PublicRoutine) }, clearProgress: async () => undefined, abandon: async () => undefined, keepSchedule: async () => undefined },
      peerContextFor: async () => ({ self: { teammateId: 'tm_cedar', name: 'Cedar', role: 'Office' }, others: [] }),
      start: async () => ({ ok: true, data: { runId: 'run_2', missionId: 'mission_2', runtime: 'codex', sandbox: 'workspace-write' } }) as unknown as CodexMissionStartResponse,
      assignOwner: async () => undefined,
      phaseOf: async () => 'completed',
      askedAQuestion: async () => false,
      notify: () => undefined
    } as unknown as RoutineRunnerOptions)
    expect((await quiet.run('rt_inbox')).ok).toBe(true)
    await quiet.onRunEnded({ missionId: 'mission_2' })
    expect(recorded.at(-1)).toBeUndefined()
    expect(await exists(copies.path('rt_inbox'))).toBe(false)
  })

  it('keeps what waits when the routine is read back, and drops it if it does not read', () => {
    const base = { routineId: 'rt_inbox', name: 'Inbox receipt', teammateId: 'tm_cedar', route: { runtime: 'codex', model: 'account-default', mode: 'accept-edits' }, steps: ['Write a receipt.'], learnedFrom: [], createdAt: '2026-10-01T00:00:00.000Z', runs: 1 }
    const staged = { attemptId: 'a1', finishedAt: '2026-10-01T10:00:00.000Z', folder: 'C:/work', changed: ['receipt.md'], deleted: [] }
    expect(parsedRoutine({ ...base, inCopy: true, staged })).toEqual(expect.objectContaining({ inCopy: true, staged }))
    const bad = parsedRoutine({ ...base, inCopy: true, staged: { ...staged, changed: [42] } })
    expect(bad?.inCopy).toBe(true)
    expect(bad?.staged).toBeUndefined()
  })
})
