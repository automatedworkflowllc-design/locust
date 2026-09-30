import { describe, expect, it } from 'vitest'

import { folderOnGitHub, githubRepoOf, refusalFor, startAnswer, statusAnswer } from './cloud-tasks.js'
import type { Ran, Runner } from './cloud-tasks.js'

/**
 * CLOUD TASKS (0.503): what `codex cloud` says, read. The strings are the
 * ones Codex CLI 0.159 printed on 2026-09-30 for the first real task.
 */
const ran = (stdout: string, code = 0, stderr = ''): Ran => ({ code, stdout, stderr })

describe('a folder on GitHub', () => {
  it('is named owner/repo from its remote, https or ssh', () => {
    expect(githubRepoOf('https://github.com/automatedworkflowllc-design/locust-cloud-test.git')).toBe('automatedworkflowllc-design/locust-cloud-test')
    expect(githubRepoOf('git@github.com:acme/widgets.git')).toBe('acme/widgets')
    expect(githubRepoOf('https://token@github.com/acme/widgets')).toBe('acme/widgets')
    expect(githubRepoOf('https://gitlab.com/acme/widgets.git')).toBeUndefined()
  })

  it('says its branch, what GitHub does not have yet, and uncommitted work', async () => {
    const git: Runner = async (args) =>
      args[0] === 'remote' ? ran('https://github.com/acme/widgets.git\n')
        : args[0] === 'rev-parse' ? ran('main\n')
          : args[0] === 'rev-list' ? ran('2\n')
            : ran(' M greet.js\n')
    expect(await folderOnGitHub('/w', git)).toEqual({ repo: 'acme/widgets', branch: 'main', unpushed: 2, dirty: true })
  })

  it('has no upstream, or no remote, said as unknown rather than guessed', async () => {
    const git: Runner = async (args) => (args[0] === 'rev-parse' ? ran('main\n') : ran('', 128, 'fatal'))
    expect(await folderOnGitHub('/w', git)).toEqual({ repo: undefined, branch: 'main', unpushed: undefined, dirty: false })
  })
})

describe('starting a cloud task', () => {
  it('finds the task in what Codex printed', () => {
    expect(startAnswer(ran('https://chatgpt.com/codex/tasks/task_e_6abd55697ae88328aeb7ba44897c5cf2\n'), 'acme/widgets'))
      .toEqual({ ok: true, taskId: 'task_e_6abd55697ae88328aeb7ba44897c5cf2', url: 'https://chatgpt.com/codex/tasks/task_e_6abd55697ae88328aeb7ba44897c5cf2' })
  })

  it('says a missing environment in terms of what to do about it', () => {
    const missing = startAnswer(ran('', 1, "Error: environment 'acme/widgets' not found; run `codex cloud` to list available environments"), 'acme/widgets')
    expect(missing).toEqual({ ok: false, problem: { kind: 'no-environment', repo: 'acme/widgets' } })
    if (!missing.ok) expect(refusalFor(missing.problem)).toMatch(/Legacy Codex Cloud and create one for that repository/)
    expect(startAnswer(ran('', 1, 'Error: no cloud environments are available for this workspace'), 'acme/widgets')).toMatchObject({ ok: false, problem: { kind: 'no-environment' } })
  })

  it('passes on anything else in Codex\'s own last words, never its config warnings', () => {
    const other = startAnswer(ran('', 1, 'Error: rate limited, try later\nwarning: `computer_use.windows.always_allowed_app_ids` is ignored.'), 'acme/widgets')
    expect(other).toEqual({ ok: false, problem: { kind: 'other', said: 'Error: rate limited, try later' } })
  })
})

describe('following a cloud task', () => {
  it('reads a finished task as Codex prints it, on three lines, with its change counted', () => {
    expect(statusAnswer('[READY] Add farewell function to greet.js\nautomatedworkflowllc-design/locust-cloud-test  •  4m ago\n+9/-1 • 2 files\n'))
      .toEqual({ state: 'ready', title: 'Add farewell function to greet.js', added: 9, removed: 1, files: 2 })
  })

  it('reads the same on one line', () => {
    expect(statusAnswer('[READY] Update greeting in greet.js automatedworkflowllc-design/locust-cloud-test  •  1m ago +2/-2 • 2 files'))
      .toEqual({ state: 'ready', title: 'Update greeting in greet.js', added: 2, removed: 2, files: 2 })
  })

  it('reads one still going, with nothing to count yet', () => {
    expect(statusAnswer('[PENDING] Update greeting in greet.js automatedworkflowllc-design/locust-cloud-test  •  16s ago no diff'))
      .toMatchObject({ state: 'pending', added: undefined, files: undefined })
  })

  it('reads anything it does not know as unknown', () => {
    expect(statusAnswer('something else entirely').state).toBe('unknown')
  })
})
