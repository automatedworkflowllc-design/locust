import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createWorktreeManager, treeChangesOf, WORKTREE_DIR } from './worktrees.js'

/**
 * A KEPT COLUMN BRINGS ITS CHANGES IN (0.445, compare changes).
 *
 * A comparison that edits gives each model its own copy of the project, cut
 * from the person's last commit. Keep this one puts the kept copy's changes
 * into the folder UNCOMMITTED -- the state a teammate editing the folder
 * directly leaves, so nothing new is asked of the person -- and refuses,
 * touching nothing, when the person has changed a file it changes or the
 * folder moved on so it no longer applies. Real git, as the Land tests.
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
const exists = (path: string): Promise<boolean> => stat(path).then(() => true, () => false)
const text = async (path: string): Promise<string> => (await readFile(path, 'utf8')).replace(/\r\n/g, '\n')

const COMPARE_DIR = join('.locust', 'compare')
const A = { teammateId: 'cmp_1-a', name: 'compare cmp_1 a' }
const B = { teammateId: 'cmp_1-b', name: 'compare cmp_1 b' }

/** A repository and two columns' copies: A fixed cart.py and added notes.md; B rewrote README.md. */
async function twoColumns() {
  const root = await mkdtemp(join(tmpdir(), 'locust-bring-in-'))
  roots.push(root)
  await git(['init', '-q', '-b', 'main'], root)
  await git(['config', 'user.email', 'person@locust.test'], root)
  await git(['config', 'user.name', 'The person'], root)
  await writeFile(join(root, 'cart.py'), 'def total(items):\n    return 0\n', 'utf8')
  await writeFile(join(root, 'README.md'), 'mine\n', 'utf8')
  await git(['add', '.'], root)
  await git(['commit', '-q', '-m', 'first'], root)
  const manager = createWorktreeManager({ workspacePath: root, directory: COMPARE_DIR })
  const a = await manager.ensure(A)
  const b = await manager.ensure(B)
  await writeFile(join(a, 'cart.py'), 'def total(items):\n    return sum(items)\n', 'utf8')
  await writeFile(join(a, 'notes.md'), 'summed items\n', 'utf8')
  await writeFile(join(b, 'README.md'), 'rewritten\n', 'utf8')
  return { root, manager, a, b }
}

