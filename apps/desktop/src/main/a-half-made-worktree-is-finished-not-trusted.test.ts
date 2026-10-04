import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createWorktreeManager } from './worktrees.js'

/*
 * Code review B4, main-stores 3, REPRODUCED 2026-09-26: a `git worktree add`
 * ended part-way (Locust's own 20 s limit, on a big project) leaves the tree's
 * `.git` file -- all `ensure` checked -- beside a fraction of the files, no
 * index, a stale `index.lock`, and git's `locked` mark reading
 * "initializing". Handed to a teammate like that, `git status` reads every
 * file as deleted.
 *
 * Real git, real folders, the state rebuilt exactly as measured on a
 * 30,000-file repository: a finished tree has its index taken away, a lock
 * left, most files removed and the mark put on. A teammate's change and a new
 * file are in it too, because a tree an older build handed out may hold work.
 */
const CLEANUP = { recursive: true, force: true, maxRetries: 5, retryDelay: 100 } as const
const REAL_GIT_TIMEOUT_MS = 60_000

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((directory) => rm(directory, CLEANUP)))
})

const git = (args: readonly string[], cwd: string): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile('git', [...args], { cwd, windowsHide: true }, (error, stdout) => (error ? reject(error) : resolve(stdout)))
  })

async function repository(files: number): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'locust-halfmade-'))
  roots.push(root)
  await git(['init', '-q', '-b', 'main'], root)
  await git(['config', 'user.email', 'smoke@locust.test'], root)
  await git(['config', 'user.name', 'Locust smoke'], root)
  await mkdir(join(root, 'src'), { recursive: true })
  await writeFile(join(root, 'NOTES.md'), '# notes\n', 'utf8')
  for (let index = 0; index < files; index += 1) await writeFile(join(root, 'src', `file${String(index)}.txt`), `line ${String(index)}\n`, 'utf8')
  await git(['add', '-A'], root)
  await git(['commit', '-q', '-m', 'first'], root)
  return root
}

const exists = async (path: string): Promise<boolean> => stat(path).then(() => true, () => false)

describe('a tree whose making was cut short', () => {
  it('is finished, keeping what is in it, rather than handed out half-made', { timeout: REAL_GIT_TIMEOUT_MS }, async () => {
    const root = await repository(30)
    const manager = createWorktreeManager({ workspacePath: root })
    const path = await manager.ensure({ teammateId: 'tm_wren', name: 'Wren' })
    const admin = join(root, '.git', 'worktrees', 'tm_wren')

    // The state a killed add leaves, as measured.
    await rm(join(admin, 'index'), { force: true })
    await writeFile(join(admin, 'index.lock'), '', 'utf8')
    await writeFile(join(admin, 'locked'), 'initializing\n', 'utf8')
    for (let index = 5; index < 30; index += 1) await rm(join(path, 'src', `file${String(index)}.txt`))
    // And work a teammate did there, under an older build.
    await writeFile(join(path, 'src', 'file0.txt'), 'changed by Wren\n', 'utf8')
    await writeFile(join(path, 'WREN.md'), 'a new file\n', 'utf8')

    const again = await manager.ensure({ teammateId: 'tm_wren', name: 'Wren' })

    expect(again).toBe(path)
    for (let index = 0; index < 30; index += 1) expect(await exists(join(path, 'src', `file${String(index)}.txt`))).toBe(true)
    expect(await readFile(join(path, 'src', 'file0.txt'), 'utf8')).toBe('changed by Wren\n')
    expect((await git(['status', '--porcelain'], path)).split(/\r?\n/).filter((line) => line.length > 0).sort()).toEqual([' M src/file0.txt', '?? WREN.md'])
    expect(await exists(join(admin, 'locked'))).toBe(false)
    expect(await exists(join(admin, 'index.lock'))).toBe(false)
  })

  it('leaves a finished tree exactly as it is', { timeout: REAL_GIT_TIMEOUT_MS }, async () => {
    const root = await repository(3)
    const calls: string[][] = []
    const manager = createWorktreeManager({
      workspacePath: root,
      runGit: (args, cwd) => {
        calls.push([...args])
        return git(args, cwd)
      }
    })
    const path = await manager.ensure({ teammateId: 'tm_wren', name: 'Wren' })
    calls.length = 0

    expect(await manager.ensure({ teammateId: 'tm_wren', name: 'Wren' })).toBe(path)
    // No git at all for a tree that is already whole.
    expect(calls).toEqual([])
  })

  it('does nothing to a .git file that points outside the repository', { timeout: REAL_GIT_TIMEOUT_MS }, async () => {
    const root = await repository(1)
    const elsewhere = await mkdtemp(join(tmpdir(), 'locust-halfmade-elsewhere-'))
    roots.push(elsewhere)
    await writeFile(join(elsewhere, 'locked'), 'initializing\n', 'utf8')
    await writeFile(join(elsewhere, 'index.lock'), 'not ours\n', 'utf8')
    const path = join(root, '.locust', 'worktrees', 'tm_wren')
    await mkdir(path, { recursive: true })
    await writeFile(join(path, '.git'), `gitdir: ${elsewhere}\n`, 'utf8')

    const manager = createWorktreeManager({ workspacePath: root })
    await manager.ensure({ teammateId: 'tm_wren', name: 'Wren' })

    // Whatever that is, it is not a tree this manager made: its lock stays.
    expect(await readFile(join(elsewhere, 'index.lock'), 'utf8')).toBe('not ours\n')
  })
})
