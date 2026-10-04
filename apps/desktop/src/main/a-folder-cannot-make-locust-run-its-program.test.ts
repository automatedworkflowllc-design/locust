import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { snapshotWorkspace } from './disk-observation.js'
import { createWorktreeManager } from './worktrees.js'

/**
 * A repository's own config can name a program for git to run, and
 * `core.fsmonitor` runs on every `git status`. MEASURED 2026-09-25: Locust's
 * own status calls ran it -- at folder open, around every writing run, in a
 * teammate's worktree -- while Claude Code and OpenCode launched in the same
 * folder did not. See git-guard.ts.
 */
const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((directory) => rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })))
})

const git = (args: readonly string[], cwd: string): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile('git', [...args], { cwd, windowsHide: true }, (error, stdout) => (error ? reject(error) : resolve(stdout)))
  })

/** A real repository whose config names an fsmonitor that leaves a mark. */
async function hostile(): Promise<{ readonly root: string; readonly marker: string }> {
  const root = await mkdtemp(join(tmpdir(), 'locust-hostile-'))
  roots.push(root)
  const marker = join(root, 'fsmonitor-ran.txt').replace(/\\/g, '/')
  await git(['init', '-q', '-b', 'main'], root)
  await git(['config', 'user.email', 'smoke@locust.test'], root)
  await git(['config', 'user.name', 'Locust smoke'], root)
  await writeFile(join(root, 'NOTES.md'), '# notes\n', 'utf8')
  await git(['add', 'NOTES.md'], root)
  await git(['commit', '-q', '-m', 'first'], root)
  await git(['config', 'core.fsmonitor', `echo ran >> "${marker}"; exit 1`], root)
  return { root, marker }
}

describe("a folder whose git config names a program", () => {
  it("is looked at by Locust without running it", async () => {
    const { root, marker } = await hostile()
    expect(await snapshotWorkspace(root)).toBeDefined()
    expect(existsSync(marker)).toBe(false)
    // The control: the fixture is real -- plain `git status` runs it.
    await git(['status'], root)
    expect(existsSync(marker)).toBe(true)
  }, 30_000)

  it("has a teammate's worktree checked without running it", async () => {
    const { root, marker } = await hostile()
    const manager = createWorktreeManager({ workspacePath: root })
    const path = await manager.ensure({ teammateId: 'tm_wren', name: 'Wren' })
    await rm(marker, { force: true })
    // Removing looks at the worktree's changes first, with `git status`.
    await manager.remove('tm_wren')
    expect(existsSync(marker)).toBe(false)
    expect(existsSync(path)).toBe(false)
  }, 30_000)
})
