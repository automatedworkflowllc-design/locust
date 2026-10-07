import { execFile } from 'node:child_process'
import { appendFile, chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { leavingNoLog } from './cloud-tasks.js'
import type { Runner } from './cloud-tasks.js'
import { createFolderCommits } from './folder-commit.js'
import { checkpointSentence } from './turn-checkpoint.js'
import { filesWithMarkers } from './worktrees.js'

/**
 * SOL'S REVIEW, ANSWERED (0.683). An adversarial review of 0.679-0.681 by another model (GPT-6 Sol, in Ask) found
 * ten ways the new code could do the wrong thing. Each finding is a case here, in its own words.
 */
const TIMEOUT = 60_000
const NL = String.fromCharCode(10)
const made: string[] = []
afterEach(async () => {
  for (const dir of made.splice(0)) await rm(dir, { recursive: true, force: true })
})
async function scratch(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  made.push(dir)
  return dir
}
const git = (args: readonly string[], cwd: string): Promise<string> =>
  new Promise((resolve, reject) => execFile('git', [...args], { cwd, windowsHide: true }, (error, stdout, stderr) => (error ? reject(new Error(String(stderr))) : resolve(String(stdout)))))
const CODEX = (n: number): string => `[2026-10-07T00:53:04.5434778+00:00] env: status=200 OK ${String(n)}${NL}`

async function repository(): Promise<string> {
  const folder = await scratch('locust-sol-ws-')
  await git(['init', '-q', '-b', 'main'], folder)
  await git(['config', 'user.email', 'you@example.test'], folder)
  await git(['config', 'user.name', 'You'], folder)
  await writeFile(join(folder, 'cart.py'), `x = 0${NL}`)
  await git(['add', '.'], folder)
  await git(['commit', '-q', '-m', 'first'], folder)
  return folder
}
const noNetwork = async (): Promise<string> => { throw new Error('no network in this test') }

describe("Sol's review, answered", () => {
  it('1. more than the check reads is never cut: Codex lines past 1 MiB, then the person\'s own, are all kept', async () => {
    const dir = await scratch('locust-sol-log-')
    let codex = ''
    for (let n = 0; codex.length < 1_100_000; n += 1) codex += CODEX(n)
    const run: Runner = async (_args, cwd) => {
      await appendFile(join(cwd, 'error.log'), `${codex}my app's own record${NL}`)
      return { code: 0, stdout: '', stderr: '' }
    }
    await leavingNoLog(run)(['cloud', 'list'], dir)
    expect(await readFile(join(dir, 'error.log'), 'utf8')).toContain("my app's own record")
  })

  it("2. a line the person's program adds after the check is never cut", async () => {
    const dir = await scratch('locust-sol-log-')
    await writeFile(join(dir, 'error.log'), `mine${NL}`)
    // Codex writes; then, before cleanup can look, the person's program writes too.
    const run: Runner = async (_args, cwd) => {
      await appendFile(join(cwd, 'error.log'), CODEX(1))
      await appendFile(join(cwd, 'error.log'), `also mine${NL}`)
      return { code: 0, stdout: '', stderr: '' }
    }
    await leavingNoLog(run)(['cloud', 'list'], dir)
    const left = await readFile(join(dir, 'error.log'), 'utf8')
    expect(left).toContain('also mine')
    expect(left.startsWith(`mine${NL}`)).toBe(true)
  })

  it('3. a branch named like a flag is refused before git is ever asked to push it', { timeout: TIMEOUT }, async () => {
    const folder = await repository()
    await git(['symbolic-ref', 'HEAD', 'refs/heads/--mirror'], folder)
    await writeFile(join(folder, 'cart.py'), `x = 1${NL}`)
    const commits = createFolderCommits({ runNetwork: noNetwork })
    expect(await commits.changes(folder)).toMatchObject({ kind: 'blocked', why: 'branch-name' })
    expect((await commits.commit(folder, 'x', 'push', ['cart.py'])).kind).toBe('refused')
  })

  it('4. a .locust file already staged is never committed', { timeout: TIMEOUT }, async () => {
    const folder = await repository()
    await mkdir(join(folder, '.locust'), { recursive: true })
    await writeFile(join(folder, '.locust', 'private.json'), '{}')
    await git(['add', '-f', '.locust/private.json'], folder)
    await writeFile(join(folder, 'cart.py'), `x = 1${NL}`)
    const done = await createFolderCommits({ runNetwork: noNetwork }).commit(folder, 'Change x', 'commit', ['cart.py'])
    expect(done.kind).toBe('done')
    expect((await git(['show', '--name-only', '--format=', 'HEAD'], folder)).trim()).toBe('cart.py')
  })

  it('5. a refused commit leaves alone what the person staged while the hook ran, and says so', { timeout: TIMEOUT }, async () => {
    const folder = await repository()
    await writeFile(join(folder, 'cart.py'), `x = 1${NL}`)
    // The hook stands in for the person staging something new meanwhile, then refuses.
    await writeFile(join(folder, '.git', 'hooks', 'pre-commit'), `#!/bin/sh${NL}echo theirs > theirs.md${NL}git add theirs.md${NL}echo refused >&2${NL}exit 1${NL}`)
    await chmod(join(folder, '.git', 'hooks', 'pre-commit'), 0o755)
    const refused = await createFolderCommits({ runNetwork: noNetwork }).commit(folder, 'Change x', 'commit', ['cart.py'])
    expect(refused.kind).toBe('refused')
    if (refused.kind === 'refused') expect(refused.message).toMatch(/What is staged changed while the commit ran/)
    expect((await git(['diff', '--cached', '--name-only'], folder)).split(NL).filter(Boolean)).toContain('theirs.md')
  })

  it('6. the commit is of the files the person was shown, or nothing', { timeout: TIMEOUT }, async () => {
    const folder = await repository()
    await writeFile(join(folder, 'cart.py'), `x = 1${NL}`)
    const commits = createFolderCommits({ runNetwork: noNetwork })
    // Shown cart.py; then a file appears before the press.
    await writeFile(join(folder, 'late.md'), `late${NL}`)
    const refused = await commits.commit(folder, 'Change x', 'commit', ['cart.py'])
    expect(refused).toMatchObject({ kind: 'refused', message: expect.stringMatching(/changed since this was opened/) })
    expect((await git(['rev-list', '--count', 'HEAD'], folder)).trim()).toBe('1')
  })

  it('8. a checkout hook that fails after the switch leaves the person on their branch, and no new one', { timeout: TIMEOUT }, async () => {
    const folder = await repository()
    const bare = await scratch('locust-sol-remote-')
    await git(['init', '-q', '--bare', '-b', 'main'], bare)
    await git(['remote', 'add', 'origin', 'https://github.com/someone/pebble.git'], folder)
    await git(['remote', 'set-url', '--push', 'origin', bare], folder)
    await git(['push', '-q', '-u', 'origin', 'main'], folder)
    await git(['remote', 'set-head', 'origin', 'main'], folder)
    await writeFile(join(folder, '.git', 'hooks', 'post-checkout'), `#!/bin/sh${NL}exit 1${NL}`)
    await chmod(join(folder, '.git', 'hooks', 'post-checkout'), 0o755)
    await writeFile(join(folder, 'cart.py'), `x = 1${NL}`)
    const signedIn = async (program: 'git' | 'gh', args: readonly string[]): Promise<string> => (program === 'gh' && args[0] === 'auth' ? 'ok' : noNetwork())
    const refused = await createFolderCommits({ runNetwork: signedIn }).commit(folder, 'Change x', 'pull-request', ['cart.py'])
    expect(refused.kind).toBe('refused')
    expect((await git(['symbolic-ref', '--short', 'HEAD'], folder)).trim()).toBe('main')
    expect((await git(['branch', '--list', 'locust/*'], folder)).trim()).toBe('')
  })

  it('9. a marker check that fails is not "no markers", and the thread does not say it can land', async () => {
    const failing = async (): Promise<string> => { throw Object.assign(new Error('git grep: fatal: unable to read tree'), { stdout: '', exitCode: 128 }) }
    const none = async (): Promise<string> => { throw Object.assign(new Error('git grep: '), { stdout: '', exitCode: 1 }) }
    const found = async (): Promise<string> => `HEAD:cart.py${NL}`
    expect(await filesWithMarkers(failing, 'C:/x', 'HEAD', ['cart.py'])).toBeUndefined()
    expect(await filesWithMarkers(none, 'C:/x', 'HEAD', ['cart.py'])).toEqual([])
    expect(await filesWithMarkers(found, 'C:/x', 'HEAD', ['cart.py'])).toEqual(['cart.py'])
    const said = checkpointSentence({ kind: 'committed', sha: 'abcdef1234567890', branch: 'locust/wren', files: ['cart.py'], skipped: [], mergeFinished: true, markersUnchecked: true }) ?? ''
    expect(said).not.toMatch(/can land now/)
    expect(said).toMatch(/could not check it for conflict markers/)
  })

  it('10. a URL that only mentions github.com is not GitHub', { timeout: TIMEOUT }, async () => {
    const folder = await repository()
    await git(['remote', 'add', 'origin', 'https://evil.example/github.com/owner/repo.git'], folder)
    await writeFile(join(folder, 'cart.py'), `x = 1${NL}`)
    const signedIn = async (program: 'git' | 'gh', args: readonly string[]): Promise<string> => (program === 'gh' && args[0] === 'auth' ? 'ok' : noNetwork())
    const seen = await createFolderCommits({ runNetwork: signedIn }).changes(folder)
    expect(seen.kind === 'changes' && seen.remote?.pullRequests).toBe(false)
  })

  it('the log a cleanup leaves for a call that made it is gone, as before', async () => {
    const dir = await scratch('locust-sol-log-')
    await leavingNoLog(async (_args, cwd) => { await appendFile(join(cwd, 'error.log'), CODEX(1)); return { code: 0, stdout: '', stderr: '' } })(['cloud', 'list'], dir)
    await expect(stat(join(dir, 'error.log'))).rejects.toThrow()
  })
})
