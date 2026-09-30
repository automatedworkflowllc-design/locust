import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createWorktreeManager } from './worktrees.js'

/**
 * A COMPARE COLUMN WORKS OUTSIDE THE FOLDER (0.493). Sol's 0.491 pass: in a
 * git project, each column's worktree was made under `<folder>/.locust/compare/`,
 * so the column's own path named the real project around it -- and a free
 * model in Auto, told to "work only in this folder", edited the project it
 * could see above instead of its own copy. The original `index.html` changed
 * before anything was kept. The worktrees are made outside the folder now,
 * beside the plain copies, where no path leads back.
 */
const CLEANUP = { recursive: true, force: true, maxRetries: 5, retryDelay: 100 } as const
const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((directory) => rm(directory, CLEANUP)))
})
const git = (args: readonly string[], cwd: string): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile('git', [...args], { cwd, windowsHide: true }, (error, stdout) => (error ? reject(error) : resolve(stdout)))
  })

describe('a comparison column in a git project', () => {
  it('is made outside the project folder, and is still one of its worktrees', async () => {
    const project = await mkdtemp(join(tmpdir(), 'locust-compare-project-'))
    const elsewhere = await mkdtemp(join(tmpdir(), 'locust-compare-columns-'))
    dirs.push(project, elsewhere)
    await git(['init', '-q', '-b', 'main'], project)
    await git(['config', 'user.email', 'smoke@locust.test'], project)
    await git(['config', 'user.name', 'Locust smoke'], project)
    await writeFile(join(project, 'index.html'), '<h1>Todo</h1>\n', 'utf8')
    await git(['add', '-A'], project)
    await git(['commit', '-q', '-m', 'first'], project)

    const columns = createWorktreeManager({ workspacePath: project, directory: elsewhere })
    const column = await columns.ensure({ teammateId: 'cmp_abc123-b', name: 'compare cmp_abc123 b' })
    // Not under the project: its path does not lead back to the real folder.
    expect(relative(project, column).startsWith('..')).toBe(true)
    expect(relative(elsewhere, column).startsWith('..')).toBe(false)
    expect(await readFile(join(column, 'index.html'), 'utf8')).toContain('Todo')
    // Still found, so Keep and removal work on it.
    expect((await columns.list()).map((tree) => tree.path.replace(/\\/g, '/').toLowerCase())).toContain(column.replace(/\\/g, '/').toLowerCase())
  }, 60_000)
})
