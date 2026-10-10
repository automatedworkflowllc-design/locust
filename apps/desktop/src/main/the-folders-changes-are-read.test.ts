import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createFolderCommits } from './folder-commit.js'

/*
 * THE FOLDER'S CHANGES, IN ONE PANEL (0.732): the branch against where it left its base, committed and uncommitted
 * together, new files whole, and its commits -- each of which can be shown alone. Real git, in a scratch repository.
 */
const TIMEOUT = 60_000
const made: string[] = []
afterEach(async () => {
  await Promise.all(made.splice(0).map((folder) => rm(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })))
})
const git = (args: readonly string[], cwd: string): Promise<string> =>
  new Promise((resolve, reject) => execFile('git', [...args], { cwd, windowsHide: true }, (error, stdout, stderr) => (error ? reject(new Error(String(stderr))) : resolve(String(stdout)))))

async function repository(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), 'locust-diff-ws-'))
  made.push(folder)
  await git(['init', '-q', '-b', 'main'], folder)
  await git(['config', 'user.email', 'you@example.test'], folder)
  await git(['config', 'user.name', 'You'], folder)
  await writeFile(join(folder, 'cart.py'), 'def total(items):\n    return 0\n')
  await git(['add', '.'], folder)
  await git(['commit', '-q', '-m', 'first'], folder)
  return folder
}

describe('the folder’s changes', () => {
  it('on a branch: its commits and what is not committed yet, against main, new files whole', { timeout: TIMEOUT }, async () => {
    const folder = await repository()
    await git(['checkout', '-q', '-b', 'fix-totals'], folder)
    await writeFile(join(folder, 'cart.py'), 'def total(items):\n    return sum(items)\n')
    await git(['commit', '-q', '-am', 'Sum the items'], folder)
    await writeFile(join(folder, 'cart.py'), 'def total(items):\n    return sum(items)\n\n# done\n')
    await writeFile(join(folder, 'notes.md'), '# Notes\n')
    const read = await createFolderCommits().diff(folder)
    expect(read.kind).toBe('diff')
    if (read.kind !== 'diff') return
    expect([read.base, read.branch, read.showing]).toEqual(['main', 'fix-totals', 'all'])
    expect(read.commits.map((commit) => commit.subject)).toEqual(['Sum the items'])
    expect(read.text).toContain('+    return sum(items)')
    expect(read.text).toContain('+# done')
    expect(read.text).toContain('+# Notes')
    // One commit alone: only what it changed.
    const one = await createFolderCommits().diff(folder, read.commits[0]!.sha)
    expect(one.kind === 'diff' && one.text.includes('+    return sum(items)') && !one.text.includes('# done') && !one.text.includes('# Notes')).toBe(true)
  })

  it('on main: what is not committed yet, and nothing when nothing has changed', { timeout: TIMEOUT }, async () => {
    const folder = await repository()
    expect(await createFolderCommits().diff(folder)).toEqual({ kind: 'none', why: 'clean' })
    await writeFile(join(folder, 'cart.py'), 'def total(items):\n    return 1\n')
    const read = await createFolderCommits().diff(folder)
    expect(read.kind === 'diff' && read.base === 'HEAD' && read.commits.length === 0 && read.text.includes('+    return 1')).toBe(true)
  })

  it('shows no commit it was not asked about, and no folder that is not a repository', { timeout: TIMEOUT }, async () => {
    const folder = await repository()
    await git(['checkout', '-q', '-b', 'other'], folder)
    expect(await createFolderCommits().diff(folder, 'a'.repeat(40))).toEqual({ kind: 'none', why: 'clean' })
    const plain = await mkdtemp(join(tmpdir(), 'locust-diff-plain-'))
    made.push(plain)
    expect(await createFolderCommits().diff(plain)).toEqual({ kind: 'none', why: 'not-a-repository' })
  })
})
