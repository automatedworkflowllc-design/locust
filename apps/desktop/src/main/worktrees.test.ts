import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { branchNameFor, createWorktreeManager, gitVersionSupportsWorktrees, parseGitVersion, parseWorktreeList } from './worktrees.js'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

const git = (args: readonly string[], cwd: string): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile('git', [...args], { cwd, windowsHide: true }, (error, stdout) => (error ? reject(error) : resolve(stdout)))
  })

/** A real repository with one commit, so worktree commands have a HEAD to branch from. */
async function repository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'locust-worktrees-'))
  roots.push(root)
  await git(['init', '-q', '-b', 'main'], root)
  await git(['config', 'user.email', 'smoke@locust.test'], root)
  await git(['config', 'user.name', 'Locust smoke'], root)
  await writeFile(join(root, 'NOTES.md'), '# notes\n', 'utf8')
  await git(['add', 'NOTES.md'], root)
  await git(['commit', '-q', '-m', 'first'], root)
  return root
}

describe('the pure parts', () => {
  it('names a branch from the teammate, folded to what git accepts', () => {
    expect(branchNameFor('Wren')).toBe('locust/wren')
    expect(branchNameFor('  Booty Call! ')).toBe('locust/booty-call')
    expect(branchNameFor('...')).toBe('locust/teammate')
    expect(branchNameFor('x'.repeat(80)).length).toBeLessThanOrEqual('locust/'.length + 40)
  })

  it('reads the git version and knows which ones have worktrees', () => {
    expect(parseGitVersion('git version 2.45.1.windows.1\n')).toBe('2.45.1')
    expect(gitVersionSupportsWorktrees('2.45.1')).toBe(true)
    expect(gitVersionSupportsWorktrees('2.4.9')).toBe(false)
    expect(gitVersionSupportsWorktrees('3.0')).toBe(true)
  })

  it('keeps only the trees Locust made under the folder out of a porcelain list', () => {
    const output = [
      'worktree C:/w/shop',
      'HEAD abc',
      'branch refs/heads/main',
      '',
      'worktree C:/w/shop/.locust/worktrees/tm_wren',
      'HEAD def',
      'branch refs/heads/locust/wren',
      '',
      'worktree C:/elsewhere/other',
      'HEAD 123',
      'branch refs/heads/feature',
      ''
    ].join('\n')
    expect(parseWorktreeList(output, 'C:\\w\\shop')).toEqual([{ teammateId: 'tm_wren', path: 'C:/w/shop/.locust/worktrees/tm_wren', branch: 'locust/wren' }])
  })
})

describe('a worktree per teammate, on a real repository', () => {
  it('refuses a folder that is not a repository, with the reason', async () => {
    const plain = await mkdtemp(join(tmpdir(), 'locust-notrepo-'))
    roots.push(plain)
    const manager = createWorktreeManager({ workspacePath: plain })
    const probe = await manager.probe()
    expect(probe.repository).toBe(false)
    expect(probe.reason).toMatch(/not a git repository/)
    await expect(manager.ensure({ teammateId: 'tm_wren', name: 'Wren' })).rejects.toThrow(/not a git repository/)
  })

  it('makes the tree under .locust/worktrees on its own branch, excludes .locust, and is idempotent', async () => {
    const root = await repository()
    const manager = createWorktreeManager({ workspacePath: root })
    expect((await manager.probe()).repository).toBe(true)
    const path = await manager.ensure({ teammateId: 'tm_wren', name: 'Wren' })
    expect(path.replace(/\\/g, '/')).toBe(`${root.replace(/\\/g, '/')}/.locust/worktrees/tm_wren`)
    expect((await stat(join(path, 'NOTES.md'))).isFile()).toBe(true)
    expect((await git(['rev-parse', '--abbrev-ref', 'HEAD'], path)).trim()).toBe('locust/wren')
    expect(await readFile(join(root, '.git', 'info', 'exclude'), 'utf8')).toContain('.locust/')
    // The main checkout does not see the new directory as untracked.
    expect((await git(['status', '--porcelain'], root)).trim()).toBe('')
    expect(await manager.ensure({ teammateId: 'tm_wren', name: 'Wren' })).toBe(path)
    expect((await manager.list()).map((entry) => [entry.teammateId, entry.branch])).toEqual([['tm_wren', 'locust/wren']])
  })

  it('two teammates get two trees that do not see each other, and the main checkout stays untouched', async () => {
    const root = await repository()
    const manager = createWorktreeManager({ workspacePath: root })
    const wren = await manager.ensure({ teammateId: 'tm_wren', name: 'Wren' })
    const booty = await manager.ensure({ teammateId: 'tm_booty', name: 'Booty' })
    await writeFile(join(wren, 'NOTES.md'), '# notes\nwren was here\n', 'utf8')
    await writeFile(join(booty, 'NOTES.md'), '# notes\nbooty was here\n', 'utf8')
    expect(await readFile(join(root, 'NOTES.md'), 'utf8')).toBe('# notes\n')
    expect(await readFile(join(wren, 'NOTES.md'), 'utf8')).toContain('wren')
    expect(await readFile(join(booty, 'NOTES.md'), 'utf8')).not.toContain('wren')
    expect((await manager.list()).map((entry) => entry.branch).sort()).toEqual(['locust/booty', 'locust/wren'])
    await manager.remove('tm_booty')
    expect((await manager.list()).map((entry) => entry.teammateId)).toEqual(['tm_wren'])
    // The branch outlives the tree: the work is the person's to merge or drop.
    expect((await git(['branch', '--list', 'locust/booty'], root)).trim()).toContain('locust/booty')
    // A tree removed and asked for again comes back on the same branch.
    const again = await manager.ensure({ teammateId: 'tm_booty', name: 'Booty' })
    expect((await git(['rev-parse', '--abbrev-ref', 'HEAD'], again)).trim()).toBe('locust/booty')
  })

  it('refuses an id that could name a path outside the folder', async () => {
    const root = await repository()
    const manager = createWorktreeManager({ workspacePath: root })
    await expect(manager.ensure({ teammateId: '../escape', name: 'x' })).rejects.toThrow(/cannot name a worktree/)
    await expect(manager.remove('..')).rejects.toThrow(/cannot name a worktree/)
  })
})