describe('a comparison that edits', () => {
  it('counts what each copy changed, saved or not, new files included', async () => {
    const { manager } = await twoColumns()
    expect(await manager.changes('cmp_1-a')).toEqual({ files: 2, added: 2, removed: 1 })
    expect(await manager.changes('cmp_1-b')).toEqual({ files: 1, added: 1, removed: 1 })
  }, REAL_GIT_TIMEOUT_MS)

  it('keeps its copies out of the teammates\' worktrees list', async () => {
    const { root, manager } = await twoColumns()
    expect(await exists(join(root, COMPARE_DIR, 'cmp_1-a'))).toBe(true)
    expect(await createWorktreeManager({ workspacePath: root }).list()).toEqual([])
    expect((await manager.list()).map((tree) => tree.teammateId).sort()).toEqual(['cmp_1-a', 'cmp_1-b'])
    expect(await exists(join(root, WORKTREE_DIR))).toBe(false)
  }, REAL_GIT_TIMEOUT_MS)

  it('puts the kept copy\'s changes into the folder, uncommitted, and nothing of the other\'s', async () => {
    const { root, manager } = await twoColumns()
    const head = (await git(['rev-parse', 'HEAD'], root)).trim()
    expect(await manager.bringIn('cmp_1-a')).toEqual({ kind: 'brought', files: ['cart.py', 'notes.md'] })
    expect(await text(join(root, 'cart.py'))).toBe('def total(items):\n    return sum(items)\n')
    expect(await text(join(root, 'notes.md'))).toBe('summed items\n')
    expect(await text(join(root, 'README.md'))).toBe('mine\n')
    // Nothing committed, nothing staged: as a teammate editing the folder leaves it.
    expect((await git(['rev-parse', 'HEAD'], root)).trim()).toBe(head)
    expect((await git(['diff', '--cached', '--name-only'], root)).trim()).toBe('')
    expect((await git(['status', '--porcelain'], root)).split(/\r?\n/).filter(Boolean).sort()).toEqual([' M cart.py', '?? notes.md'])
  }, REAL_GIT_TIMEOUT_MS)

  it('refuses, touching nothing, when the person has changed a file it changes', async () => {
    const { root, manager } = await twoColumns()
    await writeFile(join(root, 'README.md'), 'my own edit\n', 'utf8')
    expect(await manager.bringIn('cmp_1-b')).toEqual({ kind: 'your-changes', files: ['README.md'] })
    expect(await text(join(root, 'README.md'))).toBe('my own edit\n')
  }, REAL_GIT_TIMEOUT_MS)

  it('refuses, touching nothing, when the folder moved on and it no longer applies', async () => {
    const { root, manager } = await twoColumns()
    await writeFile(join(root, 'cart.py'), 'def total(items):\n    return len(items)\n', 'utf8')
    await git(['commit', '-q', '-am', 'mine moved on'], root)
    const result = await manager.bringIn('cmp_1-a')
    expect(result.kind).toBe('does-not-apply')
    expect(await text(join(root, 'cart.py'))).toBe('def total(items):\n    return len(items)\n')
    expect(await exists(join(root, 'notes.md'))).toBe(false)
    expect((await git(['status', '--porcelain'], root)).trim()).toBe('')
  }, REAL_GIT_TIMEOUT_MS)

  it('neither counts nor brings in what a tool made, like a Python cache (0.451)', async () => {
    // The first Auto comparison: a column ran its code, and its __pycache__
    // counted as a second changed file that Keep would have brought in.
    const { root, manager, a } = await twoColumns()
    await mkdir(join(a, '__pycache__'), { recursive: true })
    await writeFile(join(a, '__pycache__', 'cart.cpython-314.pyc'), 'bytes', 'utf8')
    await mkdir(join(a, 'node_modules', 'left-pad'), { recursive: true })
    await writeFile(join(a, 'node_modules', 'left-pad', 'index.js'), 'x', 'utf8')
    expect(await manager.changes('cmp_1-a')).toEqual({ files: 2, added: 2, removed: 1 })
    expect(await manager.bringIn('cmp_1-a')).toEqual({ kind: 'brought', files: ['cart.py', 'notes.md'] })
    expect(await exists(join(root, '__pycache__'))).toBe(false)
    expect(await exists(join(root, 'node_modules'))).toBe(false)
  }, REAL_GIT_TIMEOUT_MS)

  it('says so when a copy changed nothing', async () => {
    const { root, manager } = await twoColumns()
    await manager.ensure({ teammateId: 'cmp_1-c', name: 'compare cmp_1 c' })
    expect(await manager.bringIn('cmp_1-c')).toEqual({ kind: 'nothing' })
    expect((await git(['status', '--porcelain'], root)).trim()).toBe('')
  }, REAL_GIT_TIMEOUT_MS)

  it('discards a copy and its branch, whatever is in it', async () => {
    const { root, manager, a } = await twoColumns()
    await manager.discard('cmp_1-a')
    expect(await exists(a)).toBe(false)
    expect((await git(['branch', '--list', '--format=%(refname:short)', 'locust/*'], root)).trim()).toBe('locust/compare-cmp_1-b')
    // Discarding what is already gone is not an error.
    await manager.discard('cmp_1-a')
  }, REAL_GIT_TIMEOUT_MS)
})

describe('the numbers', () => {
  it('reads numstat, a binary file counting as a file with no lines', () => {
    expect(treeChangesOf('3\t1\tcart.py\n-\t-\tlogo.png\n1\t0\tnotes.md\n')).toEqual({ files: 3, added: 4, removed: 1 })
    expect(treeChangesOf('')).toEqual({ files: 0, added: 0, removed: 0 })
  })
})
