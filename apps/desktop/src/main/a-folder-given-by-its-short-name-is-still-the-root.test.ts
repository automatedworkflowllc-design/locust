// @vitest-environment node
import { execFile, execFileSync } from 'node:child_process'
import { mkdtemp, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { platform, tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createWorktreeManager } from './worktrees.js'

/*
 * Windows keeps a second spelling of many folders, the 8.3 short name
 * (`C:\Users\RUNNER~1` for `runneradmin`), and hands it out in places: a
 * hosted runner's TEMP, an old installer's working directory, a path pasted
 * from a dialog that showed it. git prints the real one. The worktree
 * manager compared the two as strings, so a folder given by its short name
 * was "inside a repository but not its root", and once past that its trees
 * were listed as none and "not finished being made" (measured 10/04, 31
 * tests on the first public CI run). Now it takes the folder's real spelling.
 */

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })))
})

const git = (args: readonly string[], cwd: string): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile('git', [...args], { cwd, windowsHide: true }, (error, stdout) => (error ? reject(error) : resolve(stdout)))
  })

/** The folder's 8.3 spelling, or undefined where the volume keeps none (then there is nothing to test). */
function shortSpelling(folder: string): string | undefined {
  if (/\s/.test(folder)) return undefined
  try {
    const said = execFileSync('cmd.exe', ['/d', '/c', 'for', '%I', 'in', `(${folder})`, 'do', '@echo', '%~sI'], { encoding: 'utf8', windowsHide: true }).trim()
    return said.length > 0 && said.toLowerCase() !== folder.toLowerCase() ? said : undefined
  } catch {
    return undefined
  }
}

describe.skipIf(platform() !== 'win32')('a project folder given by its Windows short name', () => {
  it("is still its repository's root; its tree is made under the real name and listed", { timeout: 30_000 }, async (context) => {
    const real = await realpath(await mkdtemp(join(tmpdir(), 'locust-short-name-repository-')))
    roots.push(real)
    const short = shortSpelling(real)
    if (short === undefined) return context.skip('this volume keeps no 8.3 names')
    expect(short).not.toBe(real)
    await git(['init', '-q', '-b', 'main'], real)
    await git(['config', 'user.email', 'smoke@locust.test'], real)
    await git(['config', 'user.name', 'Locust smoke'], real)
    await writeFile(join(real, 'NOTES.md'), '# notes\n', 'utf8')
    await git(['add', 'NOTES.md'], real)
    await git(['commit', '-q', '-m', 'first'], real)

    const manager = createWorktreeManager({ workspacePath: short })
    expect(await manager.probe()).toMatchObject({ repository: true })
    const path = await manager.ensure({ teammateId: 'tm_wren', name: 'Wren' })
    expect(path.replace(/\\/g, '/').toLowerCase()).toBe(`${real.replace(/\\/g, '/').toLowerCase()}/.locust/worktrees/tm_wren`)
    expect((await stat(join(path, 'NOTES.md'))).isFile()).toBe(true)
    // Asked again by the short name: the same tree, not a second making.
    expect(await manager.ensure({ teammateId: 'tm_wren', name: 'Wren' })).toBe(path)
    expect((await manager.list()).map((entry) => [entry.teammateId, entry.branch])).toEqual([['tm_wren', 'locust/wren']])
  })
})
