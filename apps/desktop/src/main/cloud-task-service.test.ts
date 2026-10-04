import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createCloudTaskService } from './cloud-task-service.js'
import type { Ran, Runner } from './cloud-tasks.js'

/**
 * CLOUD TASKS, END TO END ON STAND-INS (0.503): what Locust sends `codex cloud`
 * and git, and what it keeps. The answers are the ones Codex CLI 0.159 gave
 * for the first real task on 2026-09-30.
 */
const ran = (stdout: string, code = 0, stderr = ''): Ran => ({ code, stdout, stderr })
const dirs: string[] = []
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})
const setup = async (git: Partial<Record<string, Ran>> = {}) => {
  const dir = await mkdtemp(join(tmpdir(), 'locust-cloud-'))
  dirs.push(dir)
  const calls: string[][] = []
  const codex: Runner = async (args) => {
    calls.push([...args])
    if (args[1] === 'exec') return ran('https://chatgpt.com/codex/tasks/task_e_abc123\n')
    if (args[1] === 'status') return ran('[READY] Update greeting in greet.js acme/widgets  •  1m ago +2/-2 • 2 files\n')
    if (args[1] === 'diff') return ran('diff --git a/greet.js b/greet.js\n--- a/greet.js\n+++ b/greet.js\n@@ -1 +1 @@\n-a\n+b\n')
    return ran('Applied.\n')
  }
  const gitRunner: Runner = async (args) =>
    git[args[0]!] ?? (args[0] === 'remote' ? ran('https://github.com/acme/widgets.git\n') : args[0] === 'rev-parse' ? ran('main\n') : args[0] === 'rev-list' ? ran('0\n') : ran(''))
  const service = createCloudTaskService({ file: join(dir, 'cloud-tasks.json'), codex, git: gitRunner, now: () => new Date('2026-09-30T12:00:00Z') })
  return { service, calls }
}

describe('a cloud task', () => {
  it('starts on the folder\'s own repository and branch, and is kept', async () => {
    const { service, calls } = await setup()
    const started = await service.start({ folder: '/w', prompt: 'Make the greeting louder.' })
    expect(started).toMatchObject({ ok: true, task: { taskId: 'task_e_abc123', repo: 'acme/widgets', branch: 'main' }, notes: [] })
    expect(calls[0]).toEqual(['cloud', 'exec', '--env', 'acme/widgets', '--branch', 'main', 'Make the greeting louder.'])
    expect((await service.list('/w')).map((task) => task.taskId)).toEqual(['task_e_abc123'])
  })

  it('says, before it runs, what the cloud will not see', async () => {
    const { service } = await setup({ 'rev-list': ran('2\n'), status: ran(' M greet.js\n') })
    const started = await service.start({ folder: '/w', prompt: 'x' })
    expect(started.ok && started.notes).toEqual([
      '2 commits on main are not on GitHub, so the cloud works without them.',
      'Uncommitted changes in this folder stay here: the cloud works from what GitHub has.'
    ])
  })

  it('refuses a folder with no GitHub repository, and starts nothing', async () => {
    const { service, calls } = await setup({ remote: ran('', 2, 'fatal: No such remote') })
    expect(await service.start({ folder: '/w', prompt: 'x' })).toMatchObject({ ok: false, message: /GitHub repository, and this folder has none/ })
    expect(calls).toEqual([])
  })

  it('is followed to READY, its change fetched, and applied only when asked', async () => {
    const { service, calls } = await setup()
    await service.start({ folder: '/w', prompt: 'x' })
    expect((await service.refresh('task_e_abc123'))?.status).toMatchObject({ state: 'ready', added: 2, removed: 2, files: 2 })
    expect(await service.diff('task_e_abc123')).toMatch(/^diff --git a\/greet.js/)
    expect(calls.some((call) => call[1] === 'apply')).toBe(false)
    const applied = await service.apply('task_e_abc123')
    expect(applied).toMatchObject({ ok: true, task: { appliedAt: '2026-09-30T12:00:00.000Z', status: { state: 'applied' } } })
    expect(await service.apply('task_e_abc123')).toMatchObject({ ok: false, message: 'Its change is already in this folder.' })
  })

  it('never applies a task it did not start', async () => {
    const { service, calls } = await setup()
    expect(await service.apply('task_e_someone_elses')).toMatchObject({ ok: false })
    expect(calls).toEqual([])
  })
})
